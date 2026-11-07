import { DEFAULT_CLIP_SECONDS, MAX_CLIP_SECONDS } from './clipDuration.js';

export const SMART_ENDING_RULES = Object.freeze({targetSeconds: DEFAULT_CLIP_SECONDS, minimumSeconds: 15,
  maximumSeconds: MAX_CLIP_SECONDS, dropRatio: 0.4, sustainedSeconds: 3, smoothingSeconds: 3,
  extensionRatio: 0.6, snapToleranceSeconds: 1.5});

// Input is a normalised public replay heatmap, not audience-retention data.
export function suggestSmartEnding(points, startSeconds, targetEndSeconds, videoDuration) {
  const rules = SMART_ENDING_RULES;
  const analysisEndSeconds = Math.min(videoDuration, startSeconds + rules.maximumSeconds);
  const minimumEndSeconds = startSeconds + rules.minimumSeconds;
  const decision = {originalEndSeconds: targetEndSeconds, endSeconds: targetEndSeconds, analysisEndSeconds,
    minimumEndSeconds, reason: 'target-length', evidence: 'public-replay-interest', boundary: 'heatmap'};
  if (targetEndSeconds < minimumEndSeconds) return {...decision, reason: 'short-source'};
  const bins = [];
  for (let from = startSeconds; from < analysisEndSeconds - 1e-6; from += 1) {
    const to = Math.min(from + 1, analysisEndSeconds);
    let covered = 0, weighted = 0;
    for (const point of points) {
      const overlap = Math.max(0, Math.min(to, point.end) - Math.max(from, point.start));
      covered += overlap;
      weighted += overlap * point.intensity;
    }
    bins.push({from, to, value: Math.abs(covered - (to - from)) < 0.001 ? weighted / covered : null});
  }
  const targetBins = bins.filter(bin => bin.from < targetEndSeconds);
  if (!targetBins.length || targetBins.some(bin => bin.value === null)) return {...decision, reason: 'insufficient-data'};
  // Three-second smoothing and full coverage prevent isolated dips/gaps becoming cuts.
  const smoothed = bins.map((bin, index) => {
    const neighbours = bins.slice(Math.max(0, index - 1), index + 2);
    return {...bin, value: neighbours.some(item => item.value === null) ? null
      : neighbours.reduce((sum, item) => sum + item.value * (item.to - item.from), 0)
        / neighbours.reduce((sum, item) => sum + item.to - item.from, 0)};
  });
  const target = smoothed.filter(bin => bin.from < targetEndSeconds);
  if (target.some(bin => bin.value === null)) return {...decision, reason: 'insufficient-data'};
  const peak = Math.max(...target.map(bin => bin.value));
  const levels = points.map(point => point.intensity).sort((a, b) => a - b);
  const baseline = levels[Math.floor((levels.length - 1) * 0.2)] ?? peak;
  if (!(peak > 0) || baseline >= peak * 0.8) return {...decision, reason: 'no-distinct-peak'};
  const peakBin = target.findLast(bin => bin.value >= peak - 1e-9);
  Object.assign(decision, {peakAtSeconds: peakBin.to, peakIntensity: peak, threshold: peak * rules.dropRatio});
  for (let index = 0; index < target.length; index++) {
    const bin = target[index];
    if (bin.from < minimumEndSeconds || bin.from < peakBin.to || bin.value >= decision.threshold) continue;
    const tail = target.slice(index);
    // Only a sustained weak ending qualifies. A temporary dip followed by recovery stays.
    if (tail.some(item => item.value === null || item.value >= decision.threshold) ||
        targetEndSeconds - bin.from < rules.sustainedSeconds) continue;
    return {...decision, endSeconds: bin.from, reason: 'interest-drop'};
  }
  const ending = target.filter(bin => bin.to > targetEndSeconds - rules.sustainedSeconds);
  if (!ending.length || ending.some(bin => bin.value < peak * rules.extensionRatio)) return decision;
  let extended = targetEndSeconds;
  for (const bin of smoothed.filter(item => item.from >= targetEndSeconds - 1e-6)) {
    if (bin.value === null || bin.value < peak * rules.extensionRatio) break;
    extended = bin.to;
  }
  return extended > targetEndSeconds ? {...decision, endSeconds: extended, reason: 'strong-ending'} : decision;
}

// Transcript positions are relative to the acquired source window. Snap before approval.
export function snapSmartEnding(clip, words, maximumEndSeconds = clip.smartEnding.analysisEndSeconds) {
  const decision = clip.smartEnding;
  const minimum = Math.max(decision.minimumEndSeconds, decision.peakAtSeconds ?? clip.startSeconds);
  const sorted = (Array.isArray(words) ? words : []).filter(word => word && Number.isFinite(word.start) &&
    Number.isFinite(word.end) && word.start >= 0 && word.end > word.start).sort((a, b) => a.start - b.start);
  const boundaries = sorted.map((word, index) => ({endSeconds: clip.startSeconds + word.end,
    boundary: /[.!?…。！？]["'”’)]*$/.test(String(word.text).trim()) ? 'sentence'
      : sorted[index + 1] && sorted[index + 1].start - word.end >= 0.35 ? 'pause' : 'word'}))
    .filter(item => item.endSeconds >= minimum && item.endSeconds <= maximumEndSeconds &&
      Math.abs(item.endSeconds - decision.endSeconds) <= SMART_ENDING_RULES.snapToleranceSeconds);
  // Prefer natural speech boundaries, then a nearby word end instead of mid-word audio.
  boundaries.sort((a, b) => (a.boundary === 'word') - (b.boundary === 'word') ||
    Math.abs(a.endSeconds - decision.endSeconds) - Math.abs(b.endSeconds - decision.endSeconds) || a.endSeconds - b.endSeconds);
  const chosen = boundaries[0];
  return chosen ? {...decision, endSeconds: Math.round(chosen.endSeconds * 1000) / 1000, boundary: chosen.boundary}
    : {...decision, boundary: 'no-nearby-speech-boundary'};
}
