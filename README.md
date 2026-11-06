# SupervisedClipGenerator — YouTube clip discovery (v0.1)

A local **React + HTML/CSS + Express/Node.js** starter application for finding promising short moments in *public YouTube videos, including videos from channels you do not own*.

**Today:** paste a link → read the public **Most Replayed** heatmap via `yt-dlp` → rank up to **five non-overlapping 10-second segments** (within the planned 5–15-second range) → preview those YouTube segments → download the selected preview as a test MP4 or mark selections approved and export their timestamps as JSON. Also surfaces up to **three liked viewer comments mentioning valid timestamps**, from a bounded public comment sample. Media is downloaded only when you click **Download test clip**. Nothing is uploaded. No OpenAI requests or tokens are used.

**Later:** automatically choose a video, manual timestamp selection, richer clip review, batch rendering, large white captions, editing templates, face overlays, pitch ramp, border/effects, creator-authorised batch upload, and integration with the prior channel dashboard. Track these in [docs/FUNCTIONAL_REQUIREMENTS.md](docs/FUNCTIONAL_REQUIREMENTS.md).

## Run on Windows (VS Code terminal / PowerShell)

Requires **Node.js 20+**, internet to reach YouTube, and an up-to-date **yt-dlp** executable on PATH.

1. Install yt-dlp (Windows PowerShell):
   ```powershell
   winget install --source winget --id yt-dlp.yt-dlp
   ```
   Close and reopen PowerShell / VS Code after installing. Confirm with `yt-dlp --version`. If Winget is unavailable, follow the [official yt-dlp installation guide](https://github.com/yt-dlp/yt-dlp#installation). Python is *not* required when using the standalone Windows binary.
2. In this folder:
   ```powershell
   npm install
   npm start
   ```
3. Open **http://localhost:3000**. Paste a link or use **Try offline demo**. You can also double-click `RUN_WINDOWS.cmd` after installing prerequisites. `npm run dev` additionally watches and rebuilds JSX changes (restart after server code changes).

No YouTube OAuth or OpenAI API key is needed. For **more reliable public comment retrieval**, optionally copy `.env.example` to `.env` and set `YOUTUBE_API_KEY` to a Google Cloud API key with **YouTube Data API v3** enabled. This fetches *other creators' published comments*; you do not need their consent or channel authentication to read their public comments through this endpoint. Keep the key in `.env` only.

If `yt-dlp` lives at a different path, set `YT_DLP_PATH=C:\\path\\to\\yt-dlp.exe` in `.env`.

## Compact review workspace

The URL form and analysis status sit above a compact source summary and clip list. Click anywhere on a card to preview its segment; keyboard users can focus the card and press Enter or Space. Timestamp-comment clips follow the replay clips, showing their timestamp and the first sentence of the comment. Both types have **Approve** and **Download** actions. On desktop, the preview stays beside the list while scrolling; on smaller screens it appears above the clips. Use **Approve**, then **Export timestamps** to save approved replay and comment windows as JSON. This export is not an MP4 download.

## Download a selected clip for a local test

For footage you own or have permission to download:

1. Analyse a real video and select a replay or timestamp-comment card to preview it.
2. Click the **download icon** on the card. Approval is not required. Comment clips start at the mentioned timestamp and last up to 10 seconds, clamped to the video end.
3. Wait for preparation, then open the MP4 in your browser's downloads. **Cancel** stops preparation. Errors and missing-tool instructions appear beside the button.

The button requires **yt-dlp + FFmpeg** installed on the server machine. Get FFmpeg from its [official download page](https://ffmpeg.org/download.html); restart the app after installation. If needed, set `FFMPEG_PATH=C:\\path\\to\\ffmpeg.exe` in `.env`. Discovery and JSON exports still work without FFmpeg. No terminal command is needed to download each clip.

Test downloads use the selected window's exact timestamps, MP4/M4A formats up to 720p, and FFmpeg re-encoding for more accurate cuts. Some sources may not offer these formats or allow extraction. The export is limited to 15 seconds and 50 MB, with one preparation at a time and a three-minute process timeout. Temporary files are removed after delivery, cancellation or failure. See the [official yt-dlp options](https://github.com/yt-dlp/yt-dlp#usage-and-options).

Download buttons are disabled for the offline demo because its timestamps are synthetic. **Export timestamps** remains a separate JSON manifest export; it does not export media. Captions, effects and uploading are future milestones.

## Batch download approved clips

Approve any replay or timestamp-comment cards, then click **Batch upload (download ZIP)** below the preview. Its current action is to download all approved clips, not publish them. Clips are prepared sequentially, with clip-count progress and **Cancel**, then saved as one ZIP containing numbered MP4s and `selections.json`. The batch uses the approvals captured when clicked. If a clip fails or you cancel, preparation stops and no partial ZIP is downloaded; the error is shown in the UI. Individual clip downloads remain available.

## Folders

```text
public/               Client-facing HTML/CSS and generated JS bundle
  index.html
  styles/app.css
  assets/              Generated by npm start (not committed)
src/
  client/              React JSX components and browser helpers
  domain/              URL parsing, heatmap selection, comment timestamps
  services/            yt-dlp, optional Data API, discovery orchestration
  utils/               Error type
  app.js               Express route definitions
  server.js            Localhost entry point
scripts/               esbuild scripts
tests/                 Offline Node.js tests
docs/                  Requirements, prior-dashboard handover, architecture
```

## API / tests

- `POST /api/analyse` — `{ "url": "https://www.youtube.com/watch?v=VIDEO_ID" }`; returns 0–5 ranked clip windows and 0–3 timestamped comments.
- `POST /api/clips/download` — `{ "videoId": "VIDEO_ID", "startSeconds": 70, "endSeconds": 80 }`; prepares and returns an MP4 attachment, or a JSON error.
- `GET /api/demo` — deliberately synthetic test data, never presented as real replay measurements.
- `GET /api/health` — local configuration summary without credentials.
- `npm test` — offline tests; `npm run check` — tests and client build.

## Important limitations

- **“Most Replayed” means replay-relative signal**, not exact plays, video views, average retention or a creator's private YouTube Analytics. The official Data API has **no public Most Replayed endpoint**; `yt-dlp` parses public YouTube data, so extraction can break as YouTube changes. Update yt-dlp if necessary.
- YouTube exposes this graph only for eligible videos. If missing, the app reports it as **unavailable**, not a guessed top five. Fewer than five clips can be returned if the video is too short or peaks overlap.
- Comments are sampled (top/most relevant; max 100 by default), **not the entire comment history**. Without a Data API key the fallback uses `yt-dlp` and can be slower or unavailable.
- The player is YouTube's embed. Some creators disable embedding or block content in a region; use **Watch on YouTube**. A preview alone does not save media; use **Download test clip** for a local MP4.
- Approval state exists only in this browser session; **export the JSON manifest** to keep it. Publishing will eventually require OAuth for the *destination* channel and permission to use source footage.
- Always respect content rights, YouTube terms and API policies. Do not bypass private, age-restricted or paywalled content.

## Prior project

Source dashboard: [YoutubeChannelAnalyser](https://github.com/acamobell708-dev/YoutubeChannelAnalyser). Read [docs/CHANNEL_DASHBOARD_KNOWLEDGE.md](docs/CHANNEL_DASHBOARD_KNOWLEDGE.md) before integrating; this starter deliberately runs independently.
