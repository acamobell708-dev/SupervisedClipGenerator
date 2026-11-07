import { AppError } from '../utils/AppError.js';
import { runExportProcess } from './clipDownloadService.js';

export class YtDlpClient {
  constructor({binary = 'yt-dlp', timeoutMs = 22000, run = runExportProcess, cacheTtlMs = 300000} = {}) {
    Object.assign(this, {binary, timeoutMs, run, cacheTtlMs});
    this.cache = new Map();
  }
  async execute(args, {signal, timeoutMs = this.timeoutMs} = {}) {
    const output = await this.run(this.binary, ['--socket-timeout', '8', '--retries', '0', ...args], {
      signal, timeoutMs, captureStdout: true, maxStdoutBytes: 12 * 1024 * 1024,
      missingMessage: 'yt-dlp is unavailable. Check YT_DLP_PATH or install yt-dlp.',
      timeoutMessage: 'YouTube discovery timed out. Please retry.',
      errorForExit: stderr => new AppError(`yt-dlp could not access this public video. ${String(stderr).replace(/https?:\/\/\S+/g, '[url]').replace(/[\r\n]+/g, ' ').slice(-240)}`.trim(), 502, 'YT_DLP_FAILED'),
    });
    try {return JSON.parse(output);}
    catch {throw new AppError('yt-dlp returned invalid metadata. Update yt-dlp.', 502, 'YT_DLP_INVALID_JSON');}
  }
  async cached(key, task) {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = await task();
    this.cache.delete(key);
    this.cache.set(key, {value, expires: Date.now() + this.cacheTtlMs});
    while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
  async getVideo(videoId, {signal} = {}) {
    signal?.throwIfAborted();
    return this.cached(`video:${videoId}`, () => this.execute([
      '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--no-write-comments',
      '--ignore-no-formats-error', `https://www.youtube.com/watch?v=${videoId}`,
    ], {signal}));
  }
  async getTopComments(videoId, limit = 100, {signal, timeoutMs = 45000} = {}) {
    signal?.throwIfAborted();
    const capped = Math.max(10, Math.min(200, limit));
    return this.cached(`comments:${videoId}:${capped}`, async () => {
      const result = await this.execute(['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings',
        '--write-comments', '--ignore-no-formats-error', '--extractor-args',
        `youtube:comment_sort=top;max_comments=${capped},${capped},0,0,1`, `https://www.youtube.com/watch?v=${videoId}`], {signal, timeoutMs});
      return Array.isArray(result.comments) ? result.comments.map(c => ({id: c.id, author: c.author, text: c.text, likes: c.like_count})) : [];
    });
  }
  clearComments(videoId) {for (const key of this.cache.keys()) if (key.startsWith(`comments:${videoId}:`)) this.cache.delete(key);}
}
