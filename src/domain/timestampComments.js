/** Times like 1:23 or 1:02:03 mentioned in comments are navigational evidence,
 * not observed watch counts. Rank by comment likes within a bounded sample. */
const TIMESTAMP_RE = /(^|[^\d\w:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?!\d|:)/g;

export function extractTimestamps(text, durationSeconds) {
  if (typeof text !== 'string') return [];
  const found = new Set();
  for (const match of text.matchAll(TIMESTAMP_RE)) {
    const hours = match[2] ? Number(match[2]) : 0;
    const minutes = Number(match[3]);
    const seconds = Number(match[4]);
    if (seconds > 59 || (match[2] && minutes > 59)) continue;
    const total = hours * 3600 + minutes * 60 + seconds;
    if (total >= 0 && total < durationSeconds) found.add(total);
  }
  return [...found];
}

export function selectTimestampComments(comments, durationSeconds, maximum = 3) {
  if (!Array.isArray(comments) || !Number.isFinite(durationSeconds)) return [];
  const candidates = [];
  for (const comment of comments) {
    const text = String(comment.text ?? '').trim();
    const times = extractTimestamps(text, durationSeconds);
    // Ignore chapter indexes / lengthy lists of timestamps; keep human reactions.
    if (!times.length || times.length > 3 || text.length > 700) continue;
    const likes = Math.max(0, Math.floor(Number(comment.likes ?? 0) || 0));
    for (const seconds of times) {
      candidates.push({
        id: String(comment.id ?? `comment-${candidates.length}`),
        author: String(comment.author ?? 'YouTube viewer').slice(0, 100),
        text: text.slice(0, 350),
        likes,
        atSeconds: seconds,
      });
    }
  }
  candidates.sort((a,b) => b.likes-a.likes || a.atSeconds-b.atSeconds);
  const selected = [];
  for (const c of candidates) {
    if (selected.length >= maximum) break;
    if (selected.some(other => other.id === c.id || Math.abs(other.atSeconds-c.atSeconds) < 5)) continue;
    selected.push(c);
  }
  return selected;
}
