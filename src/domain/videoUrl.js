import { AppError } from '../utils/AppError.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

export function parseYouTubeVideoId(input) {
  if (typeof input !== 'string' || input.length > 2048 || input.length === 0) {
    throw new AppError('Enter a valid YouTube video link.', 400, 'INVALID_URL');
  }
  const raw = input.trim();
  // A bare video ID is supported for convenience and never used as a network URL.
  if (VIDEO_ID.test(raw)) return raw;
  let url;
  try { url = new URL(raw); }
  catch { throw new AppError('Enter a full YouTube URL such as https://youtu.be/VIDEO_ID.', 400, 'INVALID_URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('Only HTTPS/HTTP YouTube links are supported.', 400, 'INVALID_URL');
  }
  const host = url.hostname.toLowerCase();
  let id;
  if (SHORT_HOSTS.has(host)) {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'live', 'embed', 'v'].includes(segments[0])) id = segments[1];
  }
  if (!VIDEO_ID.test(id ?? '')) {
    throw new AppError('This is not a supported YouTube video URL.', 400, 'INVALID_URL');
  }
  return id;
}

export function watchUrl(videoId, seconds = 0) {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}
