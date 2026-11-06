import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { getReviewClips } from '../src/client/reviewClips.js';

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
