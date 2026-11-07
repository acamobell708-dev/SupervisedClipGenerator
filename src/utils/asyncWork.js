import { AppError } from './AppError.js';

export async function withDeadline(task, timeoutMs, {signal, message = 'Processing timed out.', code = 'PROCESSING_TIMEOUT'} = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(new AppError(message, 504, code)), timeoutMs);
  let onAbort;
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, {once: true});
    })]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    if (!controller.signal.aborted) controller.abort();
  }
}

export class WorkQueue {
  constructor(limit, maximumWaiting = 16) {this.limit = limit; this.maximumWaiting = maximumWaiting; this.active = 0; this.waiting = [];}
  async run(task, signal) {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.maximumWaiting) throw new AppError('Processing queue is full. Please retry shortly.', 429, 'PROCESSING_BUSY');
      await new Promise((resolve, reject) => {
        const entry = {resolve: () => {signal?.removeEventListener('abort', abort); resolve();}};
        const abort = () => {this.waiting = this.waiting.filter(item => item !== entry); reject(signal.reason);};
        signal?.addEventListener('abort', abort, {once: true});
        this.waiting.push(entry);
      });
    } else this.active++;
    try {signal?.throwIfAborted(); return await task();}
    finally {
      const next = this.waiting.shift();
      if (next) next.resolve();
      else this.active--;
    }
  }
}
