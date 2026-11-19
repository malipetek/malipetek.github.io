const LOCK = 'ptech-admin:conversation-time';
const IDLE_MS = 60_000;
const BATCH = 20;
const EMPTY = Object.freeze({ status: null, seconds: null, phase: 'paused', notice: null, needsRead: false });
const closed = status => status === 'done' || status === 'declined';
const recorded = seconds => Number.isSafeInteger(seconds) && seconds >= 0;

export function formatRecordedTime(seconds) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}

/** A desktop writer lease, held even while draining the last save. The portal's
 * additive endpoint has no idempotency key: acknowledge or stop, never resend. */
export function createConversationMeter({ api, locks, now, foreground }) {
  const views = new Map();
  const listeners = new Set();
  let owner = null;
  let lastInput = -Infinity;
  let revision = 0;

  function update(view, patch) {
    if (!Object.keys(patch).some(key => view.snapshot[key] !== patch[key])) return;
    view.snapshot = { ...view.snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  function drain(lease) {
    if (!lease.release || lease.saving) return;
    if (lease.pending && (!lease.enabled || lease.pending >= BATCH)) {
      void save(lease);
    } else if (!lease.enabled) {
      lease.release();
    }
  }

  function stop(lease, { discard = false, notice = null } = {}) {
    lease.enabled = false;
    if (discard) lease.pending = 0;
    const view = lease.view;
    if (!closed(view.snapshot.status)) update(view, { phase: lease.saving || lease.pending ? 'saving' : 'paused', notice });
    drain(lease);
  }

  async function save(lease) {
    const { view } = lease;
    if (closed(view.snapshot.status)) { stop(lease, { discard: true }); return; }
    const seconds = lease.pending;
    lease.pending = 0;
    lease.saving = true;
    try {
      const result = await api('POST', `/admin/tickets/${view.id}/time`, { seconds });
      if (!recorded(result?.humanSeconds)) throw new Error('Missing meter acknowledgement');
      revision++;
      for (const matching of views.values()) {
        if (matching.id !== view.id || closed(matching.snapshot.status)) continue;
        matching.savedAt = revision;
        update(matching, { seconds: result.humanSeconds });
      }
    } catch {
      // A timed-out request may already have billed. Drop this and all queued
      // time, expose the pause, and let the header read the authoritative total.
      ++revision;
      for (const matching of views.values()) {
        if (matching.id !== view.id || closed(matching.snapshot.status)) continue;
        matching.savedAt = revision;
        update(matching, { needsRead: true, notice: 'unconfirmed' });
      }
      stop(lease, { discard: true, notice: 'unconfirmed' });
    } finally {
      lease.saving = false;
      drain(lease);
    }
  }

  function retain(key, id, isCurrent = () => true) {
    let view = views.get(key);
    if (!view) {
      view = { id: String(id), snapshots: new Set(), snapshot: EMPTY, savedAt: 0 };
      views.set(key, view);
    }
    // Each mounted header contributes its eligibility without creating another writer.
    const mount = () => isCurrent();
    view.snapshots.add(mount);
    return () => {
      view.snapshots.delete(mount);
      if (view.snapshots.size || views.get(key) !== view) return;
      views.delete(key);
      if (owner?.view === view) stop(owner);
    };
  }

  function observe(key, ticket, readAt) {
    const view = views.get(key);
    if (!view || String(ticket?.id) !== view.id || typeof ticket.status !== 'string') return false;
    for (const matching of views.values()) {
      if (matching.id !== view.id) continue;
      update(matching, {
        status: ticket.status,
        ...(readAt >= matching.savedAt && recorded(ticket.human_seconds) ? {
          seconds: ticket.human_seconds,
          needsRead: false,
          ...(matching.snapshot.notice === 'readFailed' ? { notice: null } : {}),
        } : {}),
        ...(closed(ticket.status) ? { phase: 'closed', notice: null } : matching.snapshot.phase === 'closed' ? { phase: 'paused' } : {}),
      });
    }
    if (closed(ticket.status) && owner?.view.id === view.id) stop(owner, { discard: true });
    return true;
  }

  function readFailed(key) {
    const view = views.get(key);
    if (!view || closed(view.snapshot.status)) return;
    update(view, { needsRead: true, notice: view.snapshot.notice ?? 'readFailed' });
    if (owner?.view === view) stop(owner, { discard: true, notice: view.snapshot.notice });
  }

  const current = view => [...view.snapshots].some(check => check());

  async function resume(key) {
    const view = views.get(key);
    if (!view?.snapshot.status || closed(view.snapshot.status) || view.snapshot.needsRead || view.snapshot.seconds === null || !current(view)) return;
    if (owner) {
      if (owner.view !== view) update(view, { notice: 'occupied' });
      return;
    }
    if (typeof locks?.request !== 'function') { update(view, { notice: 'unavailable' }); return; }
    const lease = { view, enabled: true, release: null, pending: 0, saving: false, anchor: null };
    owner = lease;
    update(view, { phase: 'starting', notice: null });
    try {
      await locks.request(LOCK, { ifAvailable: true }, lock => {
        if (!lease.enabled || !current(view)) return undefined;
        if (!lock) { update(view, { notice: 'occupied' }); return undefined; }
        lastInput = now(); // The explicit click or keypress itself counts as activity.
        if (foreground()) lease.anchor = lastInput;
        update(view, { phase: foreground() ? 'running' : 'waiting' });
        return new Promise(resolve => { lease.release = resolve; });
      });
    } catch {
      update(view, { notice: 'unavailable' });
    } finally {
      owner = null;
      if (!closed(view.snapshot.status)) update(view, { phase: 'paused' });
    }
  }

  function tick() {
    const lease = owner;
    if (!lease?.enabled || !lease.release) return;
    if (!current(lease.view)) { stop(lease); return; }
    const at = now();
    const eligible = foreground() && at - lastInput < IDLE_MS;
    update(lease.view, { phase: eligible ? 'running' : 'waiting' });
    const elapsed = lease.anchor === null ? 0 : at - lease.anchor;
    if (!eligible || elapsed >= 2_000) { lease.anchor = eligible ? at : null; return; }
    if (lease.anchor === null) lease.anchor = at;
    if (elapsed < 1_000) return;
    lease.anchor += 1_000;
    // Bound how much unconfirmed time accumulates behind a slow request.
    if (lease.pending < BATCH) lease.pending++;
    drain(lease);
  }

  function suspend() {
    if (!owner?.enabled || !owner.release) return;
    owner.anchor = null;
    update(owner.view, { phase: 'waiting' });
  }

  return {
    retain, observe, readFailed, resume, tick, suspend,
    revision: () => revision,
    snapshot: key => views.get(key)?.snapshot ?? EMPTY,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    input() {
      const at = now();
      if (at - lastInput >= IDLE_MS) suspend();
      lastInput = at;
    },
    pause(key) { if (views.get(key) === owner?.view && owner) stop(owner); },
    leave() { if (owner) stop(owner); },
  };
}
