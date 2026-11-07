"""Tape-style varispeed: resample source audio along the inverse video timeline."""
import argparse
import math
import sys
import wave

END_SPEED = 0.6
SAMPLE_RATE = 48000


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input')
    parser.add_argument('--output')
    parser.add_argument('--duration', type=float)
    parser.add_argument('--start-fraction', type=float, default=0.5)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        import av
        import numpy as np
    except (ImportError, OSError) as error:
        print(f'TAPE_SETUP_REQUIRED: {error}', file=sys.stderr)
        return 2
    if args.check:
        print('Local tape resampler ready.')
        return 0
    # Match the JS plan: 30-second selection plus up to one second of media padding.
    if not args.input or not args.output or not args.duration or not math.isfinite(args.duration) or not 0 < args.duration <= 31:
        parser.error('Supply --input, --output and a finite --duration between 0 and 31 seconds.')
    if not math.isfinite(args.start_fraction) or not 0 <= args.start_fraction < 1:
        parser.error('--start-fraction must be at least zero and less than one.')
    with av.open(args.input) as container:
        stream = next(iter(container.streams.audio), None)
        if stream is None:
            print('TAPE_NO_AUDIO: No audio stream.', file=sys.stderr)
            return 3
        channels = 2 if len(stream.layout.channels) > 1 else 1
        resampler = av.AudioResampler(format='fltp', layout='stereo' if channels == 2 else 'mono', rate=SAMPLE_RATE)
        chunks = []
        for frame in container.decode(stream):
            chunks.extend(converted.to_ndarray() for converted in resampler.resample(frame))
        chunks.extend(converted.to_ndarray() for converted in resampler.resample(None))
    if not chunks:
        print('TAPE_NO_AUDIO: Empty audio stream.', file=sys.stderr)
        return 3
    samples = np.concatenate(chunks, axis=1)
    drop = 1 - END_SPEED
    start_seconds = args.duration * args.start_fraction
    ramp_duration = args.duration - start_seconds
    output_duration = start_seconds - ramp_duration / drop * math.log(END_SPEED)
    output_samples = round(output_duration * SAMPLE_RATE)
    # A 32-tap Lanczos-windowed sinc interpolator avoids the treble loss of linear
    # interpolation. Small blocks bound working memory and keep stereo channels aligned.
    taps = np.arange(-15, 17)
    with wave.open(args.output, 'wb') as output:
        output.setnchannels(channels)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        for offset in range(0, output_samples, 4096):
            times = np.arange(offset, min(offset + 4096, output_samples), dtype=np.float64) / SAMPLE_RATE
            # Invert the exact same piecewise clock as the JS/FFmpeg video map.
            # Source positions are unchanged through the first 50% of the clip.
            ramp_times = np.maximum(0, times - start_seconds)
            source_times = np.where(times <= start_seconds, times,
                                    start_seconds - ramp_duration / drop * np.expm1(-drop * ramp_times / ramp_duration))
            positions = source_times * SAMPLE_RATE
            indices = np.floor(positions).astype(np.int64)[:, None] + taps
            distance = positions[:, None] - indices
            weights = np.sinc(distance) * np.sinc(distance / 16)
            weights *= (np.abs(distance) < 16) & (indices >= 0) & (indices < samples.shape[1])
            weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-12)
            block = np.einsum('cft,ft->cf', samples[:, np.clip(indices, 0, samples.shape[1] - 1)], weights)
            pcm = np.round(np.clip(block, -1, 1) * 32767).astype('<i2').T.copy()
            output.writeframes(pcm.tobytes())
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'TAPE_FAILED: {error}', file=sys.stderr)
        sys.exit(1)
