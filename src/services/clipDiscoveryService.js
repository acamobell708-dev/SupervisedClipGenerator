import { parseYouTubeVideoId, watchUrl } from '../domain/videoUrl.js';
import { normaliseHeatmap, selectTopClips } from '../domain/heatmapRanker.js';
import { SMART_ENDING_RULES, suggestSmartEnding } from '../domain/smartEnding.js';
import { selectTimestampComments } from '../domain/timestampComments.js';
import { AppError } from '../utils/AppError.js';
import { withDeadline } from '../utils/asyncWork.js';
import { DEFAULT_CLIP_SECONDS } from '../domain/clipDuration.js';
import { randomUUID } from 'node:crypto';
import { WorkQueue } from '../utils/asyncWork.js';

export class ClipDiscoveryService {
  constructor({ytDlpClient, commentsClient, smartEndingService, analysisTimeoutMs = 25000, commentTimeoutMs = 6000,
    commentFetchTimeoutMs = 45000, logger = () => {}, now = () => new Date()} = {}) {
    Object.assign(this, {ytDlp: ytDlpClient, commentsClient, smartEndingService, analysisTimeoutMs, commentTimeoutMs, commentFetchTimeoutMs, logger, now});
    this.commentJobs = new Map();
    this.commentContexts = new Map();
    this.commentQueue = new WorkQueue(2);
    this.activeCommentJobs = new Set();
  }
  async readComments(videoId, signal) {
    const started = performance.now();
    try {
      return {...await withDeadline(async phaseSignal => {
        if (this.commentsClient?.apiKey) {
          try {return {comments: await this.commentsClient.getTopComments(videoId, {signal: phaseSignal}), source: 'youtube-data-api'};}
          catch {phaseSignal.throwIfAborted();}
        }
        return {comments: await this.ytDlp.getTopComments(videoId, this.commentsClient?.sampleLimit ?? 100, {signal: phaseSignal, timeoutMs: this.commentFetchTimeoutMs}), source: 'yt-dlp-public'};
      }, this.commentFetchTimeoutMs, {signal, code: 'COMMENTS_TIMEOUT'}), durationMs: Math.round(performance.now() - started)};
    } catch {
      return {comments: [], source: 'unavailable', durationMs: Math.round(performance.now() - started),
        warning: 'Public comments could not be retrieved. Retry comments, or configure YOUTUBE_API_KEY for more reliable public comments.'};
    }
  }
  startCommentJob(videoId, retry = false) {
    const existing = this.commentJobs.get(videoId);
    if (!retry && existing && existing.expires > Date.now() && existing.result?.source !== 'unavailable') return existing;
    if (retry) {this.ytDlp.clearComments?.(videoId); existing?.controller.abort();}
    const controller = new AbortController();
    const job = {controller, expires: Date.now() + 300000, result: null};
    job.promise = withDeadline(signal => this.commentQueue.run(() => this.readComments(videoId, signal), signal),
      this.commentFetchTimeoutMs, {signal: controller.signal, code: 'COMMENTS_TIMEOUT'})
      .catch(() => ({comments: [], source: 'unavailable', warning: 'Comment retrieval timed out or was unavailable. Retry comments.', durationMs: this.commentFetchTimeoutMs}))
      .then(result => {job.result = result; this.logger({event: 'comments_timing', totalMs: result.durationMs, source: result.source, count: result.comments.length}); return result;})
      .finally(() => this.activeCommentJobs.delete(job));
    this.activeCommentJobs.add(job);
    this.commentJobs.set(videoId, job);
    while (this.commentJobs.size > 32) this.commentJobs.delete(this.commentJobs.keys().next().value);
    return job;
  }
  commentSection(commentResult, {video, discoveryOptions}, points) {
    const comments = commentResult.comments;
    const timestampComments = selectTimestampComments(comments, video.durationSeconds, 3).map(comment => {
      const decision = discoveryOptions.smartEnding ? suggestSmartEnding(points, comment.atSeconds,
        Math.min(video.durationSeconds, comment.atSeconds + DEFAULT_CLIP_SECONDS), video.durationSeconds) : null;
      return {...comment, url: watchUrl(video.id, comment.atSeconds), ...(decision ? {smartEnding: decision, endSeconds: decision.endSeconds} : {})};
    });
    const warnings = commentResult.warning ? [commentResult.warning] : [];
    if (!comments.length && !['unavailable','pending'].includes(commentResult.source)) warnings.push('No public comments were returned (comments may be disabled or extraction limited).');
    else if (comments.length && !timestampComments.length) warnings.push('No timestamped viewer comments were found in the bounded sample.');
    return {timestampComments, sources: {comments: commentResult.source, sampledCommentCount: comments.length}, warnings,
      commentsStatus: {state: commentResult.source === 'pending' ? 'loading' : commentResult.source === 'unavailable' ? 'unavailable' : 'ready',
        ...(commentResult.warning ? {message: commentResult.warning} : {})}};
  }
  async commentsFor(token, {retry = false, signal} = {}) {
    const context = this.commentContexts.get(token);
    if (typeof token !== 'string' || !context || context.expires < Date.now()) throw new AppError('The comment request expired. Run discovery again.', 410, 'COMMENTS_EXPIRED');
    signal?.throwIfAborted();
    if (retry) {context.job = this.startCommentJob(context.seed.video.id, true); context.patch = null;}
    if (!context.job.result) return {commentsStatus: {state: 'loading', token}};
    if (!context.patch) {
      const section = this.commentSection(context.job.result, context.seed, context.points);
      const commentResult = {...context.seed, clips: [], timestampComments: section.timestampComments};
      if (context.seed.discoveryOptions.smartEnding && this.smartEndingService?.register) await this.smartEndingService.register(commentResult, signal, context.points);
      context.patch = {...section, timestampComments: commentResult.timestampComments,
        commentsStatus: {...section.commentsStatus, token}, commentsMs: context.job.result.durationMs};
    }
    return context.patch;
  }
  close() {for (const job of this.activeCommentJobs) job.controller.abort();}
  async analyse(url, {smartEnding = false, signal} = {}) {
    if (typeof smartEnding !== 'boolean') throw new AppError('smartEnding must be true or false.', 400, 'INVALID_SMART_ENDING_OPTION');
    const videoId = parseYouTubeVideoId(url);
    const started = performance.now();
    return withDeadline(async phaseSignal => {
      const commentJob = this.startCommentJob(videoId);
      const raw = await this.ytDlp.getVideo(videoId, {signal: phaseSignal});
      const metadataMs = Math.round(performance.now() - started);
      const durationSeconds = Math.floor(Number(raw.duration));
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new AppError('Could not determine the video duration. Live streams are not supported.', 422, 'NO_DURATION');
      const rankingStarted = performance.now();
      const points = normaliseHeatmap(raw.heatmap, durationSeconds);
      const clips = selectTopClips(raw.heatmap, durationSeconds, {smartEnding});
      const rankingMs = Math.round(performance.now() - rankingStarted);
      const warnings = [];
      if (!points.length) warnings.push('YouTube did not expose a public Most Replayed heatmap for this video. No replay rankings can be verified.');
      else if (clips.length < 5) warnings.push(`Only ${clips.length} distinct, non-overlapping replay windows (target ${DEFAULT_CLIP_SECONDS} seconds) were available.`);
      let commentResult = commentJob.result;
      if (!commentResult) {
        try {commentResult = await withDeadline(() => commentJob.promise, Math.max(1, this.commentTimeoutMs - (performance.now() - started)), {signal: phaseSignal, code: 'COMMENTS_PENDING'});}
        catch (error) {
          phaseSignal.throwIfAborted();
          if (error.code !== 'COMMENTS_PENDING') throw error;
          commentResult = {comments: [], source: 'pending', durationMs: Math.round(performance.now() - started)};
        }
      }
      phaseSignal.throwIfAborted();
      const result = {
        status: 'ok', generatedAt: this.now().toISOString(),
        discoveryOptions: {smartEnding, ...(smartEnding ? {smartEndingRules: SMART_ENDING_RULES, speechAlignment: 'on-selection'} : {})},
        video: {id: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: String(raw.title || 'Untitled YouTube video'),
          channel: String(raw.channel || raw.uploader || 'Unknown channel'), durationSeconds,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, viewCount: Number.isFinite(Number(raw.view_count)) ? Number(raw.view_count) : null,
          embeddable: raw.playable_in_embed !== false},
        clips: clips.map(clip => ({...clip, url: watchUrl(videoId, clip.startSeconds)})), timestampComments: [],
        sources: {replay: clips.length ? 'public-most-replayed-heatmap-via-yt-dlp' : 'unavailable', comments: commentResult.source,
          sampledCommentCount: commentResult.comments.length, accuracy: 'Relative replay intensity is not an absolute view count or audience-retention measurement.'}, warnings,
      };
      const section = this.commentSection(commentResult, result, points);
      const token = randomUUID();
      result.timestampComments = section.timestampComments;
      result.commentsStatus = {...section.commentsStatus, token};
      result.commentWarnings = section.warnings;
      result.warnings.push(...section.warnings);
      for (const [key, context] of this.commentContexts) if (context.expires < Date.now()) this.commentContexts.delete(key);
      this.commentContexts.set(token, {seed: {video: result.video, discoveryOptions: result.discoveryOptions}, points, job: commentJob, expires: Date.now() + 1800000,
        patch: section.commentsStatus.state === 'loading' ? null : {...section, commentsStatus: {...section.commentsStatus, token}, commentsMs: commentResult.durationMs}});
      while (this.commentContexts.size > 128) this.commentContexts.delete(this.commentContexts.keys().next().value);
      const cacheStarted = performance.now();
      if (smartEnding && this.smartEndingService?.register) await this.smartEndingService.register(result, phaseSignal, points);
      const commentContext = this.commentContexts.get(token);
      if (commentContext.patch) commentContext.patch.timestampComments = result.timestampComments;
      result.timings = {metadataMs, commentsMs: commentResult.durationMs, rankingMs, endingCacheMs: Math.round(performance.now() - cacheStarted),
        totalMs: Math.round(performance.now() - started)};
      this.logger({event: 'analysis_timing', ...result.timings});
      return result;
    }, this.analysisTimeoutMs, {signal, code: 'ANALYSIS_TIMEOUT', message: 'YouTube discovery exceeded the 25-second processing budget. Please retry; no estimated replay rankings were invented.'});
  }
}
