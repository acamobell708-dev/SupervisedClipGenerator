import path from 'node:path';
import { buildVideoFilterGraph } from '../domain/shortsLayout.js';
import { AppError } from '../utils/AppError.js';
import { runExportProcess } from './clipDownloadService.js';

export class ShortsExportService {
  constructor({ffmpegPath = 'ffmpeg', run = runExportProcess} = {}) {
    this.ffmpegPath = ffmpegPath;
    this.run = run;
  }
  async render({directory, subtitles = false, signal}) {
    await this.run(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', 'clip.mp4',
      '-filter_complex', buildVideoFilterGraph({shorts: true, subtitles}), '-map', '[video]', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'clip-shorts.mp4'], {
      cwd: directory, signal, timeoutMs: 300_000,
      errorForExit: () => new AppError('Could not render the Shorts layout. Check FFmpeg scaling/blur/libx264 support or turn Shorts 9:16 off.', 502, 'SHORTS_RENDER_FAILED'),
    });
    return path.join(directory, 'clip-shorts.mp4');
  }
}
