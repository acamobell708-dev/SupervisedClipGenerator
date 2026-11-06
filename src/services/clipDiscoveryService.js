import { parseYouTubeVideoId, watchUrl } from '../domain/videoUrl.js';
import { selectTopClips } from '../domain/heatmapRanker.js';
import { selectTimestampComments } from '../domain/timestampComments.js';
import { AppError } from '../utils/AppError.js';

export class ClipDiscoveryService {
  constructor({ytDlpClient, commentsClient, now = () => new Date()} = {}) {
    this.ytDlp = ytDlpClient;
    this.commentsClient = commentsClient;
    this.now = now;
  }

  async analyse(url) {
    const videoId = parseYouTubeVideoId(url);
    const raw = await this.ytDlp.getVideo(videoId);
    const durationSeconds = Math.floor(Number(raw.duration));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new AppError('Could not determine the video duration. Live streams are not supported.', 422, 'NO_DURATION');
    }
    const clips = selectTopClips(raw.heatmap, durationSeconds);
    const warnings = [];
    if (!Array.isArray(raw.heatmap) || !raw.heatmap.length) {
      warnings.push('YouTube did not expose a public Most Replayed heatmap for this video. No replay rankings can be verified.');
    } else if (clips.length < 5) {
      warnings.push(`Only ${clips.length} distinct, non-overlapping 10-second replay windows were available.`);
    }

    let comments = [], commentsSource = 'unavailable';
    if (this.commentsClient?.apiKey) {
      try {
        comments = await this.commentsClient.getTopComments(videoId);
        commentsSource = 'youtube-data-api';
      } catch (err) {
        warnings.push(`Official public comments unavailable: ${err.message}`);
      }
    }
    if (commentsSource === 'unavailable') {
      try {
        comments = await this.ytDlp.getTopComments(videoId);
        commentsSource = 'yt-dlp-public';
      } catch {
        warnings.push('Public comments could not be retrieved by yt-dlp. You can optionally add YOUTUBE_API_KEY to .env.');
      }
    }
    const timestampComments = selectTimestampComments(comments, durationSeconds, 3).map(comment => ({
      ...comment, url: watchUrl(videoId, comment.atSeconds),
    }));
    if (!comments.length && commentsSource !== 'unavailable') {
      warnings.push('No public comments were returned (comments may be disabled or extraction limited).');
    } else if (comments.length && timestampComments.length === 0) {
      warnings.push('No timestamped viewer comments were found in the bounded sample.');
    }

    return {
      status: 'ok',
      generatedAt: this.now().toISOString(),
      video: {
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: String(raw.title || 'Untitled YouTube video'),
        channel: String(raw.channel || raw.uploader || 'Unknown channel'),
        durationSeconds,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        viewCount: Number.isFinite(Number(raw.view_count)) ? Number(raw.view_count) : null,
        embeddable: raw.playable_in_embed !== false,
      },
      clips: clips.map(clip => ({...clip, url: watchUrl(videoId, clip.startSeconds)})),
      timestampComments,
      sources: {
        replay: clips.length ? 'public-most-replayed-heatmap-via-yt-dlp' : 'unavailable',
        comments: commentsSource,
        sampledCommentCount: comments.length,
        accuracy: 'Relative replay intensity is not an absolute view count or audience-retention measurement.',
      },
      warnings,
    };
  }
}
