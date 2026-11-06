import 'dotenv/config';

function integerEnv(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export const config = Object.freeze({
  port: integerEnv(process.env.PORT, 3000, 1, 65535),
  ytDlpPath: process.env.YT_DLP_PATH?.trim() || 'yt-dlp',
  ytDlpTimeoutMs: integerEnv(process.env.YT_DLP_TIMEOUT_MS, 60000, 5000, 120000),
  youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim() || '',
  commentSampleLimit: integerEnv(process.env.COMMENT_SAMPLE_LIMIT, 100, 10, 200),
});
