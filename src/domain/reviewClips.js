import { DEFAULT_CLIP_SECONDS, MAX_CLIP_SECONDS } from './clipDuration.js';

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
    const proposedEnd = Number.isFinite(comment.endSeconds) && comment.endSeconds > startSeconds
      ? comment.endSeconds : startSeconds + DEFAULT_CLIP_SECONDS;
    const endSeconds = Math.min(result.video.durationSeconds, startSeconds + MAX_CLIP_SECONDS, proposedEnd);
    return {
      id: `timestamp-comment:${comment.id}:${startSeconds}`,
      sourceKind: 'timestamp-comment',
      startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds,
      url: `https://www.youtube.com/watch?v=${result.video.id}&t=${Math.floor(startSeconds)}s`,
      comment: {...comment, excerpt: firstSentence(comment.text)},
      ...(comment.smartEnding ? {smartEnding: comment.smartEnding} : {}),
      ...(comment.refinementToken ? {refinementToken: comment.refinementToken} : {}),
    };
  }).filter(clip => clip.durationSeconds > 0);
  return [...replayClips, ...commentClips];
}

export function selectionManifest(result, approved) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    video: result.video,
    ...(result.discoveryOptions ? {discoveryOptions: result.discoveryOptions} : {}),
    selectedClips: getReviewClips(result).filter(clip => approved.has(clip.id)).map(({refinementToken: _token, ...clip}) => {
      if (!clip.comment) return clip;
      const {refinementToken: _commentToken, ...comment} = clip.comment;
      return {...clip, comment};
    }),
    note: 'Selection manifest contains time windows only. It does not download, edit, or upload video.',
  };
}

export function needsEndingCheck(clip) {return ['pending','checking'].includes(clip?.smartEnding?.status);}

export function mergeCommentUpdate(result, patch, approved = new Set()) {
  if (!result || result.commentsStatus?.token !== patch.commentsStatus?.token) return result;
  const keepComments = getReviewClips(result).some(clip => clip.sourceKind === 'timestamp-comment' && approved.has(clip.id));
  return {...result, commentsStatus: patch.commentsStatus,
    timestampComments: keepComments ? result.timestampComments : patch.timestampComments ?? result.timestampComments,
    sources: {...result.sources, ...patch.sources},
    ...(patch.warnings ? {commentWarnings: patch.warnings,
      warnings: [...(result.warnings || []).filter(warning => !(result.commentWarnings || []).includes(warning)), ...patch.warnings]} : {})};
}

export function applyRefinedClip(result, updated, approved = new Set()) {
  if (!result || approved.has(updated.id)) return result;
  if (updated.sourceKind === 'timestamp-comment') return {...result, timestampComments: result.timestampComments.map(comment =>
    comment.id === updated.comment.id && comment.atSeconds === updated.startSeconds
      ? {...comment, endSeconds: updated.endSeconds, smartEnding: updated.smartEnding, refinementToken: updated.refinementToken} : comment)};
  return {...result, clips: result.clips.map(clip => clip.id === updated.id ? {...clip, ...updated} : clip)};
}
