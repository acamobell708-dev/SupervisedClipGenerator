import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTapeTimeline } from '../domain/tapeSlowdown.js';
import { buildVideoFilterGraph } from '../domain/shortsLayout.js';
import { AppError } from '../utils/AppError.js';
import { runExportProcess } from './clipDownloadService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function matchingFfprobePath(ffmpegPath) {
  return /^ffmpeg(?:\.exe)?$/i.test(ffmpegPath) ? 'ffprobe' : path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
}

export class TapeSlowdownService {
  constructor({ffmpegPath = 'ffmpeg', ffprobePath, pythonPath, run = runExportProcess} = {}) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath || matchingFfprobePath(ffmpegPath);
    this.pythonPath = pythonPath || path.join(root, '.venv-subtitles', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    this.run = run;
  }
  async check({signal} = {}) {
    await this.run(this.pythonPath, [path.join(root, 'scripts/tape_slowdown.py'), '--check'], this.processOptions(signal));
  }
  processOptions(signal) {
    return {signal, timeoutMs: 300_000,
      missingMessage: 'Tape slowdown needs the local Python environment. Run npm run setup:subtitles, then restart the app.',
      errorForExit: stderr => new AppError(stderr.includes('TAPE_SETUP_REQUIRED')
        ? 'Tape slowdown needs NumPy and PyAV. Run npm run setup:subtitles, then restart the app.'
        : 'Local tape audio processing failed. Try another clip or turn tape slowdown off.',
      stderr.includes('TAPE_SETUP_REQUIRED') ? 503 : 502, 'TAPE_AUDIO_FAILED'),
    };
  }
  async plan({directory, signal}) {
    const output = await this.run(this.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', 'clip.mp4'], {
      cwd: directory, signal, captureStdout: true, timeoutMs: 10_000,
      missingMessage: 'Tape slowdown needs ffprobe from your FFmpeg installation. Check FFPROBE_PATH or turn the effect off.',
      errorForExit: () => new AppError('Could not inspect the clip for tape slowdown.', 502, 'TAPE_PROBE_FAILED'),
    });
    let metadata;
    try { metadata = JSON.parse(output); }
    catch { throw new AppError('ffprobe returned invalid clip information.', 502, 'TAPE_PROBE_FAILED'); }
    const video = metadata.streams?.find(stream => stream.codec_type === 'video');
    if (!video) throw new AppError('Tape slowdown requires a video stream.', 422, 'TAPE_NO_VIDEO');
    const duration = Number(video.duration) > 0 ? Number(video.duration) : Number(metadata.format?.duration);
    return {...createTapeTimeline(duration), hasAudio: metadata.streams.some(stream => stream.codec_type === 'audio')};
  }
  async render({directory, plan, subtitles = false, shorts = false, signal}) {
    if (plan.hasAudio) await this.run(this.pythonPath, [path.join(root, 'scripts/tape_slowdown.py'),
      '--input', path.join(directory, 'clip.mp4'), '--output', path.join(directory, 'tape-audio.wav'),
      '--duration', String(plan.duration)], this.processOptions(signal));
    const filter = buildVideoFilterGraph({beforeLayout: plan.videoFilter, shorts, subtitles});
    await this.run(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', 'clip.mp4',
      ...(plan.hasAudio ? ['-i', 'tape-audio.wav'] : []),
      '-filter_complex', filter, '-map', '[video]', ...(plan.hasAudio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'clip-tape.mp4'], {
      cwd: directory, signal, timeoutMs: 300_000,
      errorForExit: () => new AppError('Tape slowdown rendering failed. Check FFmpeg/libx264 support or turn the effect off.', 502, 'TAPE_RENDER_FAILED'),
    });
    return path.join(directory, 'clip-tape.mp4');
  }
}
