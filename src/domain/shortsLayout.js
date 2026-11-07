import { MAIN_PANEL_HEIGHT, LOWER_PANEL_HEIGHT } from './lowerVideos.js';

export const SHORTS_DIMENSIONS = Object.freeze({width: 720, height: 1280});
export const SHORTS_FOREGROUND_ZOOM = 1.35;

// Build a single graph: time warp first, portrait composition next, captions last.
// Enlarge the sharp foreground beyond its fitted size, then crop around its centre.
export function buildVideoFilterGraph({beforeLayout = 'setpts=PTS-STARTPTS,fps=30', shorts = false, subtitles = false, lowerVideo, lowerInput = 1} = {}) {
  const captions = subtitles ? ',ass=captions.ass' : '';
  if (!shorts && !lowerVideo) return `[0:v:0]${beforeLayout}${captions}[video]`;
  const {width} = SHORTS_DIMENSIONS;
  const height = lowerVideo ? MAIN_PANEL_HEIGHT : SHORTS_DIMENSIONS.height;
  const zoomWidth = Math.round(width * SHORTS_FOREGROUND_ZOOM / 2) * 2;
  const zoomHeight = Math.round(height * SHORTS_FOREGROUND_ZOOM / 2) * 2;
  return [
    `[0:v:0]${beforeLayout},split=2[backgroundSource][foregroundSource]`,
    `[backgroundSource]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,gblur=sigma=32:steps=2,eq=brightness=-0.12:saturation=0.75[background]`,
    `[foregroundSource]scale=${zoomWidth}:${zoomHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,crop=w='min(iw,${width})':h='min(ih,${height})',setsar=1[foreground]`,
    `[background][foreground]overlay=(W-w)/2:(H-h)/2:shortest=1[main]`,
    ...(lowerVideo ? [
      `[${lowerInput}:v:0]setpts=PTS-STARTPTS,fps=30,scale=${width}:${LOWER_PANEL_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${LOWER_PANEL_HEIGHT},setsar=1,trim=duration=${lowerVideo.outputDuration}[lower]`,
      '[main][lower]vstack=inputs=2:shortest=1[composed]',
    ] : []),
    `[${lowerVideo ? 'composed' : 'main'}]null${captions},setsar=1,format=yuv420p[video]`,
  ].join(';');
}
