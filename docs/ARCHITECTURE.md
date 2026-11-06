# Architecture (v0.1)

```text
Browser (public/index.html + public/styles/app.css)
    ↳ public/assets/app.js (built from src/client/*.jsx)
    ↳ POST /api/analyse   GET /api/demo   POST /api/clips/download
Express server (src/server.js → src/app.js)
    ↳ ClipDiscoveryService
         ↳ parseYouTubeVideoId (strict allowlist; canonical ID only)
         ↳ YtDlpClient (spawn local yt-dlp, no shell, discovery does not download media)
         ↳ normaliseHeatmap / selectTopClips (pure deterministic ranking)
         ↳ YouTubeCommentsClient (optional official public commentThreads API)
           or yt-dlp comments fallback (bounded)
         ↳ extractTimestamps / selectTimestampComments (pure ranking)
    ↳ JSON response with video, clips, comments, provenance, warnings
    ↳ ClipDownloadService (explicit test-download button only)
         ↳ validate YouTube ID and finite range, maximum 15 seconds
         ↳ yt-dlp --download-sections + FFmpeg, MP4 up to 720p
         ↳ temporary MP4 attachment; delete job directory after transfer/failure
```

## Clip algorithm

1. Read heatmap bins (`start_time`, `end_time`, `value` in [0,1]) as *relative* replay intensity.
2. Build candidate 10-second windows at sample boundaries/centres (clamped to video length).
3. Score a window using overlap-weighted average intensity of heatmap bins.
4. Sort candidates by intensity and greedily choose the first five **non-overlapping** windows; return fewer if insufficient usable data.
5. Never infer counts from intensity. Missing heatmaps return an empty clip list plus a warning.

## Comments algorithm

The client normalises replay and comment candidates with `getReviewClips`. Comment cards follow replay cards and retain their distinct evidence source, first-sentence excerpt and original comment metadata. Their windows start at the mentioned timestamp and end after 10 seconds or at the video end. Both sources share card selection, approvals, manifest export and the MP4 download route; if no replay clips exist, the first comment clip is selected automatically.

- Use official `commentThreads.list(part=snippet, order=relevance, textFormat=plainText)` if `YOUTUBE_API_KEY` exists. Sample is bounded; no OAuth needed.
- Otherwise attempt a bounded `yt-dlp --write-comments` call sorted by top comments; if it fails, still return replay results with a comment warning.
- Parse m:ss/h:mm:ss textual references, validate in-range and reject chapter/index lists.
- Rank by likes within the fetched sample, dedupe near-identical times and take up to three.

## Future plugin-style extension points

- **VideoSelector**: choose video from a channel.
- **MomentCandidateProvider**: YouTube heatmap, public comment clusters, owner retention, transcript candidates.
- **MomentRanker**: calibrate distinct kinds of evidence separately; don't conflate sources.
- **ClipEditor**: FFmpeg crops/subtitles/pitch/effects with deterministic template parameters.
- **UploadQueue**: destination OAuth, job status, idempotency, quota budget, user confirmation.
- **Storage**: saved projects and approval revisions.

## Security and operational constraints

- Optional subtitle rendering runs after clip acquisition and before attachment delivery. `LocalSubtitleService` invokes `scripts/transcribe.py` in the isolated `.venv-subtitles` environment. faster-whisper uses CPU/int8, word timestamps, VAD and local-only model loading; only `npm run setup:subtitles` downloads weights. Decoded audio/model/language hashes key the local JSON transcript cache. The domain module validates times, clamps to clip duration, groups phrases and escapes ASS control syntax; FFmpeg burns fixed-name `captions.ass` into a temporary H.264 MP4. Source, transcript copy, ASS and render are cleaned together. Persistent model/transcript caches are gitignored. Subtitle setup failures are detected before media acquisition; no-speech errors never silently return raw video. Both download modes pass an explicit boolean option; the batch manifest records it.

- The batch button snapshots approved replay/comment windows and calls the existing download route sequentially. The client packages the resulting MP4 blobs and a JSON manifest into one stored ZIP. It uses the same abort controller as individual downloads, prevents concurrent download actions in the UI, and saves the ZIP only after every approved clip succeeds. No upload API is called.

- Test downloads use fixed argument arrays with local yt-dlp configuration ignored, an isolated temporary directory, one preparation at a time, a 180-second process timeout and a 50 MB response limit. Client disconnect/cancellation stops the process tree and cleans temporary files. FFmpeg can be configured with `FFMPEG_PATH`; missing tools produce actionable UI errors.

- The server binds to `127.0.0.1`, and only YouTube video IDs validated in the domain module reach a subprocess/network URL.
- External process is invoked with a fixed argument array, `shell:false`, 12 MB output limit and a configurable timeout.
- API credentials stay in `.env` on the server. Frontend receives only public fields and source links.
- `.env` and generated bundles are gitignored; no OpenAI requests are made.
- Tests use fakes/offline fixtures; live extraction is inherently susceptible to YouTube site changes, blocks and rate limiting.
