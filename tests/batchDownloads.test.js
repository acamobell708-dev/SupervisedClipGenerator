import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipZip, fetchClipBlob, prepareApprovedDownload } from '../src/client/batchDownloads.js';
import { getReviewClips } from '../src/client/reviewClips.js';

const result = {
  video: {id: 'M7lc1UVf-VE', durationSeconds: 120},
  clips: [{id: 'replay-1', startSeconds: 10, endSeconds: 20}, {id: 'replay-2', startSeconds: 30, endSeconds: 40}],
  timestampComments: [{id: 'comment-1', atSeconds: 45, text: '0:45 was great!', likes: 4}],
};

function readStoredZip(buffer) {
  const view = new DataView(buffer);
  const data = new Uint8Array(buffer);
  const footer = data.length - 22;
  assert.equal(view.getUint32(footer, true), 0x06054b50);
  const count = view.getUint16(footer + 10, true);
  let cursor = view.getUint32(footer + 16, true);
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    assert.equal(view.getUint16(cursor + 10, true), 0); // Stored, no compression.
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const local = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(data.slice(cursor + 46, cursor + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint32(local + 14, true), view.getUint32(cursor + 16, true));
    const contentStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, {text: new TextDecoder().decode(data.slice(contentStart, contentStart + size)), crc: view.getUint32(cursor + 16, true)});
    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  assert.equal(cursor, footer);
  return files;
}

test('batch downloads only approved replay and comment clips sequentially into one ZIP', async () => {
  const cards = getReviewClips(result);
  const approved = new Set([cards[0].id, cards[2].id]);
  const fetched = [], progress = [];
  let active = 0;
  const archive = await prepareApprovedDownload({result, approved,
    onProgress: step => {progress.push(step); approved.clear();},
    fetchClip: async (videoId, clip) => {
      assert.equal(videoId, result.video.id);
      assert.equal(active++, 0);
      await Promise.resolve();
      fetched.push(clip.id);
      active--;
      return new Blob([`MP4 for ${clip.startSeconds}`]);
    },
  });
  assert.deepEqual(fetched, [cards[0].id, cards[2].id]);
  assert.deepEqual(progress.map(step => [step.index, step.total, !!step.packing]), [[1, 2, false], [2, 2, false], [2, 2, true]]);
  assert.equal(archive.type, 'application/zip');
  const files = readStoredZip(await archive.arrayBuffer());
  assert.equal(files.get('01-replay-10-20.mp4').text, 'MP4 for 10');
  assert.equal(files.get('02-timestamp-comment-45-55.mp4').text, 'MP4 for 45');
  const manifest = JSON.parse(files.get('selections.json').text);
  assert.deepEqual(manifest.selectedClips.map(clip => clip.id), fetched);
  assert.equal(files.size, 3);
});

test('ZIP headers contain correct CRC-32 and preserve UTF-8 filenames', async () => {
  const blob = await createClipZip([{name: 'vidéo.mp4', blob: new Blob(['123456789'])}]);
  const entry = readStoredZip(await blob.arrayBuffer()).get('vidéo.mp4');
  assert.equal(entry.text, '123456789');
  assert.equal(entry.crc, 0xcbf43926); // Standard CRC-32 test vector.
});

test('empty approval selection makes no download requests', async () => {
  await assert.rejects(prepareApprovedDownload({result, approved: new Set(), fetchClip: () => assert.fail('Unexpected download')}), /Approve at least one/);
});

test('cancellation stops the batch before the next clip and returns no partial ZIP', async () => {
  const controller = new AbortController();
  let count = 0;
  await assert.rejects(prepareApprovedDownload({result, approved: new Set(getReviewClips(result).map(clip => clip.id)), signal: controller.signal,
    fetchClip: async (_videoId, _clip, signal) => {
      assert.equal(signal, controller.signal);
      count++;
      controller.abort();
      return new Blob(['MP4']);
    },
  }), {name: 'AbortError'});
  assert.equal(count, 1);
});

test('a failed clip stops further requests instead of silently skipping approved clips', async () => {
  let count = 0;
  await assert.rejects(prepareApprovedDownload({result, approved: new Set(getReviewClips(result).map(clip => clip.id)),
    fetchClip: async () => {
      if (++count === 2) throw new Error('Extraction unavailable');
      return new Blob(['MP4']);
    },
  }), /Extraction unavailable/);
  assert.equal(count, 2);
});

test('clip fetch forwards the range and abort signal and rejects JSON errors and empty media', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.signal, controller.signal);
    assert.deepEqual(JSON.parse(options.body), {videoId: result.video.id, startSeconds: 45, endSeconds: 55});
    return new Response(JSON.stringify({error: 'Install FFmpeg'}), {status: 503, headers: {'Content-Type': 'application/json'}});
  });
  await assert.rejects(fetchClipBlob(result.video.id, getReviewClips(result)[2], controller.signal), /Install FFmpeg/);
  globalThis.fetch.mock.mockImplementation(async () => new Response(new Blob([])));
  await assert.rejects(fetchClipBlob(result.video.id, getReviewClips(result)[0]), /empty/);
});
