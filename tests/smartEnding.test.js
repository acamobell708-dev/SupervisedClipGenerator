import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SMART_ENDING_RULES, suggestSmartEnding, snapSmartEnding } from '../src/domain/smartEnding.js';
import { selectTopClips, normaliseHeatmap } from '../src/domain/heatmapRanker.js';
import { SmartEndingService } from '../src/services/smartEndingService.js';
import { ClipDiscoveryService } from '../src/services/clipDiscoveryService.js';
import { createApp } from '../src/app.js';
import { getReviewClips, selectionManifest } from '../src/client/reviewClips.js';

const heatmap = (value, duration = 90) => Array.from({length: duration}, (_, at) => ({start_time: at, end_time: at + 1, value: value(at)}));
const dropping = heatmap(at => at < 18 ? 1 : 0.05);
const id = 'M7lc1UVf-VE';
const clipFor = (data = dropping, start = 0) => {
  const decision = suggestSmartEnding(normaliseHeatmap(data, 90), start, start + 25, 90);
  return {startSeconds: start, endSeconds: decision.endSeconds, smartEnding: decision};
};

test('Smart ending shortens a sustained weak tail after the peak, with a 15-second minimum', () => {
  const clip = clipFor();
  assert.equal(clip.endSeconds, 18);
  assert.equal(clip.smartEnding.reason, 'interest-drop');
  assert.equal(clip.smartEnding.evidence, 'public-replay-interest');
  assert.ok(clip.endSeconds > clip.smartEnding.peakAtSeconds);
  assert.equal(clipFor(heatmap(at => at < 10 ? 1 : 0.05)).endSeconds, 15);
});

test('Smart ending extends strong tails up to 30 seconds, without turning a temporary dip into a cut', () => {
  const extended = clipFor(heatmap(at => at < 28 ? 1 : 0.05));
  assert.equal(extended.endSeconds, 28);
  assert.equal(extended.smartEnding.reason, 'strong-ending');
  assert.equal(clipFor(heatmap(at => at < 40 ? 1 : 0.05)).endSeconds, 30);
  const recovered = clipFor(heatmap(at => at >= 18 && at < 20 || at >= 40 ? 0.05 : 1));
  assert.ok(recovered.endSeconds >= 25);
});

test('missing, gapped, overlapping or flat heatmap evidence cannot invent a shorter ending', () => {
  const flat = normaliseHeatmap(heatmap(() => 0.5), 90);
  for (const points of [[], flat, normaliseHeatmap(dropping.filter(point => point.start_time !== 20), 90),
    normaliseHeatmap([...dropping, dropping[20]], 90)]) {
    assert.equal(suggestSmartEnding(points, 0, 25, 90).endSeconds, 25);
  }
  const short = suggestSmartEnding(normaliseHeatmap(dropping, 12), 0, 12, 12);
  assert.equal(short.endSeconds, 12);
  assert.equal(short.reason, 'short-source');
});

test('ranking keeps smart windows non-overlapping and the setting off preserves fixed 25-second windows', () => {
  const data = heatmap(at => at < 18 || at >= 40 && at < 68 ? 1 : 0.05);
  const normal = selectTopClips(data, 90);
  assert.ok(normal.every(clip => clip.durationSeconds === 25 && !clip.smartEnding));
  const smart = selectTopClips(data, 90, {smartEnding: true});
  assert.ok(smart.some(clip => clip.durationSeconds !== 25));
  for (const clip of smart) {
    assert.ok(clip.durationSeconds >= 15 && clip.durationSeconds <= 30);
    for (const other of smart) if (clip !== other) assert.ok(clip.endSeconds <= other.startSeconds + 0.05 || other.endSeconds <= clip.startSeconds + 0.05);
  }
});

test('speech snapping prefers sentence/pause boundaries, stays within minimum/next-clip bounds and handles invalid words', () => {
  const clip = clipFor();
  const decision = snapSmartEnding(clip, [{start: 17, end: 17.8, text: 'Finished.'}, {start: 17.9, end: 18.02, text: 'Next'}]);
  assert.equal(decision.endSeconds, 17.8);
  assert.equal(decision.boundary, 'sentence');
  const paused = snapSmartEnding(clip, [{start: 17, end: 17.9, text: 'word'}, {start: 18.3, end: 18.7, text: 'next'}]);
  assert.equal(paused.boundary, 'pause');
  const capped = snapSmartEnding(clip, [{start: 18, end: 18.2, text: 'Too late.'}, {start: 17, end: 17.7, text: 'Okay.'}], 18);
  assert.equal(capped.endSeconds, 17.7);
  assert.equal(snapSmartEnding(clip, [null, {start: NaN, end: 18}, {start: 18, end: 17}]).endSeconds, 18);
  const offsetClip = {...clip, startSeconds: 100, smartEnding: {...clip.smartEnding, minimumEndSeconds: 115, peakAtSeconds: 117, endSeconds: 118, analysisEndSeconds: 130}};
  assert.equal(snapSmartEnding(offsetClip, [{start: 17, end: 17.8, text: 'Sentence.'}]).endSeconds, 117.8);
});

test('analysis API validates the option, forwards it, and demo supports both settings offline', async t => {
  const calls = [];
  const app = createApp({config: {}, service: {analyse: async (url, options) => {calls.push({url, options}); return {ok: true};}}});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const smartEnding of ['true', null, 1]) {
    const response = await fetch(`${base}/api/analyse`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: id, smartEnding})});
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
  for (const smartEnding of [true, false]) {
    const response = await fetch(`${base}/api/analyse`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: id, smartEnding})});
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).options.smartEnding, smartEnding);
    const demo = await (await fetch(`${base}/api/demo?smartEnding=${smartEnding}`)).json();
    assert.equal(demo.discoveryOptions.smartEnding, smartEnding);
    assert.equal(demo.status, 'demo');
  }
});
