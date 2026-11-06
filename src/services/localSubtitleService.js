import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExportProcess } from './clipDownloadService.js';
import { buildSubtitleAss } from '../domain/subtitles.js';
import { AppError } from '../utils/AppError.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export class LocalSubtitleService {
  constructor({pythonPath, ffmpegPath = 'ffmpeg', model = 'base', language = 'auto', timeoutMs = 300_000, run = runExportProcess} = {}) {
    this.pythonPath = pythonPath || path.join(root, '.venv-subtitles', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    this.ffmpegPath = ffmpegPath;
    this.model = model;
    this.language = language;
    this.timeoutMs = timeoutMs;
    this.run = run;
  }
  pythonArguments() {
    return [path.join(root, 'scripts/transcribe.py'), '--model', this.model, '--language', this.language,
      '--model-dir', path.join(root, '.cache/whisper-models'), '--cache-dir', path.join(root, '.cache/transcripts')];
  }
  processOptions(signal) {
    return {signal, timeoutMs: this.timeoutMs,
      missingMessage: 'Local subtitles need setup. Run npm run setup:subtitles, then restart the app.',
      timeoutMessage: 'Local subtitle generation timed out. Try WHISPER_MODEL=tiny or turn subtitles off.',
      errorForExit: stderr => {
        if (stderr.includes('SUBTITLES_SETUP_REQUIRED')) return new AppError('Local subtitles need setup. Run npm run setup:subtitles, then restart the app.', 503, 'SUBTITLES_SETUP_REQUIRED');
        if (stderr.includes('SUBTITLES_NO_SPEECH')) return new AppError('No speech was detected. Turn off white subtitles to download the original clip.', 422, 'SUBTITLES_NO_SPEECH');
        return new AppError('Local transcription failed. Check the Python setup and WHISPER_LANGUAGE, or turn subtitles off.', 502, 'SUBTITLES_FAILED');
      },
    };
  }
  async check({signal} = {}) {
    await this.run(this.pythonPath, [...this.pythonArguments(), '--check'], {...this.processOptions(signal), timeoutMs: 30_000});
  }
  async render({filePath, directory, duration, signal}) {
    await this.run(this.pythonPath, [...this.pythonArguments(), '--input', filePath, '--output', path.join(directory, 'transcript.json')], this.processOptions(signal));
    let transcript;
    try { transcript = JSON.parse(await readFile(path.join(directory, 'transcript.json'), 'utf8')); }
    catch { throw new AppError('Local transcription returned invalid data. Please retry.', 502, 'SUBTITLES_INVALID'); }
    await writeFile(path.join(directory, 'captions.ass'), buildSubtitleAss(transcript, duration), 'utf8');
    await this.run(this.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', 'clip.mp4',
      '-vf', 'ass=captions.ass', '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
      '-c:a', 'copy', '-movflags', '+faststart', 'clip-captioned.mp4'], {
      cwd: directory, signal, timeoutMs: this.timeoutMs,
      errorForExit: () => new AppError('Could not render subtitles. FFmpeg needs libass and libx264 support.', 503, 'SUBTITLES_RENDER_FAILED'),
    });
    return path.join(directory, 'clip-captioned.mp4');
  }
}
