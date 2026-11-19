/** Own the write stages, independently of React's deferred state updates. */
export function createSubmission() {
 let busy = false, pending = null;
 const queueOnly = async () => { await pending(); pending = null; };
 return {
  get busy() { return busy; },
  get pendingQueue() { return Boolean(pending); },
  async run({save, onSaved, queue}) {
   if (busy || pending) return;
   busy = true;
   try {
    const saved = await save();
    if (queue) pending = queue;
    onSaved?.(saved);
    if (pending) await queueOnly();
   } finally { busy = false; }
  },
  async retryQueue() {
   if (busy || !pending) return;
   busy = true;
   try { await queueOnly(); } finally { busy = false; }
  },
 };
}
