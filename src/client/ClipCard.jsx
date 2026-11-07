import React from 'react';
import { formatTime, formatClipTime, formatCount } from './formatters.js';
import { needsEndingCheck } from './reviewClips.js';

export function ClipCard({clip, selected, approved, onPreview, onApprove, onDownload, downloadDisabled, approvalDisabled = false}) {
  const isComment = clip.sourceKind === 'timestamp-comment';
  const pending = needsEndingCheck(clip);
  const range = `${formatClipTime(clip.startSeconds)} to ${formatClipTime(clip.endSeconds)}`;
  return (
    <article className={`clip-card ${isComment ? 'clip-card--comment' : ''} ${selected ? 'clip-card--active' : ''}`}>
      <button className="clip-select" type="button" aria-label={`Preview ${isComment ? 'timestamp comment' : 'replay'} clip from ${range}${isComment ? `: ${clip.comment.excerpt}` : ''}`} aria-pressed={selected} onClick={() => onPreview(clip)}/>
      <div className="clip-rank" aria-hidden="true"><span className="rank-badge">{isComment ? '“' : String(clip.rank).padStart(2,'0')}</span></div>
      <div className="clip-main">
        <div className="clip-heading">
          <h3>{formatClipTime(clip.startSeconds)} <span className="arrow">→</span> {formatClipTime(clip.endSeconds)}</h3>
          {selected && <span className="preview-indicator">▶ In preview</span>}<span className="length-pill">{Math.round(clip.durationSeconds)} sec</span>
        </div>
        {isComment ? <p className="clip-comment-excerpt">“{clip.comment.excerpt}”</p> : <div className="intensity-row">
          <div className="intensity-track" role="img" aria-label={`Relative replay intensity ${clip.replayIntensityPercent} percent`}>
            <div className="intensity-bar" style={{width:`${clip.replayIntensityPercent}%`}} />
          </div>
          <strong>{clip.replayIntensityPercent}%</strong>
        </div>}
        <div className="clip-subtitle">{isComment ? `Comment at ${formatTime(clip.startSeconds)} · ♥ ${formatCount(clip.comment.likes)} · ${clip.comment.author}` : 'Relative replay intensity · not view count'}</div>
        {clip.smartEnding && Math.abs(clip.endSeconds - clip.smartEnding.originalEndSeconds) > 0.05 && <div className="clip-ending-note" title={`Original ending ${formatTime(clip.smartEnding.originalEndSeconds)}. Estimated from replay interest, not retention. ${clip.smartEnding.warning || ''}`}>
          Smart ending · {pending ? (clip.smartEnding.status === 'checking' ? 'checking audio…' : 'select to check ending') : clip.smartEnding.status === 'estimated' ? 'speech check unavailable · heatmap ending kept' : `${clip.endSeconds < clip.smartEnding.originalEndSeconds ? 'shortened' : 'extended'} · ${['sentence','pause','word'].includes(clip.smartEnding.boundary) ? `${clip.smartEnding.boundary} boundary` : 'replay-interest estimate'}`}
        </div>}
        <div className="clip-actions">
          <button className={`approval-button ${approved ? 'approval-button--approved' : ''}`} type="button" aria-pressed={approved} disabled={approvalDisabled || pending} title={pending ? 'Select this card to check its ending before approval.' : undefined} onClick={() => onApprove(clip.id)}>
            {pending ? (clip.smartEnding.status === 'checking' ? 'Checking…' : 'Select to check') : approved ? '✓ Approved' : '＋ Approve'}
          </button>
          <button className="clip-download-button" type="button" aria-label={`Download clip from ${range}`} title={`Download clip (${range})`} onClick={() => onDownload(clip)} disabled={downloadDisabled || pending}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg>
          </button>
          <a className="clip-link" href={clip.url} target="_blank" rel="noopener noreferrer">YouTube ↗</a>
        </div>
      </div>
    </article>
  );
}
