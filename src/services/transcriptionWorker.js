import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkQueue, withDeadline } from '../utils/asyncWork.js';
import { AppError } from '../utils/AppError.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class TranscriptionWorker {
  constructor({pythonPath, model = 'base', language = 'auto', timeoutMs = 300000, spawnImpl = spawn, scriptPath} = {}) {
    Object.assign(this, {model, language, timeoutMs, spawnImpl});
    this.pythonPath = pythonPath || path.join(root, '.venv-subtitles', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    this.scriptPath = scriptPath || path.join(root, 'scripts/transcribe_worker.py');
    this.queue = new WorkQueue(1);
    this.sequence = 0;
  }
  start() {
    if (this.closed) throw new AppError('Local speech worker is stopped.', 503, 'WORKER_CLOSED');
    if (this.child) return this.child;
    const child = this.spawnImpl(this.pythonPath, [this.scriptPath, '--model', this.model, '--language', this.language,
      '--model-dir', path.join(root, '.cache/whisper-models'), '--cache-dir', path.join(root, '.cache/transcripts')],
    {shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'], env: {...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1'}});
    this.child = child;
    const fail = () => {
      if (this.child !== child) return;
      this.child = null;
      this.pending?.reject(new AppError('Local speech worker stopped. Check subtitle setup or retry.', 503, 'SUBTITLES_SETUP_REQUIRED'));
      child.kill();
    };
    child.once('error', fail);
    child.once('close', fail);
    child.stdin.on('error', fail);
    child.stderr.on('data', () => {}); // Drain library logs; never mix them into the protocol.
    let lineBytes = 0;
    child.stdout.on('data', data => {
      if (this.child !== child) return;
      lineBytes += data.length;
      if (lineBytes > 256 * 1024) {this.child = null; this.pending?.reject(new AppError('Local transcript exceeded its size limit.', 502, 'SUBTITLES_INVALID')); child.kill();}
    });
    createInterface({input: child.stdout}).on('line', line => {
      if (this.child !== child) return;
      lineBytes = 0;
      try {
        const response = JSON.parse(line);
        if (response.id !== this.pending?.id) return;
        this.modelLoads = response.modelLoads;
        if (response.error) this.pending.reject(new AppError(response.error.code === 'SUBTITLES_NO_SPEECH'
          ? 'No speech was detected in this excerpt.' : 'Local speech setup or transcription failed. Run npm run setup:subtitles if needed.',
        response.error.code === 'SUBTITLES_NO_SPEECH' ? 422 : 503, response.error.code));
        else this.pending.resolve(response.result);
      } catch {this.child = null; this.pending?.reject(new AppError('Local speech worker returned invalid data.', 502, 'SUBTITLES_INVALID')); child.kill();}
    });
    return child;
  }
  async request(method, payload = {}, {signal, timeoutMs = this.timeoutMs} = {}) {
    return withDeadline(phaseSignal => this.queue.run(async () => {
      const child = this.start();
      const id = ++this.sequence;
      const abort = () => {if (this.child === child) this.child = null; child.kill(); this.pending?.reject(phaseSignal.reason);};
      phaseSignal.addEventListener('abort', abort, {once: true});
      try {
        return await new Promise((resolve, reject) => {
          this.pending = {id, resolve, reject};
          child.stdin.write(`${JSON.stringify({id, method, ...payload})}\n`, error => {if (error) reject(error);});
        });
      } finally {phaseSignal.removeEventListener('abort', abort); this.pending = null;}
    }, phaseSignal), timeoutMs, {signal, code: 'TRANSCRIPTION_TIMEOUT'});
  }
  check(options) {return this.request('check', {}, {...options, timeoutMs: 30000});}
  warm(options) {return this.request('warm', {}, options);}
  transcribe(filePath, options) {return this.request('transcribe', {filePath}, options);}
  close() {this.closed = true; this.child?.kill();}
}
