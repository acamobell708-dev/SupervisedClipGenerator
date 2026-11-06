const sentenceSegmenter = new Intl.Segmenter('en', {granularity: 'sentence'});

export function firstSentence(text) {
  const value = String(text ?? '').trim();
  return sentenceSegmenter.segment(value)[Symbol.iterator]().next().value?.segment.trim() || '';
}

// Both evidence sources share one selection, approval, export and download model.
export function getReviewClips(result) {
  if (!result) return [];
  const replayClips = (result.clips || []).map(clip => ({...clip, sourceKind: 'replay'}));
  const commentClips = (result.timestampComments || []).map(comment => {
    const startSeconds = comment.atSeconds;
    const endSeconds = Math.min(result.video.durationSeconds, startSeconds + 10);
    return {
      id: `timestamp-comment:${comment.id}:${startSeconds}`,
      sourceKind: 'timestamp-comment',
      startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds,
      url: `https://www.youtube.com/watch?v=${result.video.id}&t=${Math.floor(startSeconds)}s`,
      comment: {...comment, excerpt: firstSentence(comment.text)},
    };
  }).filter(clip => clip.durationSeconds > 0);
  return [...replayClips, ...commentClips];
}

export function selectionManifest(result, approved) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    video: result.video,
    selectedClips: getReviewClips(result).filter(clip => approved.has(clip.id)),
    note: 'Selection manifest contains time windows only. It does not download, edit, or upload video.',
  };
}
