# Architecture (v0.1)

```text
Browser (public/index.html + public/styles/app.css)
    ↳ public/assets/app.js (built from src/client/*.jsx)
    ↳ POST /api/analyse   GET /api/demo   GET /api/lower-videos   POST /api/clips/download
Express server (src/server.js → src/app.js)
    ↳ ClipDiscoveryService
         ↳ parseYouTubeVideoId (strict allowlist; canonical ID only)
         ↳ YtDlpClient (spawn local yt-dlp, no shell, discovery does not download media)
         ↳ normaliseHeatmap / selectTopClips (pure deterministic ranking)
         ↳ YouTubeCommentsClient (optional official public commentThreads API)
           or yt-dlp comments fallback (bounded)
         ↳ extractTimestamps / selectTimestampComments (pure ranking)
    ↳ JSON response with video, clips, comments, provenance, warnings
    ↳ ClipDownloadService (individual download icons and approved-batch export)
         ↳ validate YouTube ID and finite range, maximum 30 seconds
         ↳ yt-dlp --download-sections + FFmpeg, MP4 up to 720p
         ↳ temporary MP4 attachment; delete job directory after transfer/failure
```

## Clip algorithm

1. Read heatmap bins (`start_time`, `end_time`, `value` in [0,1]) as *relative* replay intensity.
2. Build candidate 25-second windows at bucket boundaries, boundaries shifted back by the window length, and bucket centres (clamped to video length). Recompute intensity over the full window rather than extending shorter winners.
3. Score a window using overlap-weighted average intensity of heatmap bins.
4. Sort candidates by intensity and greedily choose the first five **non-overlapping** windows; return fewer if insufficient usable data.
5. Never infer counts from intensity. Missing heatmaps return an empty clip list plus a warning.

## Smart ending

`React smartEnding → POST /api/analyse → ClipDiscoveryService → suggestSmartEnding → cached decision or pending ending`. The option defaults on in the UI/API; disabling it rebuilds fixed 25-second windows and clears approvals on success. Analysis does no media acquisition or transcription. Metadata and comments start concurrently, with a 22-second metadata limit inside an overall 25-second analysis deadline. The six-second initial comment wait does not cancel retrieval: bounded background jobs can continue for 45 seconds. Metadata failures return an actionable error. Metadata/comments have a bounded five-minute cache. Response timings, `Server-Timing` and structured logs separate overlapping stages. The offline demo remains synthetic and requires no media.

The pure domain rule checks covered one-second samples with a three-second moving average, using a 25-second target and 15–30 second bounds. A weak final run below 40% of the smoothed clip peak must persist for at least three seconds after both the peak and minimum length. Temporary dips that recover before the target end do not shorten the clip. Flat, missing, overlapping or gapped evidence preserves the target. If the final three seconds remain above 60% of the peak, consecutive strong samples can extend the end to 30 seconds. These are replay-interest heuristics, not owner retention statistics. A near-25-second average is a target, not a guarantee.

Selecting a changed clip calls `POST /api/clips/refine-ending` with a server-issued token. At most 512 token contexts live for 30 minutes; clients cannot supply paths, download URLs or arbitrary analysis ranges. The service checks a 24-hour decision cache before downloading. `AudioExcerptService` requests only `bestaudio` for up to 12 seconds (eight before/four after the suggested end), reusing cached extractor metadata via `--load-info-json`. It does no video encoding/keyframe forcing. FFmpeg creates 16 kHz mono PCM; a 24-hour audio cache prevents duplicate downloads. Two bounded audio jobs can overlap one queued speech worker. Temp directories are checked before recursive cleanup.

`TranscriptionWorker` talks JSON-lines over private stdin/stdout to `transcribe_worker.py`, with one CPU/int8 model held in memory. Startup warms the model without delaying HTTP listening. CLI setup and the worker share `transcription_core.py`; the original audio-hash transcript cache and export caption path remain supported. No Python network listener or new package is added. Cancellation/timeout kills an active worker; it restarts on the next job. A cancelled queued job leaves other jobs intact.

Excerpt word times are offset back to the full source timeline before `snapSmartEnding` chooses a sentence/pause within 1.5 seconds, otherwise a word end, bounded by minimum length, the peak and the next replay clip's start. A separate 25-second budget returns a labelled, unchanged heatmap ending if speech is unavailable. The client disables approval/download while pending, deduplicates selected-clip requests and rejects stale or approved-clip updates. Re-analysis cancels old requests. No approved ending is silently changed. Final timings/decisions enter JSON/ZIP manifests; short-lived tokens are excluded. Comment windows respect explicit server end timestamps. Actual media may include up to one second of frame/container padding around a 30-second export selection.

## Comments algorithm

`commentsStatus` distinguishes `loading`, `ready` and `unavailable`. If retrieval exceeds the initial wait, analysis returns a server-held comment-context token. `GET /api/analyses/:token/comments` returns 202 while pending and a timestamp-card/source/warning patch when ready; `POST` retries comments only. Up to two background retrievals run concurrently, reused by video ID, with bounded queues/maps and 30-minute context expiry. Keyless extraction has an independent 45-second process limit; official API pages have a 15-second request limit inside the background budget. Shutdown aborts active jobs. Failed jobs are not reused as successful empty samples. Comments arriving later receive their own Smart ending registration without re-registering replay clips.

`CommentUpdates` polls every two seconds, cancels on new analysis/unmount and ignores stale-video responses. Merging touches only comments, comment provenance/warnings and loading state; replay refinements and approvals remain intact. Approved comment timings are preserved. Missing heatmaps do not prevent timestamp-comment cards. The UI offers a comments-only retry on failure and never describes a pending/failed request as a successful sample containing no timestamps.

The client normalises replay and comment candidates with `getReviewClips`. Comment cards follow replay cards and retain their distinct evidence source, first-sentence excerpt and original comment metadata. Their windows start at the mentioned timestamp and target 25 seconds, with optional Smart ending adjustments or a shorter video-end boundary. Both sources share card selection, approvals, manifest export and the MP4 download route; if no replay clips exist, the first comment clip is selected automatically. Timestamp-comment clips are recommendations from comments, not verified heatmap winners. Card and export timestamps retain millisecond precision; the original YouTube embed rounds playback start/end to whole seconds.

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

- `LowerVideoLibrary` scans `LOWER_VIDEOS_DIR` (default `docs/vids`) plus the three known category subfolders. Root videos belong to Minecraft Parkour. ffprobe metadata is cached against path/size/mtime; unreadable videos are skipped. The public catalogue exposes hashed relative-path IDs, never absolute paths. Only IDs resolve to media, with realpath containment and symlink-entry rejection. Random uses a shuffled rotation before repeating. The compact UI loads/rescans the catalogue; enabling the lower panel forces Shorts, while tape slowdown is enabled by default independently.
- Lower-video exports place the sharp main source over blur in a 720×832 upper panel and centre-crop the secondary input into 720×448 below it. For all Shorts exports, `SHORTS_FOREGROUND_ZOOM=1.35` scales the foreground beyond its fitted size, then centre-crops to the available panel; a 16:9 source appears about 35% taller with about 13% removed from each side. FFmpeg loops the secondary input, resets its timestamps to normal 30 fps and trims it to the final duration; only main/tape audio is mapped. Captions are rendered last with their baseline above the divider. All four effects default on and share one final encode. The download response's `X-Lower-Video` header records the chosen ID/category/start offset/duration; batch code writes that metadata into each manifest selection and records foreground zoom in `outputFormat`.

- Shorts export passes the boolean `shorts` flag through the same individual/batch route. `ShortsExportService` and `TapeSlowdownService` share `buildVideoFilterGraph`: apply timing first, compose a cropped/blurred/darkened background with the zoomed and centre-cropped foreground, then burn ASS captions. Output is 720×1280, square pixels, H.264/yuv420p and AAC, with a 30 fps video timeline. Portrait captions use 12% horizontal/16% bottom margins, or a baseline above the lower-panel divider. With tape enabled, the original speech is transcribed and cue times remapped before one combined FFmpeg video render. Shorts-only exports do not require Python or models. ZIP manifests record zoom and target geometry. Existing cancellation, size limits and job cleanup also cover the portrait render.

- There is no application-level CPU percentage or RAM ceiling. Whisper is CPU/int8 with four inference threads; FFmpeg has automatic threading and no explicit thread limit. No GPU encoder or CUDA inference is configured. The one-export-at-a-time guard, 180-second acquisition/300-second render timeouts and 50 MB file limit bound jobs, not hardware utilisation.

- Tape slowdown follows `React tapeSlowdown → POST /api/clips/download → ClipDownloadService → TapeSlowdownService`. ffprobe reads actual source duration `D`; onset `a=0.5D`, ramp length `R=0.5D`. Before onset, speed is 1 and output time `u(t)=t`. Afterwards speed is `s(t)=1−0.4(t−a)/R` and output time `u(t)=a−R/0.4·ln(s(t))`. Output length is about `1.13853203D`. The Python helper receives `--start-fraction` from the JS plan, decodes with PyAV and uses the matching inverse clock: `t(u)=u` through onset, then `t(u)=a+R/0.4·(1−exp(−0.4(u−a)/R))`. A 32-tap Lanczos-windowed sinc resampler processes bounded blocks; stereo channels use identical sample positions. FFmpeg applies the piecewise video `setpts` curve and muxes AAC; subtitle cues use the same map. The lower input remains at normal speed. All effects share one final video encode. Batch manifests record onset/final speed, and cancellation/cleanup are unchanged. No additional dependencies are downloaded.

- Optional subtitle rendering runs after clip acquisition and before attachment delivery. `LocalSubtitleService` invokes `scripts/transcribe.py` in the isolated `.venv-subtitles` environment. faster-whisper uses CPU/int8, word timestamps, VAD and local-only model loading; only `npm run setup:subtitles` downloads weights. Decoded audio/model/language hashes key the local JSON transcript cache. The domain module validates times, clamps to clip duration, groups phrases and escapes ASS control syntax; FFmpeg burns fixed-name `captions.ass` into a temporary H.264 MP4. Source, transcript copy, ASS and render are cleaned together. Persistent model/transcript caches are gitignored. Subtitle setup failures are detected before media acquisition; no-speech errors never silently return raw video. Both download modes pass an explicit boolean option; the batch manifest records it.

- The batch button snapshots approved replay/comment windows and calls the existing download route sequentially. The client packages the resulting MP4 blobs and a JSON manifest into one stored ZIP. It uses the same abort controller as individual downloads, prevents concurrent download actions in the UI, and saves the ZIP only after every approved clip succeeds. No upload API is called.

- Test downloads use fixed argument arrays with local yt-dlp configuration ignored, an isolated temporary directory, one preparation at a time, a 180-second process timeout and a 50 MB response limit. Client disconnect/cancellation stops the process tree and cleans temporary files. FFmpeg can be configured with `FFMPEG_PATH`; missing tools produce actionable UI errors.

- The server binds to `127.0.0.1`, and only YouTube video IDs validated in the domain module reach a subprocess/network URL.
- External process is invoked with a fixed argument array, `shell:false`, 12 MB output limit and a configurable timeout.
- API credentials stay in `.env` on the server. Frontend receives only public fields and source links.
- `.env` and generated bundles are gitignored; no OpenAI requests are made.
- Tests use fakes/offline fixtures; live extraction is inherently susceptible to YouTube site changes, blocks and rate limiting.
