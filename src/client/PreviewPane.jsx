import React from 'react';
import { formatTime } from './formatters.js';

export function PreviewPane({video, selected}) {
  if (!selected) {
    return <div className="preview-placeholder"><span className="preview-placeholder-icon">▶</span><h3>Pick a moment to preview</h3><p>Choose a ranked clip or timestamped comment to open a short YouTube playback segment.</p></div>;
  }
  const start = Math.floor(selected.startSeconds);
  const end = Math.ceil(selected.endSeconds);
  const embedUrl = `https://www.youtube-nocookie.com/embed/${video.id}?start=${start}&end=${end}&rel=0&playsinline=1`;
  return <div className="player-shell">
    <iframe key={`${video.id}-${start}-${end}`} title={`YouTube preview from ${formatTime(start)} to ${formatTime(end)}`} src={embedUrl} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
  </div>;
}
