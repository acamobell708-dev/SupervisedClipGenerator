# SupervisedClipGenerator

Local React + Express app for finding and reviewing short moments in public YouTube videos. Suggests up to five replay clips and three timestamp-comment clips, with individual MP4 downloads, approved-clip ZIPs, and optional local white subtitles. Uploading is not implemented.

## Setup

- **Node.js 20+** for the app.
- **yt-dlp** on PATH for discovery and downloads.
- **FFmpeg** on PATH for downloads, with libass and libx264 support for subtitles. This is a separate executable, not part of yt-dlp.
- **Python 3.10–3.12 recommended** for local subtitles only.

On Windows, install [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) and [FFmpeg](https://ffmpeg.org/download.html), then reopen your terminal. From this folder:

```powershell
npm install
npm run setup:subtitles
npm start
```

Open **http://localhost:3000**. Subtitle setup creates `.venv-subtitles`, installs faster-whisper and its dependencies, downloads the Whisper `base` model, and verifies CPU processing. It needs internet once; transcription then runs locally without an API key, GPU, or usage fees. Skip subtitle setup and turn off **Add white subtitles** if you only want original clips.

For development, use `npm run dev`; restart after server changes. `RUN_WINDOWS.cmd` is an alternative launcher.

## Use

1. Paste a YouTube link and discover moments, or try the labelled offline demo.
2. Select any replay or timestamp-comment card to preview it.
3. Use the card's download icon for an MP4, or approve cards and choose **Batch upload (download ZIP)** to save them together. That button currently downloads; it does not publish.
4. **Add white subtitles** applies to both download modes. Captions are burned into the exported video; the YouTube preview shows the original.

**Cancel download** stops processing. **Export timestamps** saves approved windows as JSON, not media. Approvals are temporary until exported. Demo media downloads are disabled.

## Configuration

Copy `.env.example` to `.env` if needed; restart after changes.

| Setting | Purpose |
| --- | --- |
| `YT_DLP_PATH`, `FFMPEG_PATH` | Custom executable paths when not on PATH. |
| `YOUTUBE_API_KEY` | Optional YouTube Data API v3 key for more reliable public comments. |
| `WHISPER_MODEL` | Default `base`; `tiny` is faster, `small` can improve accuracy. Rerun subtitle setup after changing. |
| `WHISPER_LANGUAGE` | Default `auto`; use `en` for English if detection is unreliable. |
| `SUBTITLE_PYTHON_PATH` | Override the isolated Python environment. |

Other limits and timeouts are listed in `.env.example`. Keep credentials out of source control.

## Dependencies and limits

Local transcription uses **faster-whisper, Whisper model weights, CTranslate2, PyAV, ONNX Runtime, tokenizers, and Hugging Face Hub**. Custom code groups timestamped words into short phrases; **FFmpeg/libass** renders bold white outlined captions and **libx264** encodes the result. Models and cached transcripts stay in gitignored `.cache/`; temporary export files are removed after delivery or failure.

- Replay heatmaps may be unavailable; scores represent relative replay intensity, not view counts. Comments come from a bounded sample.
- Downloads require accessible MP4/audio formats and are limited to 15 seconds, 720p and 50 MB per clip. Batches prepare clips sequentially and save a ZIP only when every clip succeeds.
- Transcription can make mistakes. Review exported captions; manual correction and rendered in-app preview are not implemented.
- Only download footage you have permission to use. No cloud transcription or uploading occurs.

## Development

`npm run check` runs offline tests and builds the client. Source lives in `src/client`, `src/domain` and `src/services`; Python/setup helpers are in `scripts`.

See [architecture](docs/ARCHITECTURE.md), [requirements and roadmap](docs/FUNCTIONAL_REQUIREMENTS.md), and [prior-dashboard integration notes](docs/CHANNEL_DASHBOARD_KNOWLEDGE.md).
