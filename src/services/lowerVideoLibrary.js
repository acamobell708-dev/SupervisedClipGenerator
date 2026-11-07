import { readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LOWER_VIDEO_CATEGORIES } from '../domain/lowerVideos.js';
import { runExportProcess } from './clipDownloadService.js';
import { matchingFfprobePath } from './tapeSlowdownService.js';
import { AppError } from '../utils/AppError.js';

const extensions = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

// Only catalogue IDs cross the API boundary; filesystem paths remain on the server.
export class LowerVideoLibrary {
  constructor({directory, ffmpegPath = 'ffmpeg', ffprobePath, run = runExportProcess, random = Math.random}) {
    this.directory = path.resolve(directory);
    this.ffprobePath = ffprobePath || matchingFfprobePath(ffmpegPath);
    this.run = run;
    this.random = random;
    this.metadata = new Map();
    this.rotation = [];
    this.lastRandomId = null;
  }

  async probe(filePath, signal) {
    const output = await this.run(this.ffprobePath, ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,duration,width,height', '-of', 'json', filePath], {
      signal, captureStdout: true, timeoutMs: 10_000,
      missingMessage: 'Lower videos need ffprobe from your FFmpeg installation. Check FFPROBE_PATH.',
      errorForExit: () => new AppError('Could not inspect the lower video.', 422, 'LOWER_VIDEO_INVALID'),
    });
    let data;
    try { data = JSON.parse(output); } catch { throw new AppError('Invalid media information.', 422, 'LOWER_VIDEO_INVALID'); }
    const video = data.streams?.find(stream => stream.codec_type === 'video');
    const duration = Number(video?.duration) > 0 ? Number(video.duration) : Number(data.format?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) {
      throw new AppError('The file needs a playable video stream and duration.', 422, 'LOWER_VIDEO_INVALID');
    }
    return {duration, width: video.width, height: video.height};
  }

  async scan(signal) {
    const categories = LOWER_VIDEO_CATEGORIES.map(category => ({...category, videos: []}));
    const assets = new Map(), warnings = [];
    let root;
    try { root = await realpath(this.directory); }
    catch (error) { if (error.code === 'ENOENT') return {categories, assets, warnings}; throw error; }
    const folders = [{folder: '', category: categories[0]}, ...categories.map(category => ({folder: category.id, category}))];
    for (const {folder, category} of folders) {
      let entries;
      try { entries = await readdir(path.join(root, folder), {withFileTypes: true}); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}))) {
        signal?.throwIfAborted();
        if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
        const relative = path.join(folder, entry.name), filePath = await realpath(path.join(root, relative));
        const resolvedRelative = path.relative(root, filePath);
        if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) continue;
        const file = await stat(filePath);
        const key = `${filePath}:${file.size}:${file.mtimeMs}`;
        let info = this.metadata.get(key);
        if (!info) {
          try { info = await this.probe(filePath, signal); }
          catch (error) {
            if (error.code !== 'LOWER_VIDEO_INVALID') throw error;
            warnings.push(`${entry.name}: not a playable video`);
            continue;
          }
          this.metadata.set(key, info);
        }
        const id = createHash('sha256').update(relative.replaceAll('\\', '/')).digest('hex').slice(0, 16);
        const asset = {id, label: path.parse(entry.name).name, category: category.id, ...info};
        category.videos.push(asset);
        assets.set(id, {...asset, filePath});
      }
    }
    return {categories, assets, warnings};
  }

  async catalogue(signal) {
    const {categories, warnings} = await this.scan(signal);
    return {categories, warnings};
  }

  async select(id = 'random', outputDuration, signal) {
    const {assets} = await this.scan(signal);
    if (!assets.size) throw new AppError('No lower videos are available. Add videos to docs/vids or turn Lower video off.', 422, 'LOWER_VIDEO_EMPTY');
    if (id === 'random') {
      this.rotation = this.rotation.filter(value => assets.has(value));
      if (!this.rotation.length) {
        this.rotation = [...assets.keys()];
        for (let i = this.rotation.length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [this.rotation[i], this.rotation[j]] = [this.rotation[j], this.rotation[i]];
        }
        if (this.rotation.length > 1 && this.rotation.at(-1) === this.lastRandomId) this.rotation.reverse();
      }
      id = this.rotation.pop();
      this.lastRandomId = id;
    }
    const asset = assets.get(id);
    if (!asset) throw new AppError('The selected lower video is unavailable. Refresh the list or choose Random.', 400, 'LOWER_VIDEO_NOT_FOUND');
    const startSeconds = Math.floor(this.random() * Math.max(0, asset.duration - outputDuration) * 1000) / 1000;
    return {...asset, startSeconds, outputDuration};
  }
}
