import { AppError } from '../utils/AppError.js';

/** Public YouTube Data API v3 commentThreads.list. API key only: NO channel OAuth. */
export class YouTubeCommentsClient {
  constructor({apiKey, fetchImpl = fetch, sampleLimit = 100} = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.sampleLimit = sampleLimit;
  }

  async getTopComments(videoId, {signal} = {}) {
    if (!this.apiKey) throw new AppError('No YouTube API key configured.', 503, 'API_KEY_MISSING');
    const comments = [];
    let pageToken;
    while (comments.length < this.sampleLimit) {
      const params = new URLSearchParams({
        key: this.apiKey,
        videoId,
        part: 'snippet',
        order: 'relevance',
        textFormat: 'plainText',
        maxResults: String(Math.min(100, this.sampleLimit - comments.length)),
      });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await this.fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${params}`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        throw new AppError(
          response.status === 403 ? 'YouTube comments unavailable (disabled, quota exceeded or API key restricted).' : 'YouTube public comment request failed.',
          502, 'YOUTUBE_COMMENTS_UNAVAILABLE',
        );
      }
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      for (const item of items) {
        const snippet = item?.snippet?.topLevelComment?.snippet;
        if (!snippet) continue;
        comments.push({
          id: item.snippet.topLevelComment.id || item.id,
          author: snippet.authorDisplayName || 'YouTube viewer',
          text: snippet.textOriginal || snippet.textDisplay || '',
          likes: snippet.likeCount || 0,
        });
      }
      pageToken = data.nextPageToken;
      if (!pageToken || items.length === 0) break;
    }
    return comments;
  }
}
