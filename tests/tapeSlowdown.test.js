import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTapeTimeline } from '../src/domain/tapeSlowdown.js';
import { buildSubtitleAss } from '../src/domain/subtitles.js';
import { TapeSlowdownService } from '../src/services/tapeSlowdownService.js';
import { ClipDownloadService, runExportProcess, validateClipDownload } from '../src/services/clipDownloadService.js';

const selection = {videoId: 'M7lc1UVf-VE', startSeconds: 0, endSeconds: 10};

test('tape curve is normalised per clip, finishes at 60%, and integrates playback time', () => {
  for (const duration of [0.5, 5, 10, 15]) {
    const timeline = createTapeTimeline(duration);
    assert.equal(timeline.speedAt(0), 1);
    assert.equal(timeline.speedAt(duration / 2), 0.8);
    assert.equal(timeline.speedAt(duration), 0.6);
    assert.equal(timeline.mapTime(0), 0);
    assert.ok(Math.abs(timeline.outputDuration / duration - 1.277064059414977) < 1e-12);
    assert.ok(timeline.mapTime(duration * 0.8) > timeline.mapTime(duration * 0.7));
    const at = duration / 2, epsilon = 1e-5;
    const derivative = (timeline.mapTime(at + epsilon) - timeline.mapTime(at - epsilon)) / (2 * epsilon);
    assert.ok(Math.abs(derivative - 1 / timeline.speedAt(at)) < 1e-6);
    assert.match(timeline.videoFilter, /setpts=.*log/);
  }
  for (const duration of [0, -1, NaN, Infinity, 31]) assert.throws(() => createTapeTimeline(duration), {code: 'TAPE_INVALID_DURATION'});
});

test('subtitle timings use the same nonlinear video/audio map', () => {
  const timeline = createTapeTimeline(10);
  const ass = buildSubtitleAss({width: 640, height: 360, words: [{text: 'Halfway.', start: 5, end: 6}]}, 10, {mapTime: timeline.mapTime});
  assert.match(ass, /Dialogue: 0,0:00:05\.58,0:00:06\.86,Default,,0,0,0,,Halfway\./);
});

test('tape option accepts only booleans and unsupported requests fail before acquisition', async () => {
  assert.equal(validateClipDownload({...selection, tapeSlowdown: true}).tapeSlowdown, true);
  assert.equal(validateClipDownload({...selection, tapeSlowdown: false}).tapeSlowdown, false);
  for (const option of [1, 'true', null, {}]) assert.throws(() => validateClipDownload({...selection, tapeSlowdown: option}), {code: 'INVALID_TAPE_OPTION'});
  const service = new ClipDownloadService({run: () => assert.fail('Must not download')});
  await assert.rejects(service.prepare({...selection, tapeSlowdown: true}), {code: 'TAPE_UNAVAILABLE'});
});

test('media probing uses actual video duration and detects silent clips', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const service = new TapeSlowdownService({pythonPath: 'python-test', run: async (binary, args, options) => {
    calls.push({binary, args, options});
    assert.equal(options.signal, signal);
    if (binary === 'ffprobe') return JSON.stringify({streams: [{codec_type: 'video', duration: '9.5'}], format: {duration: '10'}});
  }});
  await service.check({signal});
  assert.ok(calls[0].args.includes('--check'));
  const plan = await service.plan({directory: 'test-directory', signal});
  assert.equal(plan.duration, 9.5);
  assert.equal(plan.hasAudio, false);
  assert.equal(calls[1].options.captureStdout, true);
});

test('tape renderer resamples audio then combines warped video, remapped captions and AAC', async () => {
  const calls = [];
  const service = new TapeSlowdownService({pythonPath: 'python-test', run: async (binary, args, options) => calls.push({binary, args, options})});
  const directory = path.join(tmpdir(), 'tape-render-unit');
  const plan = {...createTapeTimeline(10), hasAudio: true};
  assert.equal(await service.render({directory, plan, subtitles: true}), path.join(directory, 'clip-tape.mp4'));
  assert.equal(calls[0].binary, 'python-test');
  assert.ok(calls[0].args[0].endsWith('tape_slowdown.py'));
  assert.equal(calls[0].args[calls[0].args.indexOf('--duration') + 1], '10');
  const render = calls[1];
  assert.equal(render.binary, 'ffmpeg');
  assert.equal(render.options.cwd, directory);
  assert.match(render.args[render.args.indexOf('-filter_complex') + 1], /trim=duration=.*ass=captions.ass/);
  assert.ok(render.args.includes('tape-audio.wav'));
  assert.ok(render.args.includes('aac'));
  assert.ok(render.args.includes('libx264'));
  calls.length = 0;
  await service.render({directory, plan: {...plan, hasAudio: false}});
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('-an'));
  assert.ok(!calls[0].args.includes('tape-audio.wav'));
});

test('combined export transcribes original speech and burns remapped captions in the tape render', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tape-export-test-'));
  t.after(() => rmdir(root));
  const signal = new AbortController().signal;
  const plan = {...createTapeTimeline(9.5), hasAudio: true};
  let captionsPrepared = false;
  const exporter = new ClipDownloadService({tempRoot: root,
    run: async (binary, _args, options) => {
      if (binary === 'yt-dlp') await writeFile(path.join(options.cwd, 'clip.mp4'), 'original speech');
    },
    subtitleService: {
      check: async () => {}, render: () => assert.fail('Must not encode captions separately'),
      prepareCaptions: async options => {
        assert.equal(await readFile(options.filePath, 'utf8'), 'original speech');
        assert.equal(options.duration, 9.5);
        assert.equal(options.mapTime(5), plan.mapTime(5));
        assert.equal(options.signal, signal);
        captionsPrepared = true;
      },
    },
    tapeService: {
      check: async () => {}, plan: async () => plan,
      render: async options => {
        assert.ok(captionsPrepared);
        assert.equal(options.subtitles, true);
        assert.equal(options.signal, signal);
        const output = path.join(options.directory, 'clip-tape.mp4');
        await writeFile(output, 'tape video with subtitles');
        return output;
      },
    },
  });
  const clip = await exporter.prepare({...selection, subtitles: true, tapeSlowdown: true}, {signal});
  assert.match(clip.filename, /-subtitled-tape\.mp4$/);
  assert.equal(await readFile(clip.filePath, 'utf8'), 'tape video with subtitles');
  await clip.cleanup();
});

test('probe output is captured and bounded, and process cancellation remains supported', async () => {
  assert.equal(await runExportProcess(process.execPath, ['-e', 'process.stdout.write("metadata")'], {captureStdout: true}), 'metadata');
  await assert.rejects(runExportProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(140000))'], {captureStdout: true}), {code: 'MEDIA_OUTPUT_LIMIT'});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runExportProcess(process.execPath, [], {captureStdout: true, signal: controller.signal}), {code: 'DOWNLOAD_CANCELLED'});
});
