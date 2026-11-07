import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkQueue } from '../utils/asyncWork.js';
import { runExportProcess } from './clipDownloadService.js';
import { AppError } from '../utils/AppError.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class AudioExcerptService {
  constructor({ytDlpClient, binary = 'yt-dlp', ffmpegPath = 'ffmpeg', run = runExportProcess,
    cacheRoot = path.join(root, '.cache/smart-audio'), tempRoot = tmpdir(), cacheTtlMs = 86400000} = {}) {
    Object.assign(this, {ytDlpClient, binary, ffmpegPath, run, cacheRoot, tempRoot, cacheTtlMs});
    this.queue = new WorkQueue(2);
  }
  async acquire(videoId, startSeconds, endSeconds, {signal} = {}) {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId) || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
        startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 12.01) throw new AppError('Invalid audio excerpt.', 400, 'INVALID_AUDIO_EXCERPT');
    const key = createHash('sha256').update(JSON.stringify(['pcm16k-v1', videoId, startSeconds, endSeconds])).digest('hex');
    const filePath = path.join(this.cacheRoot, `${key}.wav`);
    return this.queue.run(async () => {
      const existing = await stat(filePath).catch(() => null);
      if (existing?.isFile() && existing.size > 44 && Date.now() - existing.mtimeMs < this.cacheTtlMs) return {filePath, startSeconds, endSeconds, cached: true};
      let directory;
      try {
        directory = await mkdtemp(path.join(this.tempRoot, 'clip-audio-'));
        const metadata = await this.ytDlpClient.getVideo(videoId, {signal});
        await writeFile(path.join(directory, 'source.json'), JSON.stringify(metadata));
        await this.run(this.binary, ['--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--quiet',
          '--socket-timeout', '8', '--retries', '0', '--fragment-retries', '0', '--load-info-json', 'source.json',
          ...(/^ffmpeg(?:\.exe)?$/i.test(this.ffmpegPath) ? [] : ['--ffmpeg-location', this.ffmpegPath]),
          '--download-sections', `*${startSeconds}-${endSeconds}`, '-f', 'bestaudio', '-o', 'audio.%(ext)s'],
        {cwd: directory, signal, timeoutMs: 18000});
        const name = (await readdir(directory)).find(value => /^audio\.(m4a|webm|opus|mp3|ogg|wav|aac)$/i.test(value));
        if (!name || (await stat(path.join(directory, name))).size > 12 * 1024 * 1024) throw new AppError('Could not obtain a small audio excerpt.', 502, 'AUDIO_EXCERPT_FAILED');
        await this.run(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', name,
          '-t', String(endSeconds - startSeconds), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'excerpt.wav'],
        {cwd: directory, signal, timeoutMs: 10000});
        const audio = await readFile(path.join(directory, 'excerpt.wav'));
        if (audio.length <= 44 || audio.length > 1024 * 1024) throw new AppError('Invalid audio excerpt size.', 502, 'AUDIO_EXCERPT_FAILED');
        signal?.throwIfAborted();
        await mkdir(this.cacheRoot, {recursive: true});
        const temporary = path.join(this.cacheRoot, `${key}.${randomUUID()}.tmp`);
        await writeFile(temporary, audio);
        await rename(temporary, filePath);
        return {filePath, startSeconds, endSeconds, cached: false};
      } finally {
        if (directory && path.dirname(path.resolve(directory)) === path.resolve(this.tempRoot) && path.basename(directory).startsWith('clip-audio-')) {
          await rm(directory, {recursive: true, force: true, maxRetries: 3});
        }
      }
    }, signal);
  }
}
