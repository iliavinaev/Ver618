// Monte-Carlo worker.
//
// A single simulation of a realistic laydown takes on the order of a hundred
// milliseconds, and a useful batch is a hundred or more of them. Run on the main
// thread that freezes the interface solid. Here it runs on its own thread, so
// the map keeps drawing, the run stays cancellable, and progress is honest.

import { monteCarloBatch, summarizeRuns } from './simEngine';
import { rehydratePlan } from './planFns';

let cancelled = false;

self.onmessage = (e) => {
  const msg = e.data || {};

  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'run') return;

  cancelled = false;
  const plan = rehydratePlan(msg.plan);
  const { base, n, offset = 0, raw = false } = msg;
  const acc = [];
  let done = 0;

  // Chunked so progress can be reported and a cancel can land between chunks.
  const CHUNK = 8;
  try {
    while (done < n) {
      if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }
      const seeds = [];
      for (let i = 0; i < CHUNK && done + i < n; i++) {
        seeds.push((base + (offset + done + i) * 2654435761) >>> 0);
      }
      const batch = monteCarloBatch(plan, seeds);
      for (const r of batch) acc.push(r);
      done += seeds.length;
      self.postMessage({ type: 'progress', done, n });
    }
    if (raw) self.postMessage({ type: 'done', runs: acc, base });
    else self.postMessage({ type: 'done', result: summarizeRuns(acc), base });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
