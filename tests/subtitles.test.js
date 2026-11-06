import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSubtitleAss } from '../src/domain/subtitles.js';
import { LocalSubtitleService } from '../src/services/localSubtitleService.js';
import { ClipDownloadService, runExportProcess, validateClipDownload } from '../src/services/clipDownloadService.js';

const transcript = {width: 1280, height: 720, words: [
  {text: 'Hello', start: 0.1, end: 0.5}, {text: 'world!', start: 0.5, end: 0.9},
  {text: 'Another', start: 2, end: 2.4}, {text: 'sentence.', start: 2.4, end: 3.2},
]};

test('captions have bold white outlined text, short timed phrases, and duration-clamped endpoints', () => {
  const ass = buildSubtitleAss(transcript, 3);
  assert.match(ass, /PlayResX: 1280\nPlayResY: 720/);
  assert.match(ass, /Style: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1/);
  assert.match(ass, /Dialogue: 0,0:00:00\.10,0:00:00\.90,Default,,0,0,0,,Hello world!/);
  assert.match(ass, /Dialogue: 0,0:00:02\.00,0:00:03\.00,Default,,0,0,0,,Another sentence\./);
});

test('caption text cannot inject ASS formatting and invalid word times are skipped', () => {
  const ass = buildSubtitleAss({...transcript, words: [null,
    {text: '{\\pos(0,0)} hi\\Nthere', start: 0, end: 1},
    {text: 'outside', start: 20, end: 30}, {text: 'invalid', start: NaN, end: 1},
    {text: 'empty', start: 1, end: 1},
  ]}, 10);
  assert.ok(!ass.includes('{\\pos'));
  assert.ok(!ass.includes('\\N'));
  assert.ok(!ass.includes('outside'));
  assert.match(ass, /｛＼pos\(0,0\)｝ hi＼Nthere/);
});

test('portrait captions use actual dimensions and never show invented text for silence', () => {
  assert.match(buildSubtitleAss({...transcript, width: 405}, 10), /PlayResX: 405/);
  assert.throws(() => buildSubtitleAss({...transcript, words: []}, 10), {code: 'SUBTITLES_NO_SPEECH'});
  assert.throws(() => buildSubtitleAss({...transcript, height: 0}, 10), {code: 'SUBTITLES_INVALID'});
  assert.throws(() => validateClipDownload({videoId: 'M7lc1UVf-VE', startSeconds: 0, endSeconds: 10, subtitles: 'yes'}), {status: 400});
});

test('local subtitle service checks Python, writes ASS, and burns captions with fixed relative paths', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'caption-render-test-'));
  t.after(async () => {
    for (const name of ['transcript.json', 'captions.ass', 'clip-captioned.mp4']) await unlink(path.join(directory, name)).catch(() => {});
    await rmdir(directory);
  });
  const signal = new AbortController().signal;
  const calls = [];
  const subtitles = new LocalSubtitleService({pythonPath: 'python-for-test', run: async (binary, args, options) => {
    calls.push({binary, args, options});
    assert.equal(options.signal, signal);
    if (args.includes('--output')) await writeFile(args[args.indexOf('--output') + 1], JSON.stringify(transcript));
    if (binary === 'ffmpeg') await writeFile(path.join(directory, 'clip-captioned.mp4'), 'captioned MP4');
  }});
  await subtitles.check({signal});
  assert.ok(calls[0].args.includes('--check'));
  const output = await subtitles.render({filePath: path.join(directory, 'clip.mp4'), directory, duration: 3, signal});
  assert.equal(output, path.join(directory, 'clip-captioned.mp4'));
  assert.match(await readFile(path.join(directory, 'captions.ass'), 'utf8'), /Hello world!/);
  const render = calls.at(-1);
  assert.equal(render.options.cwd, directory);
  assert.equal(render.args[render.args.indexOf('-vf') + 1], 'ass=captions.ass');
  assert.ok(render.args.includes('libx264'));
});

test('local transcription exit errors identify missing setup and no speech', async () => {
  const service = new LocalSubtitleService();
  const options = service.processOptions();
  await assert.rejects(runExportProcess(process.execPath, ['-e', 'process.stderr.write("SUBTITLES_SETUP_REQUIRED");process.exit(2)'], options), {code: 'SUBTITLES_SETUP_REQUIRED', status: 503});
  await assert.rejects(runExportProcess(process.execPath, ['-e', 'process.stderr.write("SUBTITLES_NO_SPEECH");process.exit(3)'], options), {code: 'SUBTITLES_NO_SPEECH', status: 422});
});

test('download route preparation returns captioned media and cleans source, transcript and render together', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'caption-download-test-'));
  t.after(() => rmdir(root));
  let checked = false;
  const signal = new AbortController().signal;
  const exporter = new ClipDownloadService({tempRoot: root,
    run: async (binary, _args, options) => {
      assert.ok(checked);
      if (binary === 'yt-dlp') await writeFile(path.join(options.cwd, 'clip.mp4'), 'source');
    },
    subtitleService: {
      check: async options => {assert.equal(options.signal, signal); checked = true;},
      render: async options => {
        assert.equal(options.duration, 10);
        assert.equal(options.signal, signal);
        const output = path.join(options.directory, 'clip-captioned.mp4');
        await writeFile(output, 'captioned');
        return output;
      },
    },
  });
  const clip = await exporter.prepare({videoId: 'M7lc1UVf-VE', startSeconds: 0, endSeconds: 10, subtitles: true}, {signal});
  assert.match(clip.filename, /-subtitled\.mp4$/);
  assert.equal(await readFile(clip.filePath, 'utf8'), 'captioned');
  await clip.cleanup();
});

test('subtitle setup failure is reported before downloading and never silently returns an uncaptioned clip', async () => {
  const exporter = new ClipDownloadService({run: () => assert.fail('Must not download without setup')});
  await assert.rejects(exporter.prepare({videoId: 'M7lc1UVf-VE', startSeconds: 0, endSeconds: 10, subtitles: true}), {code: 'SUBTITLES_SETUP_REQUIRED'});
});
