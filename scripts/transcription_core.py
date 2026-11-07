"""Shared local-only transcription for the CLI and persistent stdin worker."""
import hashlib
import json
import os
from pathlib import Path
import uuid


class TranscriptionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Transcriber:
    def __init__(self, model, language, model_dir, cache_dir, prepare=False):
        os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
        os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
        os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'
        os.environ['HF_HOME'] = str(Path(model_dir).parent / 'huggingface')
        if not prepare:
            os.environ['HF_HUB_OFFLINE'] = '1'
            os.environ['TRANSFORMERS_OFFLINE'] = '1'
        try:
            import av
            from faster_whisper import WhisperModel
            from faster_whisper.audio import decode_audio
            from faster_whisper.utils import download_model
            self.av, self.model_class, self.decode_audio = av, WhisperModel, decode_audio
            direct = Path(model_dir) / ('direct-' + hashlib.sha256(model.encode()).hexdigest()[:16])
            self.model_path = str(direct) if (direct / 'complete.json').is_file() else download_model(model, cache_dir=model_dir, local_files_only=not prepare)
            if not (Path(self.model_path) / 'model.bin').is_file():
                raise FileNotFoundError('Model weights are missing')
        except Exception as error:
            raise TranscriptionError('SUBTITLES_SETUP_REQUIRED', str(error)) from error
        self.model_name, self.language = model, language
        self.cache = Path(cache_dir)
        self.model = None
        self.model_loads = 0

    def load(self):
        if self.model is None:
            self.model = self.model_class(self.model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
            self.model_loads += 1

    def transcribe(self, file_path):
        with self.av.open(file_path) as container:
            video = next(iter(container.streams.video), None)
            if not container.streams.audio:
                raise TranscriptionError('SUBTITLES_NO_SPEECH', 'Clip has no audio stream.')
            dimensions = {'width': video.width, 'height': video.height} if video else {'width': 1, 'height': 1}
        audio = self.decode_audio(file_path, sampling_rate=16000)
        key = hashlib.sha256(audio.tobytes() + f'v1:{self.model_name}:{self.language}'.encode()).hexdigest()
        self.cache.mkdir(parents=True, exist_ok=True)
        cached = self.cache / f'{key}.json'
        transcript = None
        if cached.is_file():
            try:
                transcript = json.loads(cached.read_text(encoding='utf-8'))
                if not isinstance(transcript.get('words'), list):
                    transcript = None
            except (ValueError, AttributeError):
                transcript = None
        if transcript is None:
            self.load()
            segments, info = self.model.transcribe(audio, language=None if self.language == 'auto' else self.language,
                                                   word_timestamps=True, vad_filter=True, beam_size=5,
                                                   condition_on_previous_text=False)
            words = [{'start': word.start, 'end': word.end, 'text': word.word.strip()}
                     for segment in segments for word in segment.words or [] if word.word.strip()]
            transcript = {'words': words, 'language': info.language, 'duration': len(audio) / 16000}
            temporary = cached.with_name(f'{key}.{uuid.uuid4().hex}.tmp')
            temporary.write_text(json.dumps(transcript, ensure_ascii=False), encoding='utf-8')
            os.replace(temporary, cached)
        if not transcript['words']:
            raise TranscriptionError('SUBTITLES_NO_SPEECH', 'No speech was detected.')
        return {**transcript, **dimensions}
