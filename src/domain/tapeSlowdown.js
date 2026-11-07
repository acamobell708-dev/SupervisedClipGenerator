import { AppError } from '../utils/AppError.js';

export const TAPE_END_SPEED = 0.6;
export const TAPE_START_FRACTION = 0.5;

export function createTapeTimeline(duration) {
  // Allow one second of container/frame padding around the 30-second source limit.
  if (!Number.isFinite(duration) || duration <= 0 || duration > 31) {
    throw new AppError('Could not determine a valid source duration for tape slowdown.', 422, 'TAPE_INVALID_DURATION');
  }
  const drop = 1 - TAPE_END_SPEED;
  const startSeconds = duration * TAPE_START_FRACTION;
  const rampDuration = duration - startSeconds;
  const speedAt = seconds => 1 - drop * (Math.max(0, Math.min(rampDuration, seconds - startSeconds)) / rampDuration);
  // Keep the opening untouched, then integrate dt / speed(t) over the ramp.
  // Audio, video and caption cues all use this source-relative timeline.
  const mapTime = seconds => seconds <= startSeconds ? Math.max(0, seconds)
    : startSeconds - rampDuration / drop * Math.log(speedAt(seconds));
  const outputDuration = mapTime(duration);
  const mappedTime = `if(lte(T,${startSeconds}),T,${startSeconds}-${rampDuration}/${drop}*log(1-${drop}*min(max(T-${startSeconds},0),${rampDuration})/${rampDuration}))`;
  return {
    duration, outputDuration, startFraction: TAPE_START_FRACTION, startSeconds, speedAt, mapTime,
    videoFilter: `setpts=PTS-STARTPTS,settb=AVTB,setpts='${mappedTime}/TB',fps=30,tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${outputDuration}`,
  };
}
