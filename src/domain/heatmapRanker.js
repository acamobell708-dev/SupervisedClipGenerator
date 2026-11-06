/** Ranked clips are independent, non-overlapping 5–15-second windows around
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

export function selectTopClips(rawHeatmap, durationSeconds, {count = 5, clipLength = 10} = {}) {
  const points = normaliseHeatmap(rawHeatmap, durationSeconds);
  if (!points.length || durationSeconds < 5) return [];
  const length = Math.min(Math.max(clipLength, 5), 15, durationSeconds);
  const candidateCenters = new Set();
  for (const point of points) {
    candidateCenters.add((point.start + point.end) / 2);
    // Helps find distinct windows even if the heatmap contains few wide buckets.
    candidateCenters.add(point.start);
    candidateCenters.add(point.end);
  }
  const candidates = [...candidateCenters].map(center => {
    const start = Math.round(Math.max(0, Math.min(durationSeconds - length, center - length / 2)) * 10) / 10;
    const end = Math.round((start + length) * 10) / 10;
    return {startSeconds: start, endSeconds: end, replayIntensity: scoreWindow(points, start, end)};
  }).filter(c => c.replayIntensity > 0).sort((a,b) => b.replayIntensity - a.replayIntensity || a.startSeconds - b.startSeconds);

  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
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
    });
  }
  return selected;
}
