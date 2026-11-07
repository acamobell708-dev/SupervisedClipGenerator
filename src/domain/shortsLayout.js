export const SHORTS_DIMENSIONS = Object.freeze({width: 720, height: 1280});

// Build a single graph: time warp first, portrait composition next, captions last.
// Only the background is cropped; the sharp foreground always fits in full.
export function buildVideoFilterGraph({beforeLayout = 'setpts=PTS-STARTPTS,fps=30', shorts = false, subtitles = false} = {}) {
  const captions = subtitles ? ',ass=captions.ass' : '';
  if (!shorts) return `[0:v:0]${beforeLayout}${captions}[video]`;
  const {width, height} = SHORTS_DIMENSIONS;
  return [
    `[0:v:0]${beforeLayout},split=2[backgroundSource][foregroundSource]`,
    `[backgroundSource]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,gblur=sigma=32:steps=2,eq=brightness=-0.12:saturation=0.75[background]`,
    `[foregroundSource]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1[foreground]`,
    `[background][foreground]overlay=(W-w)/2:(H-h)/2:shortest=1${captions},setsar=1,format=yuv420p[video]`,
  ].join(';');
}
