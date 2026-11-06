import { spawn } from 'node:child_process';
import { AppError } from '../utils/AppError.js';

const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;

/** The ONLY spawn target is a configured local executable; user-supplied URLs
 * have already been converted to a verified 11-character video ID. No shell. */
export class YtDlpClient {
  constructor({binary = 'yt-dlp', timeoutMs = 60000} = {}) {
    this.binary = binary;
    this.timeoutMs = timeoutMs;
  }

  execute(args) {
    return new Promise((resolve,reject) => {
      const child = spawn(this.binary, args, {shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe']});
      let stdout = '', stderr = '', bytes = 0, settled = false;
      const finish = (error, output) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(output);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new AppError('YouTube metadata request timed out. Try another video or update yt-dlp.', 504, 'YT_DLP_TIMEOUT'));
      }, this.timeoutMs);
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) {
          child.kill();
          finish(new AppError('YouTube response was too large to process.', 502, 'YT_DLP_OUTPUT_LIMIT'));
        } else stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-1500); });
      child.on('error', error => {
        const missing = error.code === 'ENOENT';
        finish(new AppError(missing
          ? 'yt-dlp is not installed or is not on PATH. See README setup instructions.'
          : 'Could not start yt-dlp. Check its installation and YT_DLP_PATH.',
        503, missing ? 'YT_DLP_MISSING' : 'YT_DLP_FAILED'));
      });
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) {
          finish(new AppError(`yt-dlp could not access this public video. ${stderr.replace(/https?:\/\/\S+/g,'[url]').slice(-240)}`.trim(), 502, 'YT_DLP_FAILED'));
          return;
        }
        try { finish(null, JSON.parse(stdout)); }
        catch { finish(new AppError('yt-dlp returned invalid metadata. Update yt-dlp.', 502, 'YT_DLP_INVALID_JSON')); }
      });
    });
  }

  async getVideo(videoId) {
    return this.execute([
      '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings',
      '--no-write-comments', '--ignore-no-formats-error',
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
  }

  async getTopComments(videoId, limit = 100) {
    const capped = Math.max(10, Math.min(200, limit));
    const result = await this.execute([
      '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings',
      '--write-comments', '--ignore-no-formats-error',
      '--extractor-args', `youtube:comment_sort=top;max_comments=${capped},${capped},0,0,1`,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    return Array.isArray(result.comments) ? result.comments.map(c => ({
      id: c.id,
      author: c.author,
      text: c.text,
      likes: c.like_count,
    })) : [];
  }
}
