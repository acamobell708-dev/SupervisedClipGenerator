import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseYouTubeVideoId } from '../domain/videoUrl.js';
import { AppError } from '../utils/AppError.js';

export function validateClipDownload(input) {
  const videoId = parseYouTubeVideoId(input?.videoId);
  const { startSeconds, endSeconds } = input;
  if (typeof startSeconds !== 'number' || typeof endSeconds !== 'number' ||
      !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
      startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 15 ||
      endSeconds > 7 * 24 * 60 * 60) {
    throw new AppError('Choose a valid clip longer than 0 and no longer than 15 seconds.', 400, 'INVALID_CLIP_RANGE');
  }
  return { videoId, startSeconds, endSeconds };
}

// No shell or user-controlled process arguments. Stop FFmpeg children as well as yt-dlp.
export function runExportProcess(binary, args, { cwd, signal, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError('Download cancelled.', 499, 'DOWNLOAD_CANCELLED'));
    const child = spawn(binary, args, {
      cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stoppedError;
    let stderr = '';
    const stop = error => {
      if (stoppedError) return;
      stoppedError = error;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          shell: false, windowsHide: true, stdio: 'ignore',
        });
        killer.once('error', () => child.kill());
        killer.once('close', code => { if (code !== 0) child.kill(); });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); }
      }
    };
    const onAbort = () => stop(new AppError('Download cancelled.', 499, 'DOWNLOAD_CANCELLED'));
    const timer = setTimeout(() => stop(new AppError('Clip preparation timed out. Please retry.', 504, 'DOWNLOAD_TIMEOUT')), timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', error => {
      cleanup();
      reject(new AppError(error.code === 'ENOENT'
        ? `${path.basename(binary)} is not installed or not on PATH. Install yt-dlp and FFmpeg, then restart the app.`
        : `Could not start ${path.basename(binary)}. Check its configured path.`, 503, 'DOWNLOAD_TOOL_MISSING'));
    });
    child.once('close', code => {
      cleanup();
      if (stoppedError) return reject(stoppedError);
      if (code === 0) return resolve();
      const missingFfmpeg = /ffmpeg.*(not found|not installed|could not find)/i.test(stderr);
      reject(new AppError(missingFfmpeg
        ? 'FFmpeg is unavailable. Install it or set FFMPEG_PATH, then restart the app.'
        : 'Could not prepare this clip. Update yt-dlp and check that the public video offers MP4 video and audio.',
      missingFfmpeg ? 503 : 502, 'DOWNLOAD_FAILED'));
    });
  });
}

export class ClipDownloadService {
  constructor({ binary = 'yt-dlp', ffmpegPath = 'ffmpeg', run = runExportProcess, tempRoot = tmpdir() } = {}) {
    this.binary = binary;
    // yt-dlp expects --ffmpeg-location to be an existing path, not a PATH command.
    this.ffmpegPath = /^ffmpeg(?:\.exe)?$/i.test(ffmpegPath) ? ffmpegPath : path.resolve(ffmpegPath);
    this.run = run;
    this.tempRoot = tempRoot;
    this.busy = false;
  }

  async removeTemporaryDirectory(directory) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(this.tempRoot) || !path.basename(resolved).startsWith('clipfoundry-')) {
      throw new Error('Refusing to remove a directory outside the clip export temporary folder.');
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }

  async prepare(input, { signal } = {}) {
    const { videoId, startSeconds, endSeconds } = validateClipDownload(input);
    if (this.busy) throw new AppError('Another test clip is being prepared. Please wait and retry.', 409, 'DOWNLOAD_BUSY');
    this.busy = true;
    let directory;
    try {
      await this.run(this.ffmpegPath, ['-version'], { signal, timeoutMs: 10_000 });
      directory = await mkdtemp(path.join(this.tempRoot, 'clipfoundry-'));
      await this.run(this.binary, [
        '--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--quiet',
        '--socket-timeout', '15', '--retries', '2', '--fragment-retries', '2',
        ...(/^ffmpeg(?:\.exe)?$/i.test(this.ffmpegPath) ? [] : ['--ffmpeg-location', this.ffmpegPath]),
        '--download-sections', `*${startSeconds}-${endSeconds}`, '--force-keyframes-at-cuts',
        '-f', 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]',
        '--merge-output-format', 'mp4', '-o', 'clip.%(ext)s',
        `https://www.youtube.com/watch?v=${videoId}`,
      ], { cwd: directory, signal });
      const filePath = path.join(directory, 'clip.mp4');
      const file = await stat(filePath).catch(() => null);
      if (!file?.isFile() || file.size === 0) {
        throw new AppError('No playable clip was produced. Try another segment.', 502, 'EMPTY_CLIP');
      }
      if (file.size > 50 * 1024 * 1024) {
        throw new AppError('The test clip exceeds the 50 MB download limit.', 413, 'CLIP_TOO_LARGE');
      }
      return {
        filePath,
        filename: `test-clip-${videoId}-${startSeconds}-${endSeconds}.mp4`,
        cleanup: () => this.removeTemporaryDirectory(directory),
      };
    } catch (error) {
      if (directory) await this.removeTemporaryDirectory(directory);
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
