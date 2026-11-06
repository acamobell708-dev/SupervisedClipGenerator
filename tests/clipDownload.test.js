import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClipDownloadService, runExportProcess, validateClipDownload } from '../src/services/clipDownloadService.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/utils/AppError.js';

const selection = {videoId: 'M7lc1UVf-VE', startSeconds: 70.5, endSeconds: 80.5};
const fakeMp4 = Buffer.from('mock MP4 bytes for HTTP transport testing');

async function tempRoot(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'clip-download-test-'));
  t.after(() => rmdir(directory)); // Fails if the service left any files behind.
  return directory;
}

test('download rejects malformed IDs, command injection and invalid ranges before running tools', async () => {
  const service = new ClipDownloadService({run: () => assert.fail('Must not spawn')});
  for (const input of [null, {}, {...selection, videoId: 'https://example.com/video'},
    {...selection, videoId: 'M7lc1UVf-VE;whoami'}, {...selection, startSeconds: -1},
    {...selection, startSeconds: '70'}, {...selection, endSeconds: Infinity},
    {...selection, endSeconds: 70.5}, {...selection, endSeconds: 86},
    {...selection, startSeconds: 700000, endSeconds: 700010}]) {
    await assert.rejects(service.prepare(input), {status: 400});
  }
  assert.deepEqual(validateClipDownload(selection), selection);
});

test('export uses exact selected range and canonical URL, returns MP4, and removes temporary files', async t => {
  const root = await tempRoot(t);
  const calls = [];
  const service = new ClipDownloadService({tempRoot: root, run: async (binary, args, options) => {
    calls.push({binary, args, options});
    if (binary === 'yt-dlp') await writeFile(path.join(options.cwd, 'clip.mp4'), fakeMp4);
  }});
  const clip = await service.prepare(selection);
  assert.equal(calls[0].binary, 'ffmpeg');
  assert.deepEqual(calls[0].args, ['-version']);
  assert.equal(calls[1].args[calls[1].args.indexOf('--download-sections') + 1], '*70.5-80.5');
  assert.ok(calls[1].args.includes('--ignore-config'));
  assert.ok(calls[1].args.includes('--force-keyframes-at-cuts'));
  assert.ok(!calls[1].args.includes('--ffmpeg-location'));
  assert.equal(calls[1].args.at(-1), 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  assert.match(clip.filename, /70\.5-80\.5\.mp4$/);
  assert.deepEqual(await readFile(clip.filePath), fakeMp4);
  await clip.cleanup();
  assert.deepEqual(await readdir(root), []);
});

test('failed exports clean partial files and allow retry', async t => {
  const root = await tempRoot(t);
  let produceEmptyFile = false;
  const service = new ClipDownloadService({tempRoot: root, run: async (binary, _args, options) => {
    if (binary === 'ffmpeg') return;
    await writeFile(path.join(options.cwd, produceEmptyFile ? 'clip.mp4' : 'clip.part'), '');
    if (!produceEmptyFile) throw new AppError('Extractor failed', 502, 'DOWNLOAD_FAILED');
  }});
  await assert.rejects(service.prepare(selection), {code: 'DOWNLOAD_FAILED'});
  assert.deepEqual(await readdir(root), []);
  produceEmptyFile = true;
  await assert.rejects(service.prepare(selection), {code: 'EMPTY_CLIP'});
  assert.deepEqual(await readdir(root), []);
  assert.equal(service.busy, false);
});

test('only one clip is prepared at a time', async () => {
  let finish;
  const service = new ClipDownloadService({run: () => new Promise((_resolve, reject) => {finish = reject;})});
  const first = service.prepare(selection);
  await assert.rejects(service.prepare(selection), {status: 409, code: 'DOWNLOAD_BUSY'});
  finish(new AppError('Missing tool', 503, 'DOWNLOAD_TOOL_MISSING'));
  await assert.rejects(first, {status: 503});
  assert.equal(service.busy, false);
});

test('process failures, missing tools, timeout and cancellation return actionable errors', async () => {
  await runExportProcess(process.execPath, ['-e', 'process.exit(0)']);
  await assert.rejects(runExportProcess('clipfoundry-missing-tool-for-test', []), {status: 503, code: 'DOWNLOAD_TOOL_MISSING'});
  await assert.rejects(runExportProcess(process.execPath, ['-e', 'process.exit(1)']), {code: 'DOWNLOAD_FAILED'});
  await assert.rejects(runExportProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {timeoutMs: 100}), {code: 'DOWNLOAD_TIMEOUT'});
  const controller = new AbortController();
  const task = runExportProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {signal: controller.signal});
  controller.abort();
  await assert.rejects(task, {code: 'DOWNLOAD_CANCELLED'});
});

async function api(t, downloadService) {
  const app = createApp({service: {}, downloadService, config: {}});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  return body => fetch(`http://127.0.0.1:${server.address().port}/api/clips/download`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
}

test('download API sends an MP4 attachment and cleans files after transmission', async t => {
  const root = await tempRoot(t);
  const exporter = new ClipDownloadService({tempRoot: root, run: async (binary, _args, options) => {
    if (binary === 'yt-dlp') await writeFile(path.join(options.cwd, 'clip.mp4'), fakeMp4);
  }});
  let cleaned;
  const cleanupDone = new Promise(resolve => {cleaned = resolve;});
  const post = await api(t, {prepare: async (...args) => {
    const clip = await exporter.prepare(...args);
    return {...clip, cleanup: async () => {await clip.cleanup(); cleaned();}};
  }});
  const response = await post(selection);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="?test-clip-M7lc1UVf-VE-70\.5-80\.5\.mp4"?$/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fakeMp4);
  await cleanupDone;
  assert.deepEqual(await readdir(root), []);
});

test('download API validates before export and returns tool errors as JSON', async t => {
  let calls = 0;
  const post = await api(t, {prepare: async () => {
    calls++;
    throw new AppError('Install FFmpeg, then restart the app.', 503, 'DOWNLOAD_TOOL_MISSING');
  }});
  const bad = await post({...selection, endSeconds: 100});
  assert.equal(bad.status, 400);
  assert.equal(calls, 0);
  const response = await post(selection);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'Install FFmpeg, then restart the app.');
});
