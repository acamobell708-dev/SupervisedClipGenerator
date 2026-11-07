import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapSmartEnding } from '../domain/smartEnding.js';
import { getReviewClips, applyRefinedClip } from '../domain/reviewClips.js';
import { scoreWindow } from '../domain/heatmapRanker.js';
import { withDeadline } from '../utils/asyncWork.js';
import { AppError } from '../utils/AppError.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class SmartEndingService {
  constructor({audioService, subtitleService, cacheRoot = path.join(root, '.cache/smart-endings'), timeoutMs = 25000,
    logger = () => {}, cacheTtlMs = 86400000} = {}) {
    Object.assign(this, {audioService, subtitleService, cacheRoot, timeoutMs, logger, cacheTtlMs});
    this.contexts = new Map();
  }
  key(videoId, clip, maximumEndSeconds) {
    return createHash('sha256').update(JSON.stringify(['ending-v2', videoId, clip.startSeconds, clip.smartEnding,
      maximumEndSeconds, this.subtitleService.model, this.subtitleService.language])).digest('hex');
  }
  async cachedDecision(key, clip, maximumEndSeconds) {
    const file = path.join(this.cacheRoot, `${key}.json`);
    const info = await stat(file).catch(() => null);
    if (!info || info.size > 65536 || Date.now() - info.mtimeMs > this.cacheTtlMs) return null;
    try {
      const decision = JSON.parse(await readFile(file, 'utf8'));
      return Number.isFinite(decision.endSeconds) && decision.endSeconds >= Math.max(clip.smartEnding.minimumEndSeconds, clip.smartEnding.peakAtSeconds ?? 0)
        && decision.endSeconds <= maximumEndSeconds && decision.status === 'complete' ? decision : null;
    } catch {return null;}
  }
  updatedClip(context, decision) {
    const clip = {...context.clip, endSeconds: decision.endSeconds,
      durationSeconds: Math.round((decision.endSeconds - context.clip.startSeconds) * 1000) / 1000, smartEnding: decision};
    if (clip.sourceKind === 'replay' && context.points?.length) {
      const intensity = scoreWindow(context.points, clip.startSeconds, clip.endSeconds);
      Object.assign(clip, {replayIntensity: Math.round(intensity * 1000) / 1000, replayIntensityPercent: Math.round(intensity * 100)});
    }
    return clip;
  }
  async register(result, signal, points = []) {
    for (const [token, context] of this.contexts) if (context.expires < Date.now()) this.contexts.delete(token);
    for (const clip of getReviewClips(result)) {
      signal?.throwIfAborted();
      if (!clip.smartEnding) continue;
      if (Math.abs(clip.endSeconds - clip.smartEnding.originalEndSeconds) <= 0.05) {
        Object.assign(result, applyRefinedClip(result, {...clip, smartEnding: {...clip.smartEnding, status: 'not-needed'}}));
        continue;
      }
      const maximumEndSeconds = Math.min(clip.smartEnding.analysisEndSeconds, clip.sourceKind === 'replay'
        ? Math.min(result.video.durationSeconds, ...result.clips.filter(other => other.startSeconds > clip.startSeconds).map(other => other.startSeconds)) : result.video.durationSeconds);
      const key = this.key(result.video.id, clip, maximumEndSeconds);
      const context = {clip, videoId: result.video.id, maximumEndSeconds, key, points, expires: Date.now() + 30 * 60 * 1000};
      const cached = await this.cachedDecision(key, clip, maximumEndSeconds);
      if (cached) {Object.assign(result, applyRefinedClip(result, this.updatedClip(context, cached))); continue;}
      const token = randomUUID();
      this.contexts.set(token, context);
      while (this.contexts.size > 512) this.contexts.delete(this.contexts.keys().next().value);
      Object.assign(result, applyRefinedClip(result, {...clip, refinementToken: token, smartEnding: {...clip.smartEnding, status: 'pending'}}));
    }
  }
  async refineToken(token, {signal} = {}) {
    if (typeof token !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(token)) throw new AppError('Invalid ending-check token.', 400, 'INVALID_REFINEMENT_TOKEN');
    const context = this.contexts.get(token);
    if (!context || context.expires < Date.now()) throw new AppError('The ending check expired. Run discovery again.', 410, 'REFINEMENT_EXPIRED');
    if (context.result) return {...context.result, timings: {totalMs: 0, decisionCacheHit: true}};
    if (context.busy) throw new AppError('This ending is already being checked.', 409, 'REFINEMENT_BUSY');
    context.busy = true;
    const started = performance.now();
    const timings = {};
    let decision;
    try {
      decision = await withDeadline(async phaseSignal => {
        const cached = await this.cachedDecision(context.key, context.clip, context.maximumEndSeconds);
        if (cached) {timings.decisionCacheHit = true; return cached;}
        const suggested = context.clip.smartEnding.endSeconds;
        const start = Math.max(context.clip.startSeconds, suggested - 8);
        const end = Math.min(context.clip.smartEnding.analysisEndSeconds, suggested + 4);
        let stage = performance.now();
        const excerpt = await this.audioService.acquire(context.videoId, start, end, {signal: phaseSignal});
        Object.assign(timings, {audioMs: Math.round(performance.now() - stage), audioCacheHit: excerpt.cached});
        const directory = await mkdtemp(path.join(tmpdir(), 'clip-refine-'));
        try {
          stage = performance.now();
          const transcript = await this.subtitleService.transcribe({filePath: excerpt.filePath, directory, signal: phaseSignal});
          timings.transcriptionMs = Math.round(performance.now() - stage);
          const offset = excerpt.startSeconds - context.clip.startSeconds;
          const words = transcript.words.map(word => ({...word, start: word.start + offset, end: word.end + offset}));
          return {...snapSmartEnding(context.clip, words, context.maximumEndSeconds), status: 'complete'};
        } finally {
          if (path.dirname(directory) === tmpdir() && path.basename(directory).startsWith('clip-refine-')) await rm(directory, {recursive: true, force: true, maxRetries: 3});
        }
      }, this.timeoutMs, {signal, code: 'ENDING_CHECK_TIMEOUT', message: 'The ending check reached its time budget.'});
      if (!timings.decisionCacheHit) {
        await mkdir(this.cacheRoot, {recursive: true});
        const temporary = path.join(this.cacheRoot, `${context.key}.${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(decision));
        await rename(temporary, path.join(this.cacheRoot, `${context.key}.json`));
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      decision = {...context.clip.smartEnding, status: 'estimated', boundary: 'speech-unavailable',
        warning: error.code === 'ENDING_CHECK_TIMEOUT' ? 'Speech check timed out; the replay-interest ending was kept.'
          : 'Speech check unavailable; the replay-interest ending was kept. Check local subtitle setup if needed.'};
    } finally {context.busy = false;}
    timings.totalMs = Math.round(performance.now() - started);
    this.logger({event: 'ending_check_timing', ...timings, status: decision.status});
    return context.result = {clip: this.updatedClip(context, decision), timings};
  }
}
