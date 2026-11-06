"""Local CPU transcription. Only --prepare may download model weights."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input')
    parser.add_argument('--output')
    parser.add_argument('--model', default='base')
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--cache-dir', required=True)
    parser.add_argument('--language', default='auto')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
    os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'
    os.environ['HF_HOME'] = str(Path(args.model_dir).parent / 'huggingface')
    if not args.prepare:
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
    try:
        import av
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
        from faster_whisper.utils import download_model
    except (ImportError, OSError) as error:
        print(f'SUBTITLES_SETUP_REQUIRED: {error}', file=sys.stderr)
        return 2
    try:
        direct = Path(args.model_dir) / ('direct-' + hashlib.sha256(args.model.encode()).hexdigest()[:16])
        model_path = str(direct) if (direct / 'complete.json').is_file() else download_model(args.model, cache_dir=args.model_dir, local_files_only=not args.prepare)
        if not (Path(model_path) / 'model.bin').is_file():
            raise FileNotFoundError('Model weights are missing')
    except Exception as error:
        print(f'SUBTITLES_SETUP_REQUIRED: {error}', file=sys.stderr)
        return 2
    if args.check:
        print(json.dumps({'ready': True, 'model': args.model, 'device': 'cpu'}))
        return 0
    # Loading here also verifies the downloaded model and CPU runtime during setup.
    if args.prepare:
        WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
        print(f'Local subtitles ready: {args.model} (CPU/int8).')
        return 0
    if not args.input or not args.output:
        parser.error('--input and --output are required for transcription')
    with av.open(args.input) as container:
        video = next(iter(container.streams.video), None)
        if video is None or not container.streams.audio:
            print('SUBTITLES_NO_SPEECH: Clip has no video or audio stream.', file=sys.stderr)
            return 3
        dimensions = {'width': video.width, 'height': video.height}
    audio = decode_audio(args.input, sampling_rate=16000)
    key = hashlib.sha256(audio.tobytes() + f'v1:{args.model}:{args.language}'.encode()).hexdigest()
    cache = Path(args.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    cached = cache / f'{key}.json'
    transcript = None
    if cached.is_file():
        try:
            transcript = json.loads(cached.read_text(encoding='utf-8'))
            if not isinstance(transcript.get('words'), list):
                transcript = None
        except (ValueError, AttributeError):
            transcript = None
    if transcript is None:
        model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
        segments, info = model.transcribe(
            audio, language=None if args.language == 'auto' else args.language,
            word_timestamps=True, vad_filter=True, beam_size=5,
            condition_on_previous_text=False,
        )
        words = []
        for segment in segments:
            for word in segment.words or []:
                if word.word.strip():
                    words.append({'start': word.start, 'end': word.end, 'text': word.word.strip()})
        transcript = {'words': words, 'language': info.language, 'duration': len(audio) / 16000}
        temporary = cached.with_suffix('.tmp')
        temporary.write_text(json.dumps(transcript, ensure_ascii=False), encoding='utf-8')
        temporary.replace(cached)
    if not transcript['words']:
        print('SUBTITLES_NO_SPEECH: No speech was detected.', file=sys.stderr)
        return 3
    Path(args.output).write_text(json.dumps({**transcript, **dimensions}, ensure_ascii=False), encoding='utf-8')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'SUBTITLES_FAILED: {error}', file=sys.stderr)
        sys.exit(1)
