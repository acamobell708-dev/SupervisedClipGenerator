import React, { useEffect, useRef, useState } from 'react';
import { ClipCard } from './ClipCard.jsx';
import { PreviewPane } from './PreviewPane.jsx';
import { formatTime, formatCount } from './formatters.js';
import { getReviewClips, selectionManifest } from './reviewClips.js';
import { fetchClipBlob, prepareApprovedDownload } from './batchDownloads.js';

function Symbol({name}) {
  const shapes = {
    spark: <><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z"/></>,
    film: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4"/></>,
    trend: <><path d="m3 17 6-6 4 4 8-9"/><path d="M16 6h5v5"/></>,
    quote: <><path d="M9 13H5a2 2 0 0 1-2-2V9a4 4 0 0 1 4-4h2v4H7v2h2v7H3"/><path d="M21 13h-4a2 2 0 0 1-2-2V9a4 4 0 0 1 4-4h2v4h-2v2h2v7h-6"/></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

function saveDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const element = document.createElement('a');
  element.href = objectUrl;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  element.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function downloadJson(result, approved) {
  const manifest = selectionManifest(result, approved);
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {type:'application/json'});
  saveDownload(blob, `supervisedclipgenerator-${result.video.id}-selections.json`);
}

export function App() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [approved, setApproved] = useState(new Set());
  const [subtitles, setSubtitles] = useState(true);
  const [tapeSlowdown, setTapeSlowdown] = useState(false);
  const [download, setDownload] = useState({busy: false, message: '', error: false});
  const downloadController = useRef(null);
  useEffect(() => () => downloadController.current?.abort(), []);

  async function downloadClip(clip) {
    if (!result || !clip || result.status === 'demo' || loading || downloadController.current) return;
    setSelected(clip);
    const selection = {videoId: result.video.id, startSeconds: clip.startSeconds, endSeconds: clip.endSeconds};
    const range = `${formatTime(selection.startSeconds)}–${formatTime(selection.endSeconds)}`;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownload({busy: true, message: `Preparing ${range}${subtitles ? ' with local white subtitles' : ' as MP4'}${tapeSlowdown ? ' and tape slowdown' : ''}…`, error: false});
    try {
      const blob = await fetchClipBlob(selection.videoId, clip, controller.signal, {subtitles, tapeSlowdown});
      saveDownload(blob, `test-clip-${selection.videoId}-${selection.startSeconds}-${selection.endSeconds}${subtitles ? '-subtitled' : ''}${tapeSlowdown ? '-tape' : ''}.mp4`);
      setDownload({busy: false, message: `${range} is ready. Check your browser downloads.`, error: false});
    } catch (err) {
      const cancelled = err.name === 'AbortError';
      setDownload({busy: false, message: cancelled ? 'Download cancelled.' : err.message, error: !cancelled});
    } finally {
      downloadController.current = null;
    }
  }

  async function downloadApproved() {
    if (!result || !approved.size || result.status === 'demo' || loading || downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    const batchApprovals = new Set(approved);
    const count = getReviewClips(result).filter(clip => batchApprovals.has(clip.id)).length;
    setDownload({busy: true, mode: 'batch', message: `Preparing ${count} approved clips…`, error: false});
    try {
      const archive = await prepareApprovedDownload({result, approved: batchApprovals, signal: controller.signal, subtitles, tapeSlowdown,
        onProgress: ({index, total, clip, packing}) => setDownload({busy: true, mode: 'batch', error: false,
          message: packing ? 'Packing approved clips into a ZIP…' : `Preparing clip ${index} of ${total}: ${formatTime(clip.startSeconds)}–${formatTime(clip.endSeconds)}${subtitles ? ' with local subtitles' : ''}${tapeSlowdown ? ' and tape slowdown' : ''}…`,
        }),
      });
      saveDownload(archive, `approved-clips-${result.video.id}${subtitles ? '-subtitled' : ''}${tapeSlowdown ? '-tape' : ''}.zip`);
      setDownload({busy: false, message: `${count} approved clips are ready in one ZIP. Check your browser downloads.`, error: false});
    } catch (err) {
      const cancelled = err.name === 'AbortError';
      setDownload({busy: false, message: cancelled ? 'Batch download cancelled.' : `Batch download stopped: ${err.message}`, error: !cancelled});
    } finally {
      downloadController.current = null;
    }
  }

  async function request(endpoint, body) {
    if (loading || downloadController.current) return;
    setLoading(true);
    setError('');
    setDownload({busy: false, message: '', error: false});
    try {
      const response = await fetch(endpoint, {
        method: body ? 'POST' : 'GET',
        headers: body ? {'Content-Type':'application/json'} : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to analyse video.');
      setResult(data);
      setApproved(new Set());
      setSelected(getReviewClips(data)[0] || null);
    } catch (err) {
      setError(err.message || 'Unable to analyse video.');
    } finally { setLoading(false); }
  }

  function toggleApproved(id) {
    setApproved(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const reviewClips = getReviewClips(result);
  const commentClips = reviewClips.filter(clip => clip.sourceKind === 'timestamp-comment');
  const clips = result?.clips || [];
  const renderClip = clip => <ClipCard key={clip.id} clip={clip} selected={selected?.id === clip.id} approved={approved.has(clip.id)} onPreview={setSelected} onApprove={toggleApproved} onDownload={downloadClip} downloadDisabled={loading || download.busy || result.status === 'demo'}/>;
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/" aria-label="SupervisedClipGenerator home">
          <span className="brand-icon"><span>▶</span></span>
          <span>clip<span className="brand-accent">foundry</span></span>
        </a>
        <div className="topbar-right"><span className="server-dot" /> Local workspace <span className="topbar-separator" /> <span className="version">v0.1 · DISCOVERY</span></div>
      </div>
    </header>

    <main className="main-container">
      <section className="hero">
        <div className="hero-heading"><h1>Find your next <span>clip.</span></h1><p>Discover, preview and approve replay peaks.</p></div>
        <form className="search-form" onSubmit={event => {event.preventDefault(); request('/api/analyse', {url});}}>
          <div className="search-field"><span className="link-symbol">↗</span><input autoFocus type="url" placeholder="https://www.youtube.com/watch?v=..." value={url} onChange={e => setUrl(e.target.value)} aria-label="YouTube video URL" required /></div>
          <button className="primary-button" type="submit" disabled={loading || download.busy || !url.trim()}>{loading ? <><span className="spinner"/> Analysing…</> : <>Discover moments <span aria-hidden="true">→</span></>}</button>
        </form>
        <div className="search-bottom"><span>Public YouTube videos · Local workspace · No API fees</span><button className="demo-link" type="button" onClick={() => request('/api/demo')} disabled={loading || download.busy}>Try offline demo ↗</button></div>
        {loading && <div className="analysis-progress" role="status"><progress aria-label="Analysing video"/><span>Reading public replay data and sampled comments…</span></div>}
        {error && <div className="error-banner" role="alert"><b>Couldn't analyse that video.</b> {error} <span>See the README for yt-dlp setup and troubleshooting.</span></div>}
      </section>

      {!result ? <section className="empty-stage">
        <div className="section-intro"><h2>From link to shortlist</h2></div>
        <div className="features-grid">
          <div className="feature-card"><div className="feature-icon blue"><Symbol name="film"/></div><span className="feature-index">01 / INPUT</span><h3>Paste a video</h3><p>Public YouTube links, Shorts links and youtu.be URLs are accepted.</p></div>
          <div className="feature-card"><div className="feature-icon purple"><Symbol name="trend"/></div><span className="feature-index">02 / DISCOVERY</span><h3>Find replay peaks</h3><p>Rank distinct 10-second windows from public Most Replayed heatmap data, when available.</p></div>
          <div className="feature-card"><div className="feature-icon yellow"><Symbol name="quote"/></div><span className="feature-index">03 / REVIEW</span><h3>Preview & approve</h3><p>Watch each segment, inspect timestamped comments and export your selections as JSON.</p></div>
        </div>
        <div className="note-row"><span>ⓘ</span> YouTube only offers a public Most Replayed graph for eligible videos. Missing heatmaps are reported as unavailable—not estimated.</div>
      </section> : <>
        <section className="results-heading">
          <div><div className="overline">{result.status === 'demo' ? 'SYNTHETIC DEMO · NOT LIVE DATA' : 'ANALYSIS COMPLETE'}</div><h2>Clip shortlist <span className="small-number">{reviewClips.length} clips</span></h2></div>
          <div className="results-tools"><button className="outline-button" onClick={() => downloadJson(result, approved)} disabled={approved.size === 0}>Export timestamps ({approved.size}) ↓</button><span className="export-note">JSON only · Approvals are temporary</span></div>
        </section>
        <section className="video-summary"><img src={result.video.thumbnail} alt="Video thumbnail"/><div className="video-summary-body"><div className="meta-label">SOURCE VIDEO</div><h3>{result.video.title}</h3><div className="video-meta"><span>{result.video.channel}</span><span className="meta-bullet">•</span><span>{formatTime(result.video.durationSeconds)}</span><span className="meta-bullet">•</span><span>{formatCount(result.video.viewCount)} views</span></div></div><a target="_blank" rel="noopener noreferrer" href={result.video.url} className="video-open">Open video ↗</a></section>
        {result.warnings?.length > 0 && <div className="warning-area" role="status">{result.warnings.map((w,i)=><p key={i}><span>ⓘ</span> {w}</p>)}</div>}
        <div className="workspace-grid">
          <section className="moments-pane"><div className="panel-head"><h2><Symbol name="trend"/> Top replay peaks</h2><span className="count-tag">{clips.length} / 5</span></div>
            <p className="clip-list-hint">Select any card to preview its clip.</p>
            <div className="clip-list">{clips.length ? reviewClips.filter(clip => clip.sourceKind === 'replay').map(renderClip) : <div className="no-results"><h3>Replay heatmap unavailable</h3><p>This video does not currently expose replay peaks to public viewers. Try a popular long-form video with a visible Most Replayed graph.</p></div>}
              <div className="panel-head comment-list-heading"><h2><Symbol name="quote"/> Timestamped comments</h2><span className="count-tag">{commentClips.length} / 3</span></div>
              {commentClips.length ? commentClips.map(renderClip) : <div className="no-results no-results--small">No timestamped comments in the sampled public comments.</div>}
            </div>
            <p className="comment-disclaimer">Ranked by likes among {result.sources.sampledCommentCount} sampled comments, not all comments. Source: {result.sources.comments.replaceAll('-', ' ')}.</p>
          </section>
          <aside className="right-rail"><section className="preview-pane"><div className="panel-head"><h2><Symbol name="film"/> Clip preview</h2><span className="live-label">YOUTUBE PLAYER</span></div><PreviewPane video={result.video} selected={selected}/><div className="player-footer">{selected ? <><div><strong>{formatTime(selected.startSeconds)} – {formatTime(selected.endSeconds)}</strong><p>Playback segment · {Math.round(selected.endSeconds-selected.startSeconds)} sec</p></div><a href={`https://www.youtube.com/watch?v=${result.video.id}&t=${Math.floor(selected.startSeconds)}s`} target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a></> : <p>Choose a moment on the left.</p>}</div>{!result.video.embeddable && <p className="embed-alert">The creator may have disabled embedding. Use “Watch on YouTube” instead.</p>}
            <div className="test-download">
              <label className="subtitle-toggle"><input type="checkbox" checked={subtitles} disabled={download.busy} onChange={event => setSubtitles(event.target.checked)}/><span>Add white subtitles <small>Local speech recognition · Applies to individual and batch downloads</small></span></label>
              <p className="subtitle-note">Subtitles are burned into downloaded videos. The YouTube preview shows the original.</p>
              <label className="subtitle-toggle tape-toggle"><input type="checkbox" checked={tapeSlowdown} disabled={download.busy} onChange={event => setTapeSlowdown(event.target.checked)}/><span>Tape slowdown <small>Gradually slows video and audio to 60% speed, with a matching pitch drop</small></span></label>
              <div className="batch-download-actions"><button type="button" className="primary-button" onClick={downloadApproved} disabled={!approved.size || loading || download.busy || result.status === 'demo'}>{download.busy && download.mode === 'batch' ? <><span className="spinner"/> Preparing batch…</> : <>Batch upload (download ZIP) · {approved.size} approved ↓</>}</button><p>Current action: download all approved clips as one ZIP.</p></div>
              {download.busy && <button type="button" className="demo-link download-cancel" onClick={() => downloadController.current?.abort()}>Cancel download</button>}
              {download.message && <p className={download.error ? 'download-message download-message--error' : 'download-message'} role={download.error ? 'alert' : 'status'}>{download.message}</p>}
            </div>
          </section></aside>
        </div>
      </>}
    </main>
    <footer className="footer"><span>CLIPFOUNDRY <span>·</span> LOCAL-FIRST CREATOR TOOLS</span><span>Local subtitles & clips · No uploads · No paid AI APIs</span></footer>
  </div>;
}
