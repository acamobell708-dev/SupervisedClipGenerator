export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total/3600), m = Math.floor((total%3600)/60), s=total%60;
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

export function formatCount(value) {
  return value == null ? '—' : new Intl.NumberFormat('en-GB', {notation: 'compact', maximumFractionDigits:1}).format(value);
}

// Preserve reviewed speech-boundary precision, including carries across minutes.
export function formatClipTime(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const fraction = milliseconds % 1000;
  return `${formatTime(Math.floor(milliseconds / 1000))}${fraction ? `.${String(fraction).padStart(3, '0').replace(/0+$/, '')}` : ''}`;
}
