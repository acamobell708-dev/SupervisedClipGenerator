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

Open **http://localhost:3000**. Subtitle setup creates `.venv-subtitles`, installs faster-whisper and its dependencies, downloads the Whisper `base` model, and verifies CPU processing. It needs internet once; transcription then runs locally without an API key, GPU, or usage fees. Skip subtitle setup and turn off **Add white subtitles** if you only want original clips.

For development, use `npm run dev`; restart after server changes. `RUN_WINDOWS.cmd` is an alternative launcher.

## Use

1. Paste a YouTube link and discover moments, or try the labelled offline demo.
2. Select any replay or timestamp-comment card to preview it.
3. Use the card's download icon for an MP4, or approve cards and choose **Batch upload (download ZIP)** to save them together. That button currently downloads; it does not publish.
4. **Add white subtitles** applies to both download modes. Captions are burned into the exported video; the YouTube preview shows the original.
5. **Tape slowdown**, below subtitles, gradually lowers video/audio speed from 100% to 60% and pitch by the same ratio (about −8.8 semitones at the end). It applies to individual/batch exports, with captions retimed to match. A 10-second source becomes about 12.77 seconds. The YouTube preview remains unchanged.
6. **Shorts 9:16** exports a 720 × 1280 portrait MP4: the full sharp picture is centred over an enlarged, blurred and darkened background. It works with both download modes and can combine with subtitles and tape slowdown. Captions use portrait sizing and wider safe margins; all effects share one final video render. The YouTube preview still shows the original. A 1080 × 1920 option and rendered preview are not implemented.

**Cancel download** stops processing. **Export timestamps** saves approved windows as JSON, not media. Approvals are temporary until exported. Demo media downloads are disabled.

## Configuration

Copy `.env.example` to `.env` if needed; restart after changes.

| Setting | Purpose |
| --- | --- |
| `YT_DLP_PATH`, `FFMPEG_PATH` | Custom executable paths when not on PATH. |
| `FFPROBE_PATH` | Optional media-probe path; defaults to ffprobe on PATH or beside a custom FFmpeg. |
| `YOUTUBE_API_KEY` | Optional YouTube Data API v3 key for more reliable public comments. |
| `WHISPER_MODEL` | Default `base`; `tiny` is faster, `small` can improve accuracy. Rerun subtitle setup after changing. |
| `WHISPER_LANGUAGE` | Default `auto`; use `en` for English if detection is unreliable. |
| `SUBTITLE_PYTHON_PATH` | Override the isolated Python environment. |

Other limits and timeouts are listed in `.env.example`. Keep credentials out of source control.

## Dependencies and limits

Local transcription uses **faster-whisper, Whisper model weights, CTranslate2, PyAV, ONNX Runtime, tokenizers, and Hugging Face Hub**. Custom code groups timestamped words into short phrases; **FFmpeg/libass** renders bold white outlined captions and **libx264** encodes the result. Models and cached transcripts stay in gitignored `.cache/`; temporary export files are removed after delivery or failure.

Tape slowdown reuses **NumPy and PyAV** from subtitle setup for local variable-rate audio resampling. **ffprobe** reads the actual clip duration; FFmpeg warps video timestamps and encodes H.264/AAC. No new package, GPU or API key is needed on an already configured machine. Run `npm run setup:subtitles` on a fresh machine even if using tape slowdown without captions.

- Replay heatmaps may be unavailable; scores represent relative replay intensity, not view counts. Comments come from a bounded sample.
- Downloads require accessible MP4/audio formats, source windows up to 15 seconds, source resolution up to 720p and final files up to 50 MB. Shorts output is 720 × 1280 H.264/AAC; tape slowdown increases duration by about 27.7%. Batches prepare clips sequentially and save a ZIP only when every clip succeeds.
- Transcription can make mistakes. Review exported captions; manual correction and rendered in-app preview are not implemented.
- Only download footage you have permission to use. No cloud transcription or uploading occurs.

## Development

`npm run check` checks JavaScript/JSX, CSS, Python and JSON syntax, runs all offline tests, and builds the client. Python must be on PATH for syntax checks; `SYNTAX_PYTHON` can override its executable. Source lives in `src/client`, `src/domain` and `src/services`; Python/setup helpers are in `scripts`.

[GitHub Actions CI](.github/workflows/ci.yml) runs syntax checks, the complete test suite and the build on pushes, pull requests and manual runs, using Windows/Ubuntu with Node.js 22/24 and Python 3.12. CI uses `npm ci` and requires no API keys or speech-model downloads.

See [architecture](docs/ARCHITECTURE.md), [requirements and roadmap](docs/FUNCTIONAL_REQUIREMENTS.md), and [prior-dashboard integration notes](docs/CHANNEL_DASHBOARD_KNOWLEDGE.md).
