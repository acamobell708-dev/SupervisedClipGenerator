import { config } from './config.js';
import { createApp } from './app.js';
import { YtDlpClient } from './services/ytDlpClient.js';
import { YouTubeCommentsClient } from './services/youtubeCommentsClient.js';
import { ClipDiscoveryService } from './services/clipDiscoveryService.js';

const ytDlpClient = new YtDlpClient({binary: config.ytDlpPath, timeoutMs: config.ytDlpTimeoutMs});
const commentsClient = new YouTubeCommentsClient({apiKey:config.youtubeApiKey, sampleLimit:config.commentSampleLimit});
const service = new ClipDiscoveryService({ytDlpClient, commentsClient});
const app = createApp({service, config});
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`SupervisedClipGenerator is running at http://localhost:${config.port}`);
  console.log('Keyless public replay discovery via yt-dlp; optional YouTube Data API for public comments.');
});
for (const signal of ['SIGINT','SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
