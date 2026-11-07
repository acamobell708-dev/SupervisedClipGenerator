import { AppError } from '../utils/AppError.js';

export const TAPE_END_SPEED = 0.6;

export function createTapeTimeline(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30) {
    throw new AppError('Could not determine a valid source duration for tape slowdown.', 422, 'TAPE_INVALID_DURATION');
  }
  const drop = 1 - TAPE_END_SPEED;
  const speedAt = seconds => 1 - drop * Math.max(0, Math.min(duration, seconds)) / duration;
  // Integrate dt / speed(t), using source-relative seconds for every media stream.
  const mapTime = seconds => Math.max(0, -duration / drop * Math.log(speedAt(seconds)));
  const outputDuration = mapTime(duration);
  return {
    duration, outputDuration, speedAt, mapTime,
    videoFilter: `setpts=PTS-STARTPTS,settb=AVTB,setpts='-${duration}/${drop}*log(1-${drop}*min(T,${duration})/${duration})/TB',fps=30,tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${outputDuration}`,
  };
}
