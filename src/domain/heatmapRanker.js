import { DEFAULT_CLIP_SECONDS, MAX_CLIP_SECONDS } from './clipDuration.js';
import { suggestSmartEnding } from './smartEnding.js';

/** Ranked clips are independent, non-overlapping windows around
 * elevated public Most Replayed heatmap values. The values are RELATIVE
 * intensities for one video, NOT play/view counts or owner retention data. */

export function normaliseHeatmap(points, durationSeconds) {
  if (!Array.isArray(points) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  return points.map(point => ({
    start: Number(point.start_time ?? point.start),
    end: Number(point.end_time ?? point.end),
    intensity: Number(point.value ?? point.intensity),
  })).filter(point =>
    Number.isFinite(point.start) && Number.isFinite(point.end) &&
    Number.isFinite(point.intensity) && point.intensity >= 0 &&
    point.end > point.start && point.start < durationSeconds
  ).map(point => ({
    start: Math.max(0, point.start),
    end: Math.min(durationSeconds, point.end),
    intensity: Math.min(1, point.intensity),
  })).filter(point => point.end > point.start).sort((a,b) => a.start-b.start);
}

function intersection(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

export function scoreWindow(points, start, end) {
  let weighted = 0, covered = 0;
  for (const point of points) {
    const overlap = intersection(point.start, point.end, start, end);
    weighted += overlap * point.intensity;
    covered += overlap;
  }
  return covered > 0 ? weighted / covered : 0;
}

export function selectTopClips(rawHeatmap, durationSeconds, {count = 5, clipLength = DEFAULT_CLIP_SECONDS, smartEnding = false} = {}) {
  const points = normaliseHeatmap(rawHeatmap, durationSeconds);
  if (!points.length || durationSeconds < 5) return [];
  const length = Math.min(Math.max(clipLength, 5), MAX_CLIP_SECONDS, durationSeconds);
  const candidateStarts = new Set([0, Math.max(0, durationSeconds - length)]);
  for (const point of points) {
    // Score the complete longer window, including alignments at either bucket edge.
    // Merely extending an old ten-second winner can miss the strongest 25-second section.
    for (const edge of [point.start, point.end]) {
      candidateStarts.add(edge);
      candidateStarts.add(edge - length);
    }
    candidateStarts.add((point.start + point.end - length) / 2);
  }
  const starts = new Set([...candidateStarts].map(start => Math.max(0,
    Math.min(durationSeconds - length, Math.round(start * 10) / 10))));
  const candidates = [...starts].map(start => {
    const end = Math.min(durationSeconds, Math.round((start + length) * 1000) / 1000);
    return {startSeconds: start, endSeconds: end, replayIntensity: scoreWindow(points, start, end)};
  }).filter(c => c.replayIntensity > 0).sort((a,b) => b.replayIntensity - a.replayIntensity || a.startSeconds - b.startSeconds);

  const selected = [];
  for (const original of candidates) {
    if (selected.length >= count) break;
    const decision = smartEnding ? suggestSmartEnding(points, original.startSeconds, original.endSeconds, durationSeconds) : null;
    const candidate = decision ? {...original, endSeconds: decision.endSeconds,
      replayIntensity: scoreWindow(points, original.startSeconds, decision.endSeconds), smartEnding: decision} : original;
    if (selected.some(clip => intersection(clip.startSeconds, clip.endSeconds, candidate.startSeconds, candidate.endSeconds) > 0.05)) continue;
    selected.push({
      id: `replay-${selected.length + 1}`,
      rank: selected.length + 1,
      startSeconds: candidate.startSeconds,
      endSeconds: candidate.endSeconds,
      durationSeconds: Math.round((candidate.endSeconds - candidate.startSeconds) * 10) / 10,
      replayIntensity: Math.round(candidate.replayIntensity * 1000) / 1000,
      replayIntensityPercent: Math.round(candidate.replayIntensity * 100),
      source: 'youtube-most-replayed',
      ...(decision ? {smartEnding: decision} : {}),
    });
  }
  return selected;
}
