'use strict';

export class Bot {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.w = null;
    this.ok = false;
    try {
      this.w = new Worker(new URL('./bot-worker.js', import.meta.url), { type: 'module' });
      this.w.onmessage = (e) => {
        const { id, move, err } = e.data || {};
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (err) p.reject(new Error(err)); else p.resolve(move);
      };
      this.w.onerror = (e) => { console.warn('bot worker', e); };
      this.ok = true;
    } catch (e) { console.warn('worker failed', e); }
  }
  think(fen, opts = {}) {
    const { depth = 3, ms = 800, skill = 2 } = opts;
    if (!this.ok) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const t = setTimeout(() => { this.pending.delete(id); resolve(null); }, ms + 1500);
      this.pending.set(id, { resolve: (m) => { clearTimeout(t); resolve(m); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.w.postMessage({ id, fen, depth, ms, skill });
    });
  }
  terminate() { if (this.w) this.w.terminate(); this.pending.clear(); }
}

export const SKILL = {
  easy:   { depth: 2, ms: 400, skill: 0, label: 'Puppy', sub: 'Casual · makes mistakes' },
  medium: { depth: 3, ms: 800, skill: 1, label: 'Hazel', sub: 'Solid club player' },
  hard:   { depth: 4, ms: 1400, skill: 2, label: 'Grandhazel', sub: 'Looks ahead, fights hard' },
};
