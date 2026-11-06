# Knowledge carried over from YouTubeChannelAnalyser

Source inspected 2026-11-06: [`acamobell708-dev/YoutubeChannelAnalyser`](https://github.com/acamobell708-dev/YoutubeChannelAnalyser), especially its root README, `package.json`, `src/server.js`, `src/analysis/analyseVideo.js`, `src/analysis/retentionMoments.js`, `src/analysis/normaliseVideoInsight.js`, and `docs/WEBAPP_HANDOVER.md`. This is a **factual handover of the repository**, not a claim that its entire codebase has been copied or is running here.

## Relevant established architecture

- Express/Node.js application with React/HTML/CSS browser dashboards, server code in `src/`, client files in `public/`, and esbuild-built frontend assets. The prior app currently targets Node.js 20+, uses React 19, Express 5 and esbuild; this starter reuses the general approach.
- Prior public video analysis: `POST /api/video-analysis` identifies a video, retrieves public metadata and a bounded comment sample through **YouTube Data API v3**, calculates deterministic comparisons and produces optional structured OpenAI interpretations. Public channel analysis uses `POST /api/channel-analysis`.
- Prior owner-authorised features: OAuth and channel ownership verification, available caption downloads, and YouTube Analytics retention / relative-retention reports; **these are not available for arbitrary channels** and do not transfer just because a video is public.
- Prior separation of evidence: measured numeric metrics and time points are calculated locally, while GPT interpretation is separately labelled, verified against source timestamps and may be withheld as Unknown. Important to reuse for clip confidence and subtitle/editor explanations.
- Prior configuration and security: `.env` for API credentials, server-side keys only, rate limiting, simple `/api/health` route, bounded input samples, offline tests and explicit unknown/unavailable statuses.

## Useful prior modules/concepts to reuse later

| Existing source | Relevance to SupervisedClipGenerator |
| --- | --- |
| `src/domain/videoUrl.js` | Link validation, extracting/canonicalising video IDs; new project implements a small independent equivalent. |
| `src/services/youtubeDataClient.js` | Public video metadata and sampled comments; its documented API-key approach can retrieve any creator's *public* comments. |
| `src/analysis/retentionMoments.js` / `formatRetention.js` | Tested ideas for selecting and explaining independent peaks/dips; owner retention is **not** the public replay heatmap. |
| `src/services/youtubeRetentionService.js` | Creator-owner authenticated absolute and optional relative retention; optional later integration for **owned** channels only. |
| `src/analysis/normaliseVideoInsight.js` | Validating AI claims against timestamp evidence and withholding inconsistent content. |
| `src/services/videoInsightAnalyst.js` and `dailyTokenQuota.js` | Model budgeting, usage tracking and strict structured outputs. The prior video economy/heavy total targets are ~6,500 / 10,000 tokens; this new app uses zero tokens initially. |
| `public/client/VideoDashboard.jsx` | UI patterns for source-matched evidence cards and timeline visualisations. |
| `docs/WEBAPP_HANDOVER.md` | Full authoritative handover for OAuth, deployment and existing API shape. |

## Deployment lessons, not necessary for current localhost MVP

The original repository includes Docker, GitHub Actions/CI, Azure Container Apps deployment (UK South), Google OAuth with PKCE, and server-managed sessions. That infrastructure is intentionally **not pulled into this localhost project**. It can be integrated when the workflow moves beyond local-only use. The original project's `docs/WEBAPP_HANDOVER.md` contains deployment details and may change over time; consult the upstream file before reusing configuration.

## Critical distinction for clipping

| Public video available to anyone | Creator-only Analytics |
| --- | --- |
| Title, description, duration, view count and public comments via official Data API with API key. | Audience retention, watch time, per-segment owner analytics require channel-owner OAuth and may be withheld even then. |
| Public **Most Replayed** heatmap where YouTube renders it; yt-dlp can extract it but is unofficial and brittle. | Detailed owner retention curve is a different measurement; it must not be labelled as “Most Replayed”. |
| Timed YouTube player preview can reference source video without copying it. | Uploading edited clips requires rights to footage and OAuth consent for the **destination** channel. |

## Integration strategy

1. Keep `ClipDiscoveryService` independent of the dashboard's OpenAI and OAuth clients.
2. Consider importing a subset of public-channel metadata later via a **stable versioned JSON contract**, not copying dashboard internals blindly.
3. Preserve evidence provenance: `source`, `videoId`, `time range`, `relative score`, `comment id`, retrieved timestamp and any availability warnings.
4. Add owner-only retention as a distinct optional evidence source with access checks, *never* fallback to unauthorised data.
5. Keep model budgeting on the server; future run totals must be strictly under 50,000 tokens (including retries) and audited using reported usage.
6. Maintain offline tests and no-keys fixture path so future editors and uploaders cannot silently call external services during tests.
