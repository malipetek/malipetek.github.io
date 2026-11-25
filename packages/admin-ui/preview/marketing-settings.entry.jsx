/*
 * The mount for the marketing settings harness: the real MarketingView over a
 * fixture api. Every GET /admin/marketing builds a fresh settings object, the
 * way the Worker's readMarketingSettings does, so the desk's 30-second poll
 * behaves exactly as it does against the real backend.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminContext } from '../src/store.js';
import { MarketingView } from '../src/marketing.jsx';
import { STYLES } from '../src/styles.js';

const SETTINGS = {
  live: true,
  dailyCap: 20,
  perRun: 5,
  startHour: 8,
  endHour: 17,
  offsetMinutes: 180,
  weekdaysOnly: true,
  postalAddress: '1 Test Street, Testville',
  fromName: 'Ali Petek',
  voiceNotes: '',
  provider: 'cloudflare',
  postApproval: true,
  reviewFirst: false,
  image: 'first',
  autoResume: true,
  obsShare: 50,
  postHoldHours: 24,
};

let saved = { ...SETTINGS };

const overview = () => ({
  settings: { ...saved },
  unavailable: [],
  sender: 'hello@ptechsolutions.net',
  inbox: 'hello@ptechsolutions.net',
  bound: true,
  senderState: { ready: true },
  providers: { cloudflare: true, ses: false },
  health: {
    sent: 10, bounces: 0, bounceRate: 0, complaints: 0, complaintRate: 0, trip: null,
    maxBounceRate: 0.04, maxComplaintRate: 0.002,
  },
  postsAwaiting: 0,
  window: { open: true, reason: '' },
  today: 3,
  autoResume: { enabled: true, autoPausedAt: null, resumesAfter: null, resumedAt: null, cap: 20 },
  observe: { pending: 0, observed: 0, withGap: 0, byKind: {} },
  domains: { checked: 0, undeliverable: 0 },
  counts: {
    contacts: { new: 1, queued: 2, contacted: 0, replied: 0, opted_out: 0, bounced: 0, paused: 0 },
    messages: { draft: 0, scheduled: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 },
  },
  due: { email: 0, x: 0, linkedin: 0 },
  nextAt: null,
  events: [],
  sequences: [
    { key: 'cold_a', label: 'Cold A', needsGap: false, stats: { sent: 0, replies: 0, optedOut: 0, bounced: 0 } },
    { key: 'cold_b', label: 'Cold B', needsGap: true, stats: { sent: 0, replies: 0, optedOut: 0, bounced: 0 } },
  ],
});

const api = async (method, path, body) => {
  (window.__calls ??= []).push(`${method} ${path}`);
  if (path === '/admin/marketing') return overview();
  if (path === '/admin/marketing/contacts') return { contacts: [], total: 0, page: 200 };
  if (path === '/admin/marketing/stats?days=14') return { days: [], offsetMinutes: 180 };
  if (path === '/admin/marketing/replies') return { replies: [] };
  if (path === '/admin/marketing/review?limit=1') return { nextDay: null };
  if (path.startsWith('/admin/marketing/sequences/preview')) {
    return { sequence: 'cold_a', label: 'Cold A', contact: null, footer: '', steps: [{ kind: 'cold_a_1', day: 0, subject: 'Hello', body: 'Body', plain: null, usesPlain: false }] };
  }
  if (path === '/admin/marketing/sources') return { sources: [] };
  if (path === '/admin/health/deepseek') return { bridge: true, chat: true, engine: null };
  if (path === '/admin/marketing/run' && method === 'POST') return { ran: 0 };
  if (path === '/admin/marketing/settings' && method === 'PUT') {
    // A from name of FAIL NOW makes the save fail, to cover the retry path.
    if (body?.fromName === 'FAIL NOW') throw new Error('settings down');
    saved = { ...saved, ...body };
    return { settings: { ...saved }, rejected: [] };
  }
  return {};
};

const ctx = {
  api,
  act: async (fn, done) => {
    const out = await fn();
    window.__lastDone = typeof done === 'function' ? done(out) : done;
    return out;
  },
  notify: (text) => { window.__notify = text; },
};

createRoot(document.getElementById('root')).render(
  <AdminContext.Provider value={ctx}>
    <style>{STYLES}</style>
    <MarketingView />
  </AdminContext.Provider>,
);
