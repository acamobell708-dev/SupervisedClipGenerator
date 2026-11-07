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
  if (input.subtitles !== undefined && typeof input.subtitles !== 'boolean') {
    throw new AppError('subtitles must be true or false.', 400, 'INVALID_SUBTITLE_OPTION');
  }
  if (input.tapeSlowdown !== undefined && typeof input.tapeSlowdown !== 'boolean') {
    throw new AppError('tapeSlowdown must be true or false.', 400, 'INVALID_TAPE_OPTION');
  }
  if (input.shorts !== undefined && typeof input.shorts !== 'boolean') {
    throw new AppError('shorts must be true or false.', 400, 'INVALID_SHORTS_OPTION');
  }
  return { videoId, startSeconds, endSeconds, ...(input.subtitles === undefined ? {} : {subtitles: input.subtitles}),
    ...(input.tapeSlowdown === undefined ? {} : {tapeSlowdown: input.tapeSlowdown}),
    ...(input.shorts === undefined ? {} : {shorts: input.shorts}) };
}

// No shell or user-controlled process arguments. Stop FFmpeg children as well as yt-dlp.
export function runExportProcess(binary, args, { cwd, signal, timeoutMs = 180_000, missingMessage, timeoutMessage, errorForExit, captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError('Download cancelled.', 499, 'DOWNLOAD_CANCELLED'));
    const child = spawn(binary, args, {
      cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
    });
    let stoppedError;
    let stderr = '';
    let stdout = '';
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
    const timer = setTimeout(() => stop(new AppError(timeoutMessage || 'Clip preparation timed out. Please retry.', 504, 'DOWNLOAD_TIMEOUT')), timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > 128 * 1024) stop(new AppError('Media inspection output was too large.', 502, 'MEDIA_OUTPUT_LIMIT'));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', error => {
      cleanup();
      reject(new AppError(missingMessage || (error.code === 'ENOENT'
        ? `${path.basename(binary)} is not installed or not on PATH. Install yt-dlp and FFmpeg, then restart the app.`
        : `Could not start ${path.basename(binary)}. Check its configured path.`), 503, 'DOWNLOAD_TOOL_MISSING'));
    });
    child.once('close', code => {
      cleanup();
      if (stoppedError) return reject(stoppedError);
      if (code === 0) return resolve(captureStdout ? stdout : undefined);
      if (errorForExit) return reject(errorForExit(stderr));
      const missingFfmpeg = /ffmpeg.*(not found|not installed|could not find)/i.test(stderr);
      reject(new AppError(missingFfmpeg
        ? 'FFmpeg is unavailable. Install it or set FFMPEG_PATH, then restart the app.'
        : 'Could not prepare this clip. Update yt-dlp and check that the public video offers MP4 video and audio.',
      missingFfmpeg ? 503 : 502, 'DOWNLOAD_FAILED'));
    });
  });
}

export class ClipDownloadService {
  constructor({ binary = 'yt-dlp', ffmpegPath = 'ffmpeg', subtitleService, tapeService, shortsService, run = runExportProcess, tempRoot = tmpdir() } = {}) {
    this.binary = binary;
    // yt-dlp expects --ffmpeg-location to be an existing path, not a PATH command.
    this.ffmpegPath = /^ffmpeg(?:\.exe)?$/i.test(ffmpegPath) ? ffmpegPath : path.resolve(ffmpegPath);
    this.run = run;
    this.subtitleService = subtitleService;
    this.tapeService = tapeService;
    this.shortsService = shortsService;
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
    const { videoId, startSeconds, endSeconds, subtitles = false, tapeSlowdown = false, shorts = false } = validateClipDownload(input);
    if (subtitles && !this.subtitleService) throw new AppError('Local subtitles need setup. Run npm run setup:subtitles, then restart the app.', 503, 'SUBTITLES_SETUP_REQUIRED');
    if (tapeSlowdown && !this.tapeService) throw new AppError('Tape slowdown is unavailable. Restart the app or turn the effect off.', 503, 'TAPE_UNAVAILABLE');
    if (shorts && !tapeSlowdown && !this.shortsService) throw new AppError('Shorts layout is unavailable. Restart the app or turn Shorts 9:16 off.', 503, 'SHORTS_UNAVAILABLE');
    if (this.busy) throw new AppError('Another test clip is being prepared. Please wait and retry.', 409, 'DOWNLOAD_BUSY');
    this.busy = true;
    let directory;
    try {
      if (subtitles) await this.subtitleService.check({signal});
      if (tapeSlowdown) await this.tapeService.check({signal});
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
      let filePath = path.join(directory, 'clip.mp4');
      let file = await stat(filePath).catch(() => null);
      if (!file?.isFile() || file.size === 0) {
        throw new AppError('No playable clip was produced. Try another segment.', 502, 'EMPTY_CLIP');
      }
      if (file.size > 50 * 1024 * 1024) {
        throw new AppError('The test clip exceeds the 50 MB download limit.', 413, 'CLIP_TOO_LARGE');
      }
      if (tapeSlowdown) {
        const plan = await this.tapeService.plan({directory, signal});
        if (subtitles) await this.subtitleService.prepareCaptions({filePath, directory, duration: plan.duration, mapTime: plan.mapTime, shorts, signal});
        filePath = await this.tapeService.render({directory, plan, subtitles, shorts, signal});
      } else if (shorts) {
        if (subtitles) await this.subtitleService.prepareCaptions({filePath, directory, duration: endSeconds - startSeconds, shorts: true, signal});
        filePath = await this.shortsService.render({directory, subtitles, signal});
      } else if (subtitles) {
        filePath = await this.subtitleService.render({filePath, directory, duration: endSeconds - startSeconds, signal});
      }
      if (subtitles || tapeSlowdown || shorts) {
        file = await stat(filePath).catch(() => null);
        if (!file?.isFile() || file.size === 0) throw new AppError('No processed clip was produced. Please retry.', 502, 'RENDER_EMPTY');
        if (file.size > 50 * 1024 * 1024) throw new AppError('The processed clip exceeds the 50 MB download limit.', 413, 'CLIP_TOO_LARGE');
      }
      return {
        filePath,
        filename: `test-clip-${videoId}-${startSeconds}-${endSeconds}${subtitles ? '-subtitled' : ''}${tapeSlowdown ? '-tape' : ''}${shorts ? '-shorts' : ''}.mp4`,
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
