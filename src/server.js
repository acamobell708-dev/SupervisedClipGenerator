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
import { LowerVideoLibrary } from './services/lowerVideoLibrary.js';
import { SmartEndingService } from './services/smartEndingService.js';
import { AudioExcerptService } from './services/audioExcerptService.js';
import { TranscriptionWorker } from './services/transcriptionWorker.js';

const ytDlpClient = new YtDlpClient({binary: config.ytDlpPath, timeoutMs: config.ytDlpTimeoutMs});
const commentsClient = new YouTubeCommentsClient({apiKey:config.youtubeApiKey, sampleLimit:config.commentSampleLimit});
const ffmpegPath = /^ffmpeg(?:\.exe)?$/i.test(config.ffmpegPath) ? config.ffmpegPath : path.resolve(config.ffmpegPath);
const worker = new TranscriptionWorker({pythonPath: config.subtitlePythonPath, model: config.whisperModel,
  language: config.whisperLanguage, timeoutMs: config.subtitleTimeoutMs});
const subtitleService = new LocalSubtitleService({pythonPath: config.subtitlePythonPath, ffmpegPath,
  model: config.whisperModel, language: config.whisperLanguage, timeoutMs: config.subtitleTimeoutMs, worker});
const tapeService = new TapeSlowdownService({ffmpegPath, ffprobePath: config.ffprobePath, pythonPath: config.subtitlePythonPath});
const shortsService = new ShortsExportService({ffmpegPath});
const lowerVideoLibrary = new LowerVideoLibrary({directory: config.lowerVideosDirectory, ffmpegPath, ffprobePath: config.ffprobePath});
const downloadService = new ClipDownloadService({binary: config.ytDlpPath, ffmpegPath, subtitleService, tapeService, shortsService, lowerVideoLibrary});
const audioService = new AudioExcerptService({ytDlpClient, binary: config.ytDlpPath, ffmpegPath});
const logger = timing => console.info(JSON.stringify(timing));
const smartEndingService = new SmartEndingService({audioService, subtitleService, timeoutMs: config.endingCheckTimeoutMs, logger});
const service = new ClipDiscoveryService({ytDlpClient, commentsClient, smartEndingService,
  analysisTimeoutMs: config.analysisTimeoutMs, commentTimeoutMs: config.commentTimeoutMs, commentFetchTimeoutMs: config.commentFetchTimeoutMs, logger});
const app = createApp({service, downloadService, lowerVideoLibrary, smartEndingService, config});
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`SupervisedClipGenerator is running at http://localhost:${config.port}`);
  console.log('Keyless public replay discovery via yt-dlp; optional YouTube Data API for public comments.');
  worker.warm({signal: AbortSignal.timeout(20000)}).catch(() => console.info('Local speech worker is not ready; ending checks will keep labelled estimates until subtitle setup is available.'));
});
for (const signal of ['SIGINT','SIGTERM']) {
  process.once(signal, () => {service.close(); worker.close(); server.close(() => process.exit(0));});
}
