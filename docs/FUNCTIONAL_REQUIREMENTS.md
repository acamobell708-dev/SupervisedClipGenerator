# SupervisedClipGenerator — functional requirements and roadmap

Updated 2026-11-07. This document distinguishes implemented behaviour from planned behaviour; an item on this list is not evidence that it works.

## Product goal

Given a public YouTube video (eventually a creator/channel), identify promising small segments for review and, with proper rights and creator-authorised destination credentials, prepare/edit/publish approved clips at scale. The initial implementation supports **discovery, review and individual test MP4 downloads**, not a full uploader.

## Phase 1 — currently implemented

| ID | Requirement | Status / acceptance criterion |
| --- | --- | --- |
| FR-001 | Accept public YouTube link | **Implemented:** watch, youtu.be, Shorts, live and embed URL shapes; strict video ID validation. |
| FR-002 | Fetch public metadata | **Implemented:** title, channel, duration, thumbnail, views when accessible via yt-dlp. |
| FR-003 | Find up to five top replay moments | **Implemented:** only if public Most Replayed heatmap is returned; rank five distinct/non-overlapping windows by relative heatmap intensity. |
| FR-004 | Clip windows between 5 and 15 seconds | **Implemented:** 10-second default; shorter only if source duration is under 10 seconds (minimum 5). |
| FR-005 | Show moment previews | **Implemented:** YouTube embeds with segment start/end; outbound timed source links. Separate explicit button downloads the selected preview as MP4. |
| FR-006 | Approve clips | **Partially implemented:** local/browser temporary approval toggles for replay and timestamp-comment cards; export approved windows from both sources as JSON. No persisted project. |
| FR-007 | Up to three popular timestamped viewer comments | **Implemented:** timestamp-comment cards appended to replay list, with timestamp, first comment sentence and likes; whole-card selection previews up to 10 seconds, with approval and download actions. Optional official Data API or keyless yt-dlp fallback. |
| FR-008 | Handle missing signals honestly | **Implemented:** missing heatmap, missing/disabled comments, extractor failures, and embedding limitations surfaced without synthetic ranks. |
| FR-009 | Local web server + client separation | **Implemented:** localhost Express, React JSX in src/client, HTML/CSS in public; esbuild generates public/assets/app.js. |
| FR-010 | Offline demo and tests | **Implemented:** labelled synthetic fixture; pure-domain and mocked service tests. |
| FR-011 | OpenAI tokens per run below 50,000 | **Satisfied currently:** exactly 0; there is no OpenAI call in phase 1. A future model integration must enforce a measured per-run cap below 50,000 across all model calls. |
| FR-026 | Download a selected clip for testing | **Implemented:** Download action on replay/comment cards and button below preview save an MP4 up to 720p using yt-dlp and FFmpeg; exact selected timestamps, max 15 seconds, cancellation/error states, isolated temporary files and cleanup. Disabled for synthetic demo. |
| FR-027 | Batch action for approved clips | **Implemented:** Batch upload (download ZIP) button below preview currently downloads approved replay/comment clips sequentially into one ZIP with a selection manifest, progress and cancellation. No publishing. Approvals are captured on click; failure/cancellation stops the batch without saving a partial ZIP. |
| FR-016 | Bold white subtitles | **Implemented:** optional local faster-whisper CPU transcription with word timestamps, short phrase grouping and bold white outlined ASS captions burned into individual/batch MP4s with FFmpeg. One-time model setup, offline inference, transcript caching, cancellation and explicit failure states. Manual correction and rendered in-app preview remain planned. |
| FR-019 | Progressive tape slowdown | **Implemented:** checkbox below subtitles applies the same normalised 100%→60% video/audio speed ramp to individual and approved-batch exports, with pitch following speed (about −8.8 semitones at the end). Local NumPy/PyAV audio resampling, matching FFmpeg video time warp and remapped captions maintain sync. Source windows remain max 15 seconds; final duration increases by about 27.7%. |
| FR-028 | Shorts portrait export | **Implemented:** third export checkbox produces 720×1280 9:16 MP4s with the complete sharp source fitted over a cropped, blurred and darkened background. Individual/batch exports, portrait-sized safe-area captions, and tape slowdown share one final H.264/AAC render. Settings and output dimensions are included in the ZIP manifest. |

## Phase 2 — selection, editing, ownership, upload (NOT implemented)

| ID | Planned behaviour | Notes / design decision |
| --- | --- | --- |
| FR-012 | Automatically choose a video **or** allow explicit selection | Channel catalog discovery and scoring, possibly from prior dashboard; avoid claiming access to private creator Analytics. |
| FR-013 | Manually choose timestamped start/end windows | Adjustable 5–15 seconds, keyboard scrubbing, confirmation, saved edits. |
| FR-014 | Persist projects and approvals | SQLite or JSON store with video ID, sources, evidence, clips, status, timestamps, versioning. |
| FR-015 | Full media editing pipeline | Individual test MP4 downloads implemented in FR-026; batch rendering and edits on owned/licensed/authorised footage remain planned. |
| FR-017 | Auto editing and editing templates | Basic 9:16 blurred-fit layout implemented in FR-028; subject tracking/crop controls, transitions, intro/outro, watermarks and rendered export preview remain planned. |
| FR-018 | Face overlay / nodding reaction | User-supplied or licensed face/video assets; opt-in and privacy/likeness rights. |
| FR-020 | Borders and visual effects | Non-destructive template parameters; render-quality tests. |
| FR-021 | Show all final clips for approval | Preview *rendered* final media before export or posting; distinguish preview from actual video file. |
| FR-022 | Batch upload to destination channel | YouTube Data API **videos.insert** with destination-user OAuth and consent, upload status, quota handling, retries and deduplication. Do not reuse source ownership/auth. |
| FR-023 | Reuse prior channel dashboard | Read-only integration of suitable source-public metrics and optional owner-authorised dashboard insight. Module boundary between discovery and dashboard. |
| FR-024 | Model-assisted editing recommendations | Optional AI with bounded/validated inputs and outputs; hard per-run token budget strictly below 50,000 and application-level cost logs; never send secrets. |
| FR-025 | Security, policies and rights | Localhost by default, rate limiting, allowlisted YouTube IDs, server secrets, rights verification before acquisition/publication, YouTube platform/API policy compliance. |

## Non-functional requirements

- **Extensible:** domain scoring, provider clients, orchestration and UI are separated so sources/editors/uploaders can be replaced independently.
- **Reliable:** optional comment failure must not erase valid heatmap results; do not fabricate counts or estimated missing data.
- **Efficient:** bounded comment sample (10–200 maximum), limited process output and timeout, no model calls in discovery.
- **Testable:** deterministic time-window and timestamp selection; offline fixtures; mock network/process boundaries.
- **Clear UX:** label live vs synthetic and relative vs measured; always show primary source link.

## Open questions for later decisions

- Only user-owned/licensed clips vs any publicly viewable source (public visibility does **not** imply republication permission).
- Whether uploader will target Shorts only or also standard videos; max aspect ratio, resolution and duration.
- Whether public heatmap is sufficient or whether transcripts / comment clusters should provide explicitly labelled alternate clip candidates when heatmap is absent.
- Where to store persistent clip sessions and signed destination credentials.
