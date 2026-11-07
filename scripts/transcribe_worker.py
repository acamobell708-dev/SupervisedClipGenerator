"""Private JSON-lines stdin/stdout worker; never listens on a network socket."""
import argparse
import json
import sys
from transcription_core import Transcriber, TranscriptionError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='base')
    parser.add_argument('--language', default='auto')
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--cache-dir', required=True)
    args = parser.parse_args()
    engine = None
    for line in sys.stdin:
        request = {}
        try:
            if len(line) > 8192:
                raise ValueError('Worker request too large')
            request = json.loads(line)
            if engine is None:
                engine = Transcriber(args.model, args.language, args.model_dir, args.cache_dir)
            method = request.get('method')
            if method == 'warm':
                engine.load()
                result = {'ready': True, 'modelLoads': engine.model_loads}
            elif method in ('check', 'stats'):
                result = {'ready': True, 'modelLoads': engine.model_loads}
            elif method == 'transcribe':
                result = engine.transcribe(request['filePath'])
            else:
                raise ValueError('Unsupported worker method')
            response = {'id': request['id'], 'result': result, 'modelLoads': engine.model_loads}
        except Exception as error:
            response = {'id': request.get('id'), 'error': {'code': error.code if isinstance(error, TranscriptionError) else 'SUBTITLES_FAILED', 'message': str(error)}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
