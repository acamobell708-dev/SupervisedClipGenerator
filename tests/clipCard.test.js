import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { getReviewClips } from '../src/client/reviewClips.js';
import { formatClipTime } from '../src/client/formatters.js';

// Load the real JSX component with the same compiler used by the application.
const bundle = await build({
  entryPoints: ['src/client/ClipCard.jsx'], bundle: true, platform: 'node',
  format: 'esm', jsx: 'automatic', write: false, logLevel: 'silent',
});
const { ClipCard } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}

test('smart clip review exposes the exact speech boundary and disables approval during re-analysis', () => {
  const card = ClipCard({clip: {id: 'smart', sourceKind: 'replay', rank: 1, startSeconds: 0, endSeconds: 17.52,
    durationSeconds: 17.52, replayIntensityPercent: 90, smartEnding: {originalEndSeconds: 25, boundary: 'sentence'}},
    selected: true, approved: false, approvalDisabled: true});
  const nodes = elements(card);
  assert.ok(nodes.some(node => node.props?.['aria-label']?.includes('0:17.52')));
  assert.equal(nodes.find(node => node.props?.className === 'approval-button ').props.disabled, true);
  assert.ok(nodes.some(node => node.props?.className === 'clip-ending-note'));
  assert.equal(formatClipTime(17.52), '0:17.52');
  assert.equal(formatClipTime(59.9999), '1:00');
  assert.equal(formatClipTime(3601.125), '1:00:01.125');
});

test('pending speech checks disable approval and download until the displayed ending is final', () => {
  const card = ClipCard({clip: {id: 'pending', sourceKind: 'replay', rank: 1, startSeconds: 0, endSeconds: 18,
    durationSeconds: 18, replayIntensityPercent: 90, smartEnding: {originalEndSeconds: 25, status: 'pending'}},
    selected: false, approved: false});
  const buttons = elements(card).filter(node => node.type === 'button');
  assert.equal(buttons.find(node => node.props.className.startsWith('approval-button')).props.disabled, true);
  assert.equal(buttons.find(node => node.props.className === 'clip-download-button').props.disabled, true);
  assert.equal(buttons.find(node => node.props.className === 'clip-select').props.disabled, undefined);
});

const clips = getReviewClips({
  video: {id: 'M7lc1UVf-VE', durationSeconds: 120},
  clips: [{id: 'replay-1', rank: 1, startSeconds: 10, endSeconds: 20, durationSeconds: 10, replayIntensityPercent: 90}],
  timestampComments: [{id: 'comment-1', atSeconds: 45, text: '0:45 excellent moment! More text.', author: 'Viewer', likes: 25}],
});

for (const clip of clips) {
  test(`${clip.sourceKind} card independently selects, approves and downloads its own window`, () => {
    const selected = [], approved = [], downloaded = [];
    const card = ClipCard({clip, selected: false, approved: false,
      onPreview: value => selected.push(value), onApprove: id => approved.push(id),
      onDownload: value => downloaded.push(value), downloadDisabled: false,
    });
    const buttons = elements(card).filter(node => node.type === 'button');
    const select = buttons.find(node => node.props.className === 'clip-select');
    assert.equal(select.props.type, 'button'); // Native Enter/Space support without nested actions.
    assert.equal(select.props['aria-pressed'], false);
    assert.match(select.props['aria-label'], /Preview .* clip from/);
    select.props.onClick();
    assert.deepEqual(selected, [clip]);
    buttons.find(node => node.props['aria-label']?.startsWith('Download clip from ')).props.onClick();
    assert.deepEqual(downloaded, [clip]);
    buttons.find(node => node.props['aria-pressed'] === false && node !== select).props.onClick();
    assert.deepEqual(approved, [clip.id]);
    assert.equal(selected.length, 1); // Action buttons are siblings, not children of the selection button.
    assert.equal(select.props.children, undefined);
  });
}
