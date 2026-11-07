import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { LowerVideoLibrary } from '../src/services/lowerVideoLibrary.js';
import { buildVideoFilterGraph } from '../src/domain/shortsLayout.js';
import { buildSubtitleAss } from '../src/domain/subtitles.js';
import { createTapeTimeline } from '../src/domain/tapeSlowdown.js';
import { ShortsExportService } from '../src/services/shortsExportService.js';
import { TapeSlowdownService } from '../src/services/tapeSlowdownService.js';
import { ClipDownloadService, validateClipDownload } from '../src/services/clipDownloadService.js';

const selection = {videoId: 'M7lc1UVf-VE', startSeconds: 0, endSeconds: 10};
const lower = {id: 'a'.repeat(16), label: 'Parkour', category: 'minecraft-parkour', filePath: path.join(tmpdir(), 'lower.mp4'), startSeconds: 1.25, outputDuration: 12.77};

test('library API returns all categories and downloads expose chosen asset metadata', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lower-api-test-'));
  const filePath = path.join(directory, 'clip.mp4');
  await writeFile(filePath, 'MP4');
  t.after(async () => {await unlink(filePath); await rmdir(directory);});
  const metadata = {id: lower.id, label: 'Parkour', category: lower.category, startSeconds: 2};
  const categories = [{id: 'minecraft-parkour', videos: [{id: lower.id}]}];
  const app = createApp({config: {}, service: {}, lowerVideoLibrary: {catalogue: async () => ({categories, warnings: []})},
    downloadService: {prepare: async request => {
      assert.equal(request.lowerVideoId, lower.id);
      return {filePath, filename: 'clip.mp4', lowerVideo: metadata, cleanup: async () => {}};
    }},
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const catalogue = await fetch(`${base}/api/lower-videos`);
  assert.equal(catalogue.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await catalogue.json()).categories, categories);
  const response = await fetch(`${base}/api/clips/download`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...selection, lowerVideo: true, lowerVideoId: lower.id})});
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(decodeURIComponent(response.headers.get('X-Lower-Video'))), metadata);
  await response.arrayBuffer();
});

test('library discovers category folders and legacy root videos, skips invalid files and caches probes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lower-library-test-'));
  const runner = path.join(directory, 'endless-runner');
  await mkdir(runner);
  const files = [path.join(directory, 'Edit1.mp4'), path.join(directory, 'broken.mp4'), path.join(directory, 'ignore.txt'), path.join(runner, 'run.webm')];
  for (const file of files) await writeFile(file, 'test');
  t.after(async () => {for (const file of files) await unlink(file); await rmdir(runner); await rmdir(directory);});
  let probes = 0;
  const library = new LowerVideoLibrary({directory, run: async (_binary, args) => {
    probes++;
    if (args.at(-1).endsWith('broken.mp4')) return '{}';
    return JSON.stringify({streams: [{codec_type: 'video', width: 1280, height: 720}], format: {duration: '30'}});
  }});
  const catalogue = await library.catalogue();
  assert.deepEqual(catalogue.categories.map(category => [category.label, category.videos.length]), [
    ['Minecraft Parkour', 1], ['Endless runner', 1], ['Satisfying video', 0],
  ]);
  assert.equal(catalogue.warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(catalogue), /filePath|lower-library-test/);
  await library.catalogue();
  assert.equal(probes, 4); // Valid files cached; invalid file retried on refresh.
  const id = catalogue.categories[0].videos[0].id;
  const selected = await library.select(id, 12.77);
  assert.equal(selected.filePath, files[0]);
  assert.ok(selected.startSeconds >= 0 && selected.startSeconds <= 30 - 12.77);
  assert.equal((await library.select(id, 45)).startSeconds, 0); // Short assets start at zero and loop.
  await assert.rejects(library.select('f'.repeat(16), 10), {code: 'LOWER_VIDEO_NOT_FOUND'});
});

test('random selection visits every asset before repeating and handles removed assets', async () => {
  const library = new LowerVideoLibrary({directory: tmpdir(), random: () => 0.5});
  const assets = new Map(['a', 'b', 'c'].map(id => [id, {id, duration: 30}]));
  library.scan = async () => ({assets});
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push((await library.select('random', 10)).id);
  assert.equal(new Set(ids.slice(0, 3)).size, 3);
  assert.equal(new Set(ids.slice(3)).size, 3);
  assert.notEqual(ids[2], ids[3]);
  assets.clear();
  await assert.rejects(library.select('random', 10), {code: 'LOWER_VIDEO_EMPTY'});
});

test('lower-video options reject arbitrary paths and non-booleans before acquisition', async () => {
  for (const lowerVideo of ['true', 1, null, {}]) assert.throws(() => validateClipDownload({...selection, lowerVideo}), {code: 'INVALID_LOWER_VIDEO_OPTION'});
  for (const lowerVideoId of ['../../secret.mp4', 'C:\\video.mp4', '', 1, {}, null]) assert.throws(() => validateClipDownload({...selection, lowerVideoId}), {code: 'INVALID_LOWER_VIDEO_ID'});
  assert.equal(validateClipDownload({...selection, lowerVideo: true, lowerVideoId: 'random'}).lowerVideo, true);
  await assert.rejects(new ClipDownloadService().prepare({...selection, lowerVideo: true}), {code: 'LOWER_VIDEO_UNAVAILABLE'});
});

test('split layout zooms the main footage, crops both panels and keeps captions above the divider', () => {
  const graph = buildVideoFilterGraph({lowerVideo: lower, subtitles: true, lowerInput: 2});
  const foreground = graph.split(';').find(part => part.startsWith('[foregroundSource]'));
  assert.match(foreground, /scale=972:1124:force_original_aspect_ratio=decrease/);
  assert.match(foreground, /crop=w='min\(iw,720\)':h='min\(ih,832\)'/);
  assert.match(graph, /\[2:v:0\]setpts=PTS-STARTPTS,fps=30,scale=720:448.*crop=720:448.*trim=duration=12.77/);
  assert.match(graph, /vstack=inputs=2:shortest=1/);
  assert.ok(graph.indexOf('ass=') > graph.indexOf('vstack='));
  const ass = buildSubtitleAss({width: 720, height: 1280, words: [{text: 'Hello.', start: 0, end: 1}]}, 10, {lowerVideo: true, portraitSafeArea: true});
  assert.match(ass, /Style: Default,Arial,46,/);
  assert.match(ass, /,2,86,86,508,1/); // Caption baseline y=772, above y=832 divider.
});

test('Shorts lower render loops footage, limits duration and maps only main audio', async () => {
  let args;
  await new ShortsExportService({run: async (_binary, values) => {args = values;}}).render({directory: tmpdir(), lowerVideo: lower});
  assert.equal(args[args.indexOf('-stream_loop') + 1], '-1');
  assert.equal(args[args.indexOf('-ss') + 1], '1.25');
  assert.equal(args[args.indexOf('-t') + 1], '12.77');
  assert.ok(args.includes('0:a:0?'));
  assert.ok(!args.includes('1:a:0'));
});

for (const hasAudio of [false, true]) {
  test(`tape layout keeps lower footage at normal speed and excludes its audio; main audio=${hasAudio}`, async () => {
    const calls = [];
    await new TapeSlowdownService({run: async (_binary, args) => calls.push(args)}).render({directory: tmpdir(),
      plan: {...createTapeTimeline(10), hasAudio}, lowerVideo: lower, subtitles: true});
    const args = calls.at(-1), graph = args[args.indexOf('-filter_complex') + 1];
    const lowerBranch = graph.split(';').find(part => part.startsWith(`[${hasAudio ? 2 : 1}:v:0]`));
    assert.match(lowerBranch, /setpts=PTS-STARTPTS,fps=30/);
    assert.doesNotMatch(lowerBranch, /log\(/);
    if (hasAudio) {assert.ok(args.includes('1:a:0')); assert.ok(!args.includes('2:a:0'));}
    else assert.ok(args.includes('-an'));
  });
}

for (const tapeSlowdown of [false, true]) {
  test(`download automatically enables Shorts and shares one render with captions; tape=${tapeSlowdown}`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'lower-export-test-'));
    t.after(() => rmdir(root));
    let rendered = 0;
    const render = async options => {
      rendered++;
      assert.equal(options.lowerVideo.id, lower.id);
      const file = path.join(options.directory, 'final.mp4');
      await writeFile(file, 'export');
      return file;
    };
    const library = {
      probe: async () => ({duration: 9.9}),
      select: async (id, duration) => {assert.equal(id, lower.id); assert.equal(duration, tapeSlowdown ? createTapeTimeline(10).outputDuration : 9.9); return {...lower, outputDuration: duration};},
    };
    const service = new ClipDownloadService({tempRoot: root, lowerVideoLibrary: library,
      run: async (binary, _args, options) => {if (binary === 'yt-dlp') await writeFile(path.join(options.cwd, 'clip.mp4'), 'original');},
      subtitleService: {check: async () => {}, prepareCaptions: async options => {assert.equal(options.shorts, true); assert.equal(options.lowerVideo, true);}},
      shortsService: {render},
      tapeService: {check: async () => {}, plan: async () => ({...createTapeTimeline(10), hasAudio: true}), render: options => {assert.equal(options.shorts, true); return render(options);}},
    });
    const clip = await service.prepare({...selection, subtitles: true, tapeSlowdown, lowerVideo: true, lowerVideoId: lower.id});
    assert.equal(rendered, 1);
    assert.equal(clip.lowerVideo.id, lower.id);
    assert.equal(clip.lowerVideo.filePath, undefined);
    assert.match(clip.filename, /-shorts-lower.mp4$/);
    await clip.cleanup();
  });
}
