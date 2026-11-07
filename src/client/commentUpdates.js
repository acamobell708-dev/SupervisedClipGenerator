// Comment retrieval can outlive fast analysis; only this shortlist receives its updates.
export class CommentUpdates {
  constructor({onUpdate, fetchImpl = (...args) => fetch(...args), intervalMs = 2000, timeoutMs = 75000}) {
    Object.assign(this, {onUpdate, fetchImpl, intervalMs, timeoutMs});
    this.generation = 0;
  }
  reset() {this.generation++; this.controller?.abort(); this.controller = null; this.token = null;}
  watch(token, video, retry = false) {
    if (this.token === token && this.controller) return this.pending;
    this.reset();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller; this.token = token;
    const update = patch => {if (generation === this.generation) this.onUpdate({...patch, video});};
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    this.pending = (async () => {
      try {
        if (retry) update({commentsStatus: {state: 'loading', token}, warnings: []});
        let first = true;
        while (true) {
          const response = await this.fetchImpl(`/api/analyses/${encodeURIComponent(token)}/comments`, {
            ...(retry && first ? {method: 'POST'} : {}), signal: controller.signal,
          });
          first = false;
          const patch = await response.json();
          if (!response.ok) throw new Error(patch.error || 'Unable to retrieve comments.');
          update(patch);
          if (patch.commentsStatus.state !== 'loading') return;
          await new Promise((resolve, reject) => {
            const abort = () => {clearTimeout(wait); reject(controller.signal.reason);};
            const wait = setTimeout(() => {controller.signal.removeEventListener('abort', abort); resolve();}, this.intervalMs);
            controller.signal.addEventListener('abort', abort, {once: true});
            if (controller.signal.aborted) abort();
          });
        }
      } catch {
        update({commentsStatus: {state: 'unavailable', token, message: 'Comment retrieval failed or timed out. Retry comments.'},
          sources: {comments: 'unavailable', sampledCommentCount: 0}, warnings: ['Comment retrieval failed or timed out. Retry comments.']});
      } finally {
        clearTimeout(timer);
        if (generation === this.generation) {this.controller = null; this.token = null;}
      }
    })();
    return this.pending;
  }
}
