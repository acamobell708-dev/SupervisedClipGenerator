import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { ClipDiscoveryService } from '../src/services/clipDiscoveryService.js';
import { SmartEndingService } from '../src/services/smartEndingService.js';
import { AudioExcerptService } from '../src/services/audioExcerptService.js';
import { TranscriptionWorker } from '../src/services/transcriptionWorker.js';
import { YtDlpClient } from '../src/services/ytDlpClient.js';
import { EndingChecks } from '../src/client/endingChecks.js';
import { getReviewClips, applyRefinedClip, selectionManifest, needsEndingCheck } from '../src/domain/reviewClips.js';
import { WorkQueue } from '../src/utils/asyncWork.js';
import { createApp } from '../src/app.js';

const id = 'M7lc1UVf-VE';
const raw = {duration: 90, heatmap: Array.from({length: 90}, (_, at) => ({start_time: at, end_time: at + 1, value: at < 18 ? 1 : 0.05}))};
const fixture = () => ({video: {id, durationSeconds: 90}, clips: [{id: 'replay-1', startSeconds: 0, endSeconds: 18,
  durationSeconds: 18, smartEnding: {originalEndSeconds: 25, endSeconds: 18, analysisEndSeconds: 30,
    minimumEndSeconds: 15, peakAtSeconds: 17, reason: 'interest-drop', boundary: 'heatmap'}}], timestampComments: []});
const tick = () => new Promise(resolve => setImmediate(resolve));

async function workspace(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fast-ending-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith('fast-ending-test-'));
    await rm(directory, {recursive: true, force: true, maxRetries: 3});
  });
  return directory;
}

test('discovery fetches metadata/comments concurrently and never downloads or transcribes candidates', async () => {
  let metadataDone, commentsDone;
  const service = new ClipDiscoveryService({ytDlpClient: {
    getVideo: () => new Promise(resolve => {metadataDone = resolve;}),
    getTopComments: () => new Promise(resolve => {commentsDone = resolve;}),
  }, smartEndingService: {register: async result => {assert.ok(result.clips.length);},
    refineToken: () => assert.fail('Analysis must not acquire audio')}});
  const pending = service.analyse(id, {smartEnding: true});
  await tick();
  assert.equal(typeof metadataDone, 'function');
  assert.equal(typeof commentsDone, 'function');
  metadataDone(raw); commentsDone([]);
  const result = await pending;
  assert.equal(result.clips[0].endSeconds, 18);
  assert.equal(result.discoveryOptions.speechAlignment, 'on-selection');
  assert.ok(Number.isFinite(result.timings.totalMs));
});

test('initial comment wait preserves replay results while comments continue; the overall deadline cancels hung metadata', async t => {
  const service = new ClipDiscoveryService({commentTimeoutMs: 20, analysisTimeoutMs: 200,
    ytDlpClient: {getVideo: async () => raw, getTopComments: () => new Promise(() => {})}});
  t.after(() => service.close());
  const result = await service.analyse(id);
  assert.ok(result.clips.length);
  assert.equal(result.sources.comments, 'pending');
  assert.equal(result.commentsStatus.state, 'loading');
  assert.ok(!result.warnings.some(warning => warning.includes('No timestamped')));
  let signal;
  service.analysisTimeoutMs = 20;
  service.ytDlp.getVideo = (_id, options) => {signal = options.signal; return new Promise(() => {});};
  await assert.rejects(service.analyse(id), {code: 'ANALYSIS_TIMEOUT'});
  assert.equal(signal.aborted, true);
  const controller = new AbortController();
  const cancelled = service.analyse(id, {signal: controller.signal});
  controller.abort();
  await assert.rejects(cancelled, {name: 'AbortError'});
});

test('metadata and comment caches avoid repeat extractor calls and retain bounded output capture', async () => {
  const calls = [];
  const client = new YtDlpClient({run: async (_binary, args, options) => {
    calls.push(args); assert.equal(options.maxStdoutBytes, 12 * 1024 * 1024);
    return JSON.stringify({...raw, comments: [{id: 'one', text: '0:00', like_count: 1}]});
  }});
  await client.getVideo(id); await client.getVideo(id);
  await client.getTopComments(id); await client.getTopComments(id);
  assert.equal(calls.length, 2);
});

test('audio excerpt downloads only bestaudio, reuses metadata, caches before download and cleans temporary work', async t => {
  const directory = await workspace(t);
  const cacheRoot = path.join(directory, 'cache');
  let metadataCalls = 0;
  const calls = [];
  const audio = new AudioExcerptService({cacheRoot, tempRoot: directory, ytDlpClient: {getVideo: async () => {metadataCalls++; return raw;}},
    run: async (binary, args, options) => {
      calls.push({binary, args, cwd: options.cwd});
      if (binary === 'yt-dlp') {
        assert.equal(args[args.indexOf('-f') + 1], 'bestaudio');
        assert.ok(args.includes('--load-info-json'));
        assert.ok(!args.includes('--force-keyframes-at-cuts'));
        assert.equal(JSON.parse(await readFile(path.join(options.cwd, 'source.json'))).duration, 90);
        await writeFile(path.join(options.cwd, 'audio.m4a'), 'audio');
      } else {
        assert.ok(args.includes('-vn')); assert.ok(!args.includes('libx264'));
        await writeFile(path.join(options.cwd, 'excerpt.wav'), Buffer.alloc(1024));
      }
    }});
  const first = await audio.acquire(id, 10, 22);
  const second = await audio.acquire(id, 10, 22);
  assert.equal(first.cached, false); assert.equal(second.cached, true);
  assert.equal(calls.length, 2); assert.equal(metadataCalls, 1);
  await assert.rejects(readFile(path.join(calls[0].cwd, 'source.json')), {code: 'ENOENT'});
  await assert.rejects(audio.acquire(id, 0, 20), {code: 'INVALID_AUDIO_EXCERPT'});
});

test('bounded downloads admit two jobs while cancelled queued jobs do not consume a slot', async () => {
  const queue = new WorkQueue(2);
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  let active = 0, maximum = 0;
  const task = () => queue.run(async () => {maximum = Math.max(maximum, ++active); await gate; active--;});
  const first = task(), second = task();
  const controller = new AbortController();
  const cancelled = queue.run(() => assert.fail('Cancelled queue entry ran'), controller.signal);
  controller.abort();
  await assert.rejects(cancelled, {name: 'AbortError'});
  const third = task();
  release(); await Promise.all([first, second, third]);
  assert.equal(maximum, 2); assert.equal(queue.active, 0);
});

async function endingService(t, overrides = {}) {
  const directory = await workspace(t);
  let acquisitions = 0, transcriptions = 0;
  const service = new SmartEndingService({cacheRoot: directory, audioService: {acquire: async (_id, start, end) => {
    acquisitions++; assert.equal(start, 10); assert.equal(end, 22);
    return {filePath: 'cached.wav', startSeconds: start, endSeconds: end, cached: false};
  }}, subtitleService: {model: 'base', language: 'auto', transcribe: async () => {
    transcriptions++; return {words: [{start: 7, end: 7.8, text: 'Done.'}]};
  }}, ...overrides});
  return {service, counts: () => [acquisitions, transcriptions]};
}

test('selection refines a short audio excerpt with correct absolute offsets; cached decisions bypass all media work', async t => {
  const {service, counts} = await endingService(t);
  const result = fixture();
  await service.register(result);
  assert.deepEqual(counts(), [0, 0]);
  const clip = getReviewClips(result)[0];
  assert.equal(clip.smartEnding.status, 'pending');
  const refined = await service.refineToken(clip.refinementToken);
  assert.equal(refined.clip.endSeconds, 17.8);
  assert.equal(refined.clip.smartEnding.boundary, 'sentence');
  assert.equal(refined.clip.smartEnding.status, 'complete');
  assert.deepEqual(counts(), [1, 1]);
  await service.refineToken(clip.refinementToken);
  const next = fixture(); await service.register(next);
  assert.equal(next.clips[0].endSeconds, 17.8);
  assert.equal(next.clips[0].smartEnding.status, 'complete');
  assert.deepEqual(counts(), [1, 1]);
});

test('ending-check deadlines preserve the heatmap cut; request cancellation stays cancellable and tokens are validated', async t => {
  const {service} = await endingService(t, {timeoutMs: 20, audioService: {acquire: () => new Promise(() => {})}});
  const result = fixture(); await service.register(result);
  const token = result.clips[0].refinementToken;
  const fallback = await service.refineToken(token);
  assert.equal(fallback.clip.endSeconds, 18);
  assert.equal(fallback.clip.smartEnding.status, 'estimated');
  assert.match(fallback.clip.smartEnding.warning, /timed out/);
  await assert.rejects(service.refineToken('../../secret'), {code: 'INVALID_REFINEMENT_TOKEN'});
  await assert.rejects(service.refineToken('00000000-0000-0000-0000-000000000000'), {code: 'REFINEMENT_EXPIRED'});
  const next = fixture(); await service.register(next);
  const controller = new AbortController();
  const pending = service.refineToken(next.clips[0].refinementToken, {signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
});

test('persistent worker keeps one process/model across clips and restarts cleanly after an aborted active request', async t => {
  const directory = await workspace(t);
  const scriptPath = path.join(directory, 'fake-worker.mjs');
  await writeFile(scriptPath, `import {createInterface} from 'node:readline';
let modelLoads=0;
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);
 if(request.filePath==='hang') return;
 if(request.method==='warm'||request.method==='transcribe') modelLoads=1;
 const result=request.method==='transcribe'?{words:[{start:0,end:1,text:'Speech.'}],width:1,height:1}:{ready:true,modelLoads};
 process.stdout.write(JSON.stringify({id:request.id,result,modelLoads})+'\\n');
});`);
  const worker = new TranscriptionWorker({pythonPath: process.execPath, scriptPath});
  t.after(() => worker.close());
  await worker.warm();
  const pid = worker.child.pid;
  await worker.transcribe('first.wav'); await worker.transcribe('second.wav');
  assert.equal(worker.child.pid, pid); assert.equal(worker.modelLoads, 1);
  const controller = new AbortController();
  const pending = worker.transcribe('hang', {signal: controller.signal});
  await tick(); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  await worker.transcribe('third.wav');
  assert.notEqual(worker.child.pid, pid); assert.equal(worker.modelLoads, 1);
});

test('client deduplicates selected-clip checks, rejects stale updates and never changes approved clips', async () => {
  const clip = {...getReviewClips(fixture())[0], refinementToken: 'token', smartEnding: {...fixture().clips[0].smartEnding, status: 'pending'}};
  const updates = []; let resolveFetch;
  let approved = false;
  const checks = new EndingChecks({onUpdate: value => updates.push(value), isApproved: () => approved,
    fetchImpl: () => new Promise(resolve => {resolveFetch = resolve;})});
  const first = checks.check(clip);
  assert.equal(checks.check(clip), first);
  await tick(); checks.reset();
  resolveFetch(new Response(JSON.stringify({clip: {...clip, endSeconds: 17.8, smartEnding: {...clip.smartEnding, status: 'complete'}}})));
  await first;
  assert.equal(updates.length, 1);
  const next = checks.check(clip); await tick(); approved = true;
  resolveFetch(new Response(JSON.stringify({clip: {...clip, endSeconds: 17.8, smartEnding: {...clip.smartEnding, status: 'complete'}}})));
  await next;
  assert.equal(updates.length, 2); // Only the two initial 'checking' updates.
  assert.equal(applyRefinedClip(fixture(), clip, new Set([clip.id])).clips[0].endSeconds, 18);
});

test('client timeout/error keeps an approvable labelled heatmap ending; manifests omit temporary tokens', async () => {
  const clip = {...getReviewClips(fixture())[0], refinementToken: 'token', smartEnding: {...fixture().clips[0].smartEnding, status: 'pending'}};
  const updates = [];
  const checks = new EndingChecks({onUpdate: value => updates.push(value), fetchImpl: async () => {throw new Error('Offline');}});
  const updated = await checks.check(clip);
  assert.equal(updated.endSeconds, 18); assert.equal(needsEndingCheck(updated), false);
  assert.equal(updates.at(-1).smartEnding.status, 'estimated');
  const result = applyRefinedClip(fixture(), updated);
  assert.equal(selectionManifest(result, new Set([clip.id])).selectedClips[0].refinementToken, undefined);
});

test('refinement API resolves server-issued tokens and analysis publishes timings', async t => {
  const {service: smartEndingService} = await endingService(t);
  const discovery = new ClipDiscoveryService({smartEndingService, ytDlpClient: {getVideo: async () => raw, getTopComments: async () => []}});
  const server = createApp({service: discovery, smartEndingService, config: {}}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data) => fetch(`${base}${route}`, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)});
  const analysis = await post('/api/analyse', {url: id, smartEnding: true});
  assert.equal(analysis.status, 200); assert.match(analysis.headers.get('server-timing'), /totalMs;dur=/);
  const data = await analysis.json();
  const response = await post('/api/clips/refine-ending', {token: data.clips[0].refinementToken});
  assert.equal(response.status, 200); assert.equal((await response.json()).clip.endSeconds, 17.8);
  assert.equal((await post('/api/clips/refine-ending', {token: 'bad'})).status, 400);
});
