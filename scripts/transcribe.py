"""Local CPU transcription CLI. Only --prepare may download model weights."""
import argparse
import json
from pathlib import Path
import sys
from transcription_core import Transcriber, TranscriptionError


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
    try:
        engine = Transcriber(args.model, args.language, args.model_dir, args.cache_dir, prepare=args.prepare)
        if args.check:
            print(json.dumps({'ready': True, 'model': args.model, 'device': 'cpu'}))
        elif args.prepare:
            engine.load()
            print(f'Local subtitles ready: {args.model} (CPU/int8).')
        else:
            if not args.input or not args.output:
                parser.error('--input and --output are required for transcription')
            Path(args.output).write_text(json.dumps(engine.transcribe(args.input), ensure_ascii=False), encoding='utf-8')
        return 0
    except TranscriptionError as error:
        print(f'{error.code}: {error}', file=sys.stderr)
        return 3 if error.code == 'SUBTITLES_NO_SPEECH' else 2
    except Exception as error:
        print(f'SUBTITLES_FAILED: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
