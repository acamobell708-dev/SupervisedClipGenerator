# SupervisedClipGenerator

Local React + Express app for finding and reviewing short moments in public YouTube videos. Suggests up to five replay clips and three timestamp-comment clips, with individual MP4 downloads, approved-clip ZIPs, and optional local white subtitles. Uploading is not implemented.

## Setup

- **Node.js 20+** for the app.
- **yt-dlp** on PATH for discovery and downloads.
- **FFmpeg** on PATH for downloads, with libass and libx264 support for subtitles. This is a separate executable, not part of yt-dlp.
- **Python 3.10–3.12 recommended** for local subtitles and tape slowdown. Shorts layout alone only needs FFmpeg.

On Windows, install [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) and [FFmpeg](https://ffmpeg.org/download.html), then reopen your terminal. From this folder:

```powershell
npm install
npm run setup:subtitles
npm start
```

Open **http://localhost:3000**. Subtitle setup creates `.venv-subtitles`, installs faster-whisper and its dependencies, downloads the Whisper `base` model, and verifies CPU processing. It needs internet once; transcription then runs locally without an API key, GPU, or usage fees. To skip Python setup, turn off both **White subtitles** and **Tape slowdown**.

For development, use `npm run dev`; restart after server changes. `RUN_WINDOWS.cmd` is an alternative launcher.

## Use

1. Paste a YouTube link and discover moments, or try the labelled offline demo. Replay clips are ranked from 25-second windows using average replay intensity.
2. Select any replay or timestamp-comment card to preview it. Changed Smart endings are checked on selection; approve once the check completes or shows a labelled estimate.
3. Use the card's download icon for an MP4, or approve cards and choose **Batch upload (download ZIP)** to save them together. That button currently downloads; it does not publish.
4. **White subtitles** burns captions into both download modes.
5. **Tape slowdown** keeps the first 50% of the source clip at normal speed and pitch, then gradually lowers video/audio speed to 60% and pitch by the same ratio (about −8.8 semitones at the end). Captions follow the same clock. A 25-second source starts slowing at 12.5 seconds and exports at about 28.46 seconds. Batch manifests record the effect's onset and final speed.
6. **Shorts 9:16** exports a 720 × 1280 portrait MP4. The main picture is zoomed 35% beyond its fitted size and centre-cropped over blur, making it larger while removing some edge content. All effects share one final video render.
7. **Lower video** adds muted footage beneath the main picture and requires Shorts. Choose a video or leave **Random** selected. Random cycles through the library before repeating; batch `selections.json` records each chosen video, start offset and main-picture zoom. The top panel is 720 × 832; the lower panel is centre-cropped to 720 × 448, loops as needed, and stays at normal speed. Subtitles sit above the divider.

All four export options default **on**. Turn off Lower video before disabling Shorts. The YouTube preview shows the original; rendered preview and 1080p export are not implemented.

**Smart ending**, beside search, defaults on and targets 25 source seconds within 15–30 seconds. It cuts after a sustained three-second replay-interest drop below 40% of the clip peak, or extends strong tails above 60%. Discovery returns heatmap suggestions first. Selecting a changed clip checks only an 8–12 second audio excerpt around its ending; approval/download wait for that check. Failed/timed-out checks keep clearly labelled heatmap estimates. Cached decisions need no download. This estimates replay interest, not retention, and cannot guarantee a 25-second average. Short sources/comment tails can be under 15 seconds. Switching it off restores fixed 25-second windows; changing it clears approvals. Approved timings never change in the background. YouTube previews round to whole seconds; exports preserve exact reviewed timings.

Discovery fetches metadata/comments concurrently: metadata is limited to 22 seconds, with an overall 25-second processing budget. It waits up to six seconds for comments; slower comment retrieval continues separately for up to 45 seconds, and timestamp cards appear automatically when ready. Loading, genuine empty results and retrieval failures are distinguished; **Retry comments** refreshes comments without rerunning analysis or clearing replay approvals. Slow metadata produces a retryable timeout rather than invented results. Speech checks have a separate 25-second budget. A persistent Whisper worker reuses its model for endings and captions. Audio/ending caches last 24 hours; metadata/comments cache for five minutes. Timings appear in API responses, `Server-Timing` headers, server logs and the UI.

Add lower footage to `docs/vids/minecraft-parkour`, `docs/vids/endless-runner`, or `docs/vids/satisfying`, then press **↻** beside the selector. Existing files directly in `docs/vids` also appear under Minecraft Parkour. MP4, MOV, MKV, WebM and M4V are supported; invalid files are skipped. Empty categories remain visible. No additional dependency is needed beyond FFmpeg/ffprobe.

**Cancel download** stops processing. **Export timestamps** saves approved windows as JSON, not media. Approvals are temporary until exported. Demo media downloads are disabled.

## Configuration

Copy `.env.example` to `.env` if needed; restart after changes.

| Setting | Purpose |
| --- | --- |
| `YT_DLP_PATH`, `FFMPEG_PATH` | Custom executable paths when not on PATH. |
| `FFPROBE_PATH` | Optional media-probe path; defaults to ffprobe on PATH or beside a custom FFmpeg. |
| `LOWER_VIDEOS_DIR` | Local media library; default `docs/vids`. |
| `YOUTUBE_API_KEY` | Optional YouTube Data API v3 key for more reliable public comments. |
| `WHISPER_MODEL` | Default `base`; `tiny` is faster, `small` can improve accuracy. Rerun subtitle setup after changing. |
| `WHISPER_LANGUAGE` | Default `auto`; use `en` for English if detection is unreliable. |
| `SUBTITLE_PYTHON_PATH` | Override the isolated Python environment. |
| `ANALYSIS_TIMEOUT_MS`, `COMMENT_TIMEOUT_MS`, `ENDING_CHECK_TIMEOUT_MS` | Defaults 25000/6000/25000; analysis/ending limits cap at 28000 ms. |
| `COMMENT_FETCH_TIMEOUT_MS` | Background comment retrieval limit; default 45000. `COMMENT_TIMEOUT_MS` controls only the initial wait. |

Other limits and timeouts are listed in `.env.example`. Keep credentials out of source control.

## Dependencies and limits

Local transcription uses **faster-whisper, Whisper model weights, CTranslate2, PyAV, ONNX Runtime, tokenizers, and Hugging Face Hub**. Custom code groups timestamped words into short phrases; **FFmpeg/libass** renders bold white outlined captions and **libx264** encodes the result. Models and cached transcripts stay in gitignored `.cache/`; temporary export files are removed after delivery or failure.

Tape slowdown reuses **NumPy and PyAV** from subtitle setup for local variable-rate audio resampling. **ffprobe** reads the actual clip duration; FFmpeg warps video timestamps and encodes H.264/AAC. No new package, GPU or API key is needed on an already configured machine. Run `npm run setup:subtitles` on a fresh machine even if using tape slowdown without captions.

- Replay heatmaps may be unavailable; scores represent relative replay intensity, not view counts. Comments come from a bounded sample.
- Downloads require accessible MP4/audio formats, source windows up to 30 seconds, source resolution up to 720p and final files up to 50 MB. Shorts output is 720 × 1280 H.264/AAC; delayed tape slowdown increases duration by about 13.9%. Batches prepare clips sequentially and save a ZIP only when every clip succeeds.
- Processing has no overall CPU-percentage or RAM cap. Whisper uses four CPU threads with int8 inference; FFmpeg chooses its own thread count. One export runs at a time, with process timeouts and file-size limits. GPU acceleration is not enabled.
- Transcription can make mistakes. Review exported captions; manual correction and rendered in-app preview are not implemented.
- Only download footage you have permission to use. No cloud transcription or uploading occurs.

## Development

`npm run check` checks JavaScript/JSX, CSS, Python and JSON syntax, runs all offline tests, and builds the client. Python must be on PATH for syntax checks; `SYNTAX_PYTHON` can override its executable. Source lives in `src/client`, `src/domain` and `src/services`; Python/setup helpers are in `scripts`.

[GitHub Actions CI](.github/workflows/ci.yml) runs syntax checks, the complete test suite and the build on pushes, pull requests and manual runs, using Windows/Ubuntu with Node.js 22/24 and Python 3.12. CI uses `npm ci` and requires no API keys or speech-model downloads.

See [architecture](docs/ARCHITECTURE.md), [requirements and roadmap](docs/FUNCTIONAL_REQUIREMENTS.md), and [prior-dashboard integration notes](docs/CHANNEL_DASHBOARD_KNOWLEDGE.md).
