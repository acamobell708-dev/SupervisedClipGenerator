import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SHORTS_DIMENSIONS, buildVideoFilterGraph } from '../src/domain/shortsLayout.js';
import { createTapeTimeline } from '../src/domain/tapeSlowdown.js';
import { ShortsExportService } from '../src/services/shortsExportService.js';
import { LocalSubtitleService } from '../src/services/localSubtitleService.js';
import { TapeSlowdownService } from '../src/services/tapeSlowdownService.js';
import { ClipDownloadService, validateClipDownload } from '../src/services/clipDownloadService.js';

const selection = {videoId: 'M7lc1UVf-VE', startSeconds: 0, endSeconds: 10};

test('Shorts graph fits the full foreground and only crops/blurs the background', () => {
  assert.deepEqual(SHORTS_DIMENSIONS, {width: 720, height: 1280});
  const graph = buildVideoFilterGraph({shorts: true});
  const foreground = graph.split(';').find(branch => branch.startsWith('[foregroundSource]'));
  const background = graph.split(';').find(branch => branch.startsWith('[backgroundSource]'));
  assert.match(foreground, /scale=720:1280:force_original_aspect_ratio=decrease/);
  assert.doesNotMatch(foreground, /crop|blur/);
  assert.match(background, /force_original_aspect_ratio=increase.*crop=720:1280.*gblur=/);
  assert.match(graph, /overlay=\(W-w\)\/2:\(H-h\)\/2/);
  assert.match(graph, /setsar=1,format=yuv420p\[video\]$/);
});

test('composition applies timing before portrait layout and captions after overlay', () => {
  const graph = buildVideoFilterGraph({beforeLayout: createTapeTimeline(10).videoFilter, shorts: true, subtitles: true});
  assert.ok(graph.indexOf('log(') < graph.indexOf('split=2'));
  assert.ok(graph.indexOf('overlay=') < graph.indexOf('ass=captions.ass'));
  assert.equal(graph.match(/ass=captions.ass/g).length, 1);
  assert.doesNotMatch(buildVideoFilterGraph({shorts: false, subtitles: true}), /gblur|overlay|crop/);
});

test('Shorts renders in one FFmpeg call with portrait H.264/AAC settings and optional audio', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const service = new ShortsExportService({run: async (...args) => calls.push(args)});
  const directory = path.join(tmpdir(), 'shorts-render-unit');
  assert.equal(await service.render({directory, subtitles: true, signal}), path.join(directory, 'clip-shorts.mp4'));
  assert.equal(calls.length, 1);
  const [binary, args, options] = calls[0];
  assert.equal(binary, 'ffmpeg');
  assert.equal(options.signal, signal);
  assert.equal(options.cwd, directory);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('0:a:0?'));
  assert.match(args[args.indexOf('-filter_complex') + 1], /overlay=.*ass=captions.ass/);
});

test('portrait subtitle preparation uses final canvas dimensions and wider safe margins', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'shorts-captions-test-'));
  t.after(async () => {await unlink(path.join(directory, 'transcript.json')); await unlink(path.join(directory, 'captions.ass')); await rmdir(directory);});
  const service = new LocalSubtitleService({run: async (_binary, args) => {
    await writeFile(args[args.indexOf('--output') + 1], JSON.stringify({width: 1280, height: 720,
      words: [{text: 'Portrait captions.', start: 5, end: 6}]}));
  }});
  await service.prepareCaptions({filePath: 'original.mp4', directory, duration: 10, shorts: true, mapTime: createTapeTimeline(10).mapTime});
  const ass = await readFile(path.join(directory, 'captions.ass'), 'utf8');
  assert.match(ass, /PlayResX: 720\nPlayResY: 1280/);
  assert.match(ass, /Style: Default,Arial,70,/);
  assert.match(ass, /,2,86,86,205,1/);
  assert.match(ass, /0:00:05\.58,0:00:06\.86/);
});

test('Shorts option rejects non-booleans and unsupported export before acquisition', async () => {
  for (const value of [1, 'true', {}, null]) assert.throws(() => validateClipDownload({...selection, shorts: value}), {code: 'INVALID_SHORTS_OPTION'});
  assert.equal(validateClipDownload({...selection, shorts: true}).shorts, true);
  const service = new ClipDownloadService({run: () => assert.fail('Must not acquire')});
  await assert.rejects(service.prepare({...selection, shorts: true}), {code: 'SHORTS_UNAVAILABLE'});
});

for (const options of [
  {subtitles: false, tapeSlowdown: false},
  {subtitles: true, tapeSlowdown: false},
  {subtitles: true, tapeSlowdown: true},
]) {
  test(`Shorts export composes effects once: captions=${options.subtitles}, tape=${options.tapeSlowdown}`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'shorts-export-test-'));
    t.after(() => rmdir(root));
    let renderCount = 0, prepared = false;
    const signal = new AbortController().signal;
    const finalRender = async renderOptions => {
      renderCount++;
      assert.equal(renderOptions.subtitles, options.subtitles);
      assert.equal(renderOptions.signal, signal);
      if (options.subtitles) assert.ok(prepared);
      const file = path.join(renderOptions.directory, 'portrait.mp4');
      await writeFile(file, 'portrait MP4');
      return file;
    };
    const exporter = new ClipDownloadService({tempRoot: root,
      run: async (binary, _args, processOptions) => {if (binary === 'yt-dlp') await writeFile(path.join(processOptions.cwd, 'clip.mp4'), 'original');},
      subtitleService: options.subtitles ? {
        check: async () => {}, render: () => assert.fail('Must not pre-render landscape captions'),
        prepareCaptions: async args => {assert.equal(args.shorts, true); assert.equal(await readFile(args.filePath, 'utf8'), 'original'); prepared = true;},
      } : undefined,
      shortsService: {render: args => {assert.ok(!options.tapeSlowdown); return finalRender(args);}},
      tapeService: options.tapeSlowdown ? {check: async () => {}, plan: async () => ({...createTapeTimeline(10), hasAudio: true}),
        render: args => {assert.equal(args.shorts, true); return finalRender(args);},
      } : undefined,
    });
    const clip = await exporter.prepare({...selection, ...options, shorts: true}, {signal});
    assert.equal(renderCount, 1);
    assert.match(clip.filename, /-shorts\.mp4$/);
    assert.equal(await readFile(clip.filePath, 'utf8'), 'portrait MP4');
    await clip.cleanup();
  });
}

test('tape plus Shorts shares one graph and one final video encode', async () => {
  const calls = [];
  const service = new TapeSlowdownService({run: async (...args) => calls.push(args)});
  await service.render({directory: tmpdir(), plan: {...createTapeTimeline(10), hasAudio: true}, shorts: true, subtitles: true});
  assert.equal(calls.length, 2); // Python audio preparation followed by one FFmpeg render.
  assert.equal(calls[1][0], 'ffmpeg');
  const graph = calls[1][1][calls[1][1].indexOf('-filter_complex') + 1];
  assert.match(graph, /log\(/);
  assert.match(graph, /gblur=/);
  assert.match(graph, /overlay=.*ass=captions.ass/);
});
