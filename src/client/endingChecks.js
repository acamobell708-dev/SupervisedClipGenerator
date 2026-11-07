import { needsEndingCheck } from './reviewClips.js';

// A generation prevents late responses from changing a new shortlist or an approved clip.
export class EndingChecks {
  constructor({onUpdate, isApproved = () => false, fetchImpl = (...args) => fetch(...args), timeoutMs = 28000}) {
    Object.assign(this, {onUpdate, isApproved, fetchImpl, timeoutMs});
    this.active = new Map();
    this.generation = 0;
  }
  reset() {this.generation++; for (const entry of this.active.values()) entry.controller.abort(); this.active.clear();}
  check(clip) {
    if (!needsEndingCheck(clip) || this.isApproved(clip.id)) return Promise.resolve(clip);
    const token = clip.refinementToken;
    if (this.active.has(token)) return this.active.get(token).promise;
    const generation = this.generation;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const update = value => {if (generation === this.generation && !this.isApproved(value.id)) this.onUpdate(value);};
    update({...clip, smartEnding: {...clip.smartEnding, status: 'checking'}});
    const promise = Promise.resolve().then(async () => {
      try {
        if (!token) throw new Error('Speech alignment is unavailable for this clip.');
        const response = await this.fetchImpl('/api/clips/refine-ending', {method: 'POST', signal: controller.signal,
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token})});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Speech alignment is unavailable.');
        if (data.clip?.id !== clip.id || data.clip.startSeconds !== clip.startSeconds || !Number.isFinite(data.clip.endSeconds) || needsEndingCheck(data.clip)) throw new Error('Invalid ending-check response.');
        update(data.clip);
        return data.clip;
      } catch {
        const fallback = {...clip, smartEnding: {...clip.smartEnding, status: 'estimated', boundary: 'speech-unavailable',
          warning: 'Speech check unavailable or timed out; the displayed replay-interest ending was kept.'}};
        update(fallback);
        return fallback;
      } finally {clearTimeout(timer); if (generation === this.generation) this.active.delete(token);}
    });
    this.active.set(token, {controller, promise});
    return promise;
  }
}
