/*
 * Client portal — browser side. Talks to the intercom Worker (same
 * PUBLIC_CHAT_ENDPOINT) with an opaque bearer session kept in localStorage.
 * The site and the Worker live on different origins, so no cookies.
 */
import { getTurnstileToken } from './chatBackend.js';

export const ENDPOINT = String(import.meta.env.PUBLIC_CHAT_ENDPOINT || '').replace(/\/+$/, '');
const KEY = 'portal-session';

export type Status = 'new' | 'approved' | 'in_progress' | 'review' | 'done' | 'declined';

export const STATUS_LABEL: Record<Status, string> = {
  new: 'Waiting for Ali',
  approved: 'Approved',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
  declined: 'Declined',
};

export const STATUSES = Object.keys(STATUS_LABEL) as Status[];

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'client' | 'admin';
}

export interface Project {
  id: string;
  slug: string;
  name: string;
}

export interface Ticket {
  id: number;
  title: string;
  status: Status;
  created_at: number;
  updated_at: number;
  project_id: string | null;
  project_name: string | null;
  client_email?: string;
  client_name?: string | null;
}

export interface Message {
  id: number;
  author: 'client' | 'ali' | 'system' | 'runner';
  body: string;
  internal: 0 | 1;
  created_at: number;
}

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

export const session = {
  get: () => localStorage.getItem(KEY),
  set: (token: string) => localStorage.setItem(KEY, token),
  clear: () => localStorage.removeItem(KEY),
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!ENDPOINT) throw new ApiError('offline', 0);
  const headers: Record<string, string> = {};
  const token = session.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A dead session anywhere means "sign in again", not a broken page.
    if (res.status === 401 && path !== '/auth/verify') session.clear();
    throw new ApiError((data as { error?: string }).error ?? 'error', res.status);
  }
  return data as T;
}

export async function requestLink(email: string) {
  let turnstileToken = '';
  try {
    turnstileToken = await getTurnstileToken();
  } catch {
    turnstileToken = '';
  }
  return api<{ ok: true; devLink?: string }>('/auth/request', { body: { email, turnstileToken } });
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    session.clear();
  }
}

/* ————— rendering helpers ————— */

type Child = Node | string | null | undefined | false;

/** Tiny element builder. Text goes in as text nodes — never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | number | boolean | undefined> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function statusBadge(status: Status) {
  return h('span', { class: `status status--${status}` }, STATUS_LABEL[status]);
}

export function fmtTime(unix: number) {
  return new Date(unix * 1000).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function errorText(error: unknown) {
  const code = error instanceof ApiError ? error.code : 'error';
  const MAP: Record<string, string> = {
    offline: 'The portal backend is not configured on this build.',
    network: 'Network error. Check your connection and try again.',
    rate_limited: 'Too many tries. Give it a few minutes.',
    turnstile_failed: 'The bot check failed. Reload and try again.',
    bad_email: 'That email does not look right.',
    mail_failed: 'Could not send the email. Try again, or email malipetek@gmail.com.',
    link_expired: 'This sign-in link has expired or was already used.',
    unauthorized: 'Your session expired. Sign in again.',
    not_found: 'Not found.',
    bad_ticket: 'Add a title and a description.',
  };
  return MAP[code] ?? 'Something went wrong. Try again.';
}

/** A ticket thread as a ruled list. `viewer` decides whose messages read as "You". */
export function renderThread(messages: Message[], viewer: 'client' | 'admin') {
  const who = (m: Message) => {
    if (m.author === 'system') return 'Status';
    if (m.author === 'runner') return 'Runner';
    if (m.author === 'ali') return viewer === 'admin' ? 'You' : 'Ali';
    return viewer === 'client' ? 'You' : 'Client';
  };
  return h(
    'ol',
    { class: 'thread' },
    ...messages.map((m) =>
      h(
        'li',
        { class: `msg msg--${m.author}${m.internal ? ' msg--internal' : ''}` },
        h('p', { class: 'msg-who' }, h('strong', null, who(m)), fmtTime(m.created_at)),
        h('p', { class: 'msg-body' }, m.body),
      ),
    ),
  );
}
