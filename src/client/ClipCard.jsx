import React from 'react';
import { formatTime } from './formatters.js';

export function ClipCard({clip, selected, approved, onPreview, onApprove}) {
  return (
    <article className={`clip-card ${selected ? 'clip-card--active' : ''}`}>
      <div className="clip-rank"><span className="rank-badge">{String(clip.rank).padStart(2,'0')}</span><div className="rank-label">REPLAY PEAK</div></div>
      <div className="clip-main">
        <div className="clip-heading">
          <h3>{formatTime(clip.startSeconds)} <span className="arrow">→</span> {formatTime(clip.endSeconds)}</h3>
          <span className="length-pill">{Math.round(clip.durationSeconds)} sec</span>
        </div>
        <div className="intensity-row">
          <div className="intensity-track" role="img" aria-label={`Relative replay intensity ${clip.replayIntensityPercent} percent`}>
            <div className="intensity-bar" style={{width:`${clip.replayIntensityPercent}%`}} />
          </div>
          <strong>{clip.replayIntensityPercent}%</strong>
        </div>
        <div className="clip-subtitle">Relative replay intensity · not view count</div>
        <div className="clip-actions">
          <button className={`mini-button ${selected ? 'mini-button--selected' : ''}`} type="button" onClick={() => onPreview(clip)}>
            <span aria-hidden="true">▶</span> {selected ? 'In preview' : 'Preview'}
          </button>
          <button className={`mini-button ${approved ? 'mini-button--approved' : ''}`} type="button" aria-pressed={approved} onClick={() => onApprove(clip.id)}>
            {approved ? '✓ Approved' : '＋ Approve'}
          </button>
          <a className="clip-link" href={clip.url} target="_blank" rel="noopener noreferrer">YouTube ↗</a>
        </div>
      </div>
    </article>
  );
}
