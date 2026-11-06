# Architecture (v0.1)

```text
Browser (public/index.html + public/styles/app.css)
    ↳ public/assets/app.js (built from src/client/*.jsx)
    ↳ POST /api/analyse   GET /api/demo
Express server (src/server.js → src/app.js)
    ↳ ClipDiscoveryService
         ↳ parseYouTubeVideoId (strict allowlist; canonical ID only)
         ↳ YtDlpClient (spawn local yt-dlp, no shell, no media downloads)
         ↳ normaliseHeatmap / selectTopClips (pure deterministic ranking)
         ↳ YouTubeCommentsClient (optional official public commentThreads API)
           or yt-dlp comments fallback (bounded)
         ↳ extractTimestamps / selectTimestampComments (pure ranking)
    ↳ JSON response with video, clips, comments, provenance, warnings
```

## Clip algorithm

1. Read heatmap bins (`start_time`, `end_time`, `value` in [0,1]) as *relative* replay intensity.
2. Build candidate 10-second windows at sample boundaries/centres (clamped to video length).
3. Score a window using overlap-weighted average intensity of heatmap bins.
4. Sort candidates by intensity and greedily choose the first five **non-overlapping** windows; return fewer if insufficient usable data.
5. Never infer counts from intensity. Missing heatmaps return an empty clip list plus a warning.

## Comments algorithm

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

- The server binds to `127.0.0.1`, and only YouTube video IDs validated in the domain module reach a subprocess/network URL.
- External process is invoked with a fixed argument array, `shell:false`, 12 MB output limit and a configurable timeout.
- API credentials stay in `.env` on the server. Frontend receives only public fields and source links.
- `.env` and generated bundles are gitignored; no OpenAI requests are made.
- Tests use fakes/offline fixtures; live extraction is inherently susceptible to YouTube site changes, blocks and rate limiting.
