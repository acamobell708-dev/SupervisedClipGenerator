import { config } from './config.js';
import path from 'node:path';
import { createApp } from './app.js';
import { YtDlpClient } from './services/ytDlpClient.js';
import { YouTubeCommentsClient } from './services/youtubeCommentsClient.js';
import { ClipDiscoveryService } from './services/clipDiscoveryService.js';
import { ClipDownloadService } from './services/clipDownloadService.js';
import { LocalSubtitleService } from './services/localSubtitleService.js';
import { TapeSlowdownService } from './services/tapeSlowdownService.js';
import { ShortsExportService } from './services/shortsExportService.js';

const ytDlpClient = new YtDlpClient({binary: config.ytDlpPath, timeoutMs: config.ytDlpTimeoutMs});
const commentsClient = new YouTubeCommentsClient({apiKey:config.youtubeApiKey, sampleLimit:config.commentSampleLimit});
const service = new ClipDiscoveryService({ytDlpClient, commentsClient});
const ffmpegPath = /^ffmpeg(?:\.exe)?$/i.test(config.ffmpegPath) ? config.ffmpegPath : path.resolve(config.ffmpegPath);
const subtitleService = new LocalSubtitleService({pythonPath: config.subtitlePythonPath, ffmpegPath,
  model: config.whisperModel, language: config.whisperLanguage, timeoutMs: config.subtitleTimeoutMs});
const tapeService = new TapeSlowdownService({ffmpegPath, ffprobePath: config.ffprobePath, pythonPath: config.subtitlePythonPath});
const shortsService = new ShortsExportService({ffmpegPath});
const downloadService = new ClipDownloadService({binary: config.ytDlpPath, ffmpegPath, subtitleService, tapeService, shortsService});
const app = createApp({service, downloadService, config});
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`SupervisedClipGenerator is running at http://localhost:${config.port}`);
  console.log('Keyless public replay discovery via yt-dlp; optional YouTube Data API for public comments.');
});
for (const signal of ['SIGINT','SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
