import test from 'node:test';
import assert from 'node:assert/strict';
import { firstSentence, getReviewClips, selectionManifest } from '../src/client/reviewClips.js';

const result = {
  video: {id: 'M7lc1UVf-VE', durationSeconds: 120},
  clips: [{id: 'clip-1', rank: 1, startSeconds: 20, endSeconds: 30, durationSeconds: 10, replayIntensityPercent: 95}],
  timestampComments: [
    {id: 'clip-1', atSeconds: 45, text: '0:45 is the highlight! I replayed this twice.', author: 'Viewer', likes: 42},
    {id: 'ending', atSeconds: 118, text: '1:58 great ending.', author: 'Another viewer', likes: 3},
  ],
};

test('timestamp cards follow replay cards and retain distinct identities, timestamps and first sentences', () => {
  const cards = getReviewClips(result);
  assert.equal(cards.length, 3);
  assert.equal(cards[0].sourceKind, 'replay');
  const comment = cards[1];
  assert.equal(comment.sourceKind, 'timestamp-comment');
  assert.notEqual(comment.id, cards[0].id);
  assert.equal(comment.startSeconds, 45);
  assert.equal(comment.endSeconds, 55);
  assert.equal(comment.durationSeconds, 10);
  assert.equal(comment.comment.excerpt, '0:45 is the highlight!');
  assert.equal(comment.comment.text, result.timestampComments[0].text);
  assert.equal(comment.comment.likes, 42);
  assert.match(comment.url, /&t=45s$/);
  assert.equal(comment.replayIntensityPercent, undefined);
});

test('comment windows clamp to the video end and remain available without replay data', () => {
  const cards = getReviewClips({...result, clips: []});
  assert.equal(cards[0].startSeconds, 45);
  assert.equal(cards[1].endSeconds, 120);
  assert.equal(cards[1].durationSeconds, 2);
  assert.deepEqual(getReviewClips(null), []);
});

test('approval export includes comment clips and replay clips, with no ID collision or unapproved clips', () => {
  const cards = getReviewClips(result);
  const manifest = selectionManifest(result, new Set([cards[0].id, cards[2].id]));
  assert.deepEqual(manifest.selectedClips.map(clip => clip.id), [cards[0].id, cards[2].id]);
  assert.equal(manifest.selectedClips[1].comment.id, 'ending');
  assert.equal(manifest.selectedClips[1].endSeconds, 120);
  const commentOnly = selectionManifest(result, new Set([cards[1].id]));
  assert.equal(commentOnly.selectedClips.length, 1);
  assert.equal(commentOnly.selectedClips[0].startSeconds, 45);
});

test('sentence excerpts handle timestamps, decimals, punctuation and missing text', () => {
  assert.equal(firstSentence('  At 1:23 this gets 9.5 out of 10! More commentary. '), 'At 1:23 this gets 9.5 out of 10!');
  assert.equal(firstSentence('One sentence without punctuation'), 'One sentence without punctuation');
  assert.equal(firstSentence(''), '');
  assert.equal(firstSentence(null), '');
});
