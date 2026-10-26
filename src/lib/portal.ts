/*
 * Client portal — browser side. Talks to the intercom Worker (same
 * PUBLIC_CHAT_ENDPOINT) with an opaque bearer session kept in localStorage.
 * The site and the Worker live on different origins, so no cookies.
 */
import { getTurnstileToken } from './chatBackend.js';
import { ATTENTION, clock, money, priceOf } from './pricing.js';
import { sizeText } from './attachments.js';

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

/** 'existing' = the client brings a site or codebase. 'new' = we create it. */
export type ProjectKind = 'existing' | 'new';
export type RepoKind = 'repo' | 'zip' | 'none';

export type CheckState = 'ready' | 'missing' | 'pending' | 'unknown';

/** One step between "signed up" and "servable without a human preparing it". */
export interface SetupCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
  owner: 'you' | 'us';
  blocking: boolean;
}

export interface Setup {
  checks: SetupCheck[];
  ready: number;
  total: number;
  autonomous: boolean;
  next?: string;
}

/** What the interview asked, in the client's own words. */
export interface Brief {
  what: string;
  where?: string;
  manual?: string;
  goal: string;
}

export type SiteState = 'signin' | 'creating' | 'provisioning' | 'ready' | 'failed';

/** A project's hosted site, when it has one. */
export interface Site {
  state: SiteState;
  previewUrl: string | null;
  editorUrl: string | null;
  productionUrl: string | null;
  customDomain: string | null;
  repoUrl: string | null;
  error: string | null;
  previewUpdatedAt: number | null;
  updatedAt: number;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  kind: ProjectKind;
  repoKind: RepoKind;
  repo: string | null;
  site: Site | null;
  setup: Setup;
}

export interface Ticket {
  id: number;
  title: string;
  status: Status;
  created_at: number;
  updated_at: number;
  project_id: string | null;
  project_name: string | null;
  /** How much of Ali the client asked for (src/lib/pricing.js ATTENTION). */
  attention: 'auto' | 'checked' | 'hands_on';
  human_seconds: number;
  ai_micro_usd: number;
  budget_cents: number | null;
  /** Frozen total once done; null while the meter runs. */
  price_cents: number | null;
  client_email?: string;
  client_name?: string | null;
  /** The work queue (worker/src/queue.ts). */
  kind?: 'client' | 'system';
  source?: string;
  priority?: number;
  /** JSON array of capabilities, as stored. */
  requires?: string;
  executor?: string | null;
  project_slug?: string | null;
  /** Client list only: something new from Ali since the client last opened it. */
  unread?: 0 | 1;
}

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface Message {
  id: number;
  author: 'client' | 'ali' | 'system' | 'runner';
  body: string;
  internal: 0 | 1;
  created_at: number;
  files?: FileMeta[];
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

/**
 * Call the Worker. `body` goes as JSON; `form` (FormData, for files) goes as
 * multipart and the browser sets its content type.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  if (!ENDPOINT) throw new ApiError('offline', 0);
  const headers: Record<string, string> = {};
  const token = session.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined && !init.form) headers['content-type'] = 'application/json';
  const sending = init.form !== undefined || init.body !== undefined;

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}${path}`, {
      method: init.method ?? (sending ? 'POST' : 'GET'),
      headers,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
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

/** The interview, as the Worker's `POST /portal/projects` expects it. */
export interface NewProject {
  kind: ProjectKind;
  name: string;
  brief: Brief;
  repoKind?: RepoKind;
  repo?: string;
  attention?: string;
  budgetCents?: number;
}

/**
 * Create a project from the interview and file its first request.
 * Resolves to the new project and the ticket the client lands on.
 */
export async function createProject(input: NewProject) {
  return api<{ project: Omit<Project, 'setup'>; ticketId: number }>('/portal/projects', { body: input });
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
    bad_message: 'It needs some text.',
    bad_project: 'Pick a project.',
    bad_brief: 'Answer the questions — a sentence each is enough.',
    bad_repo: 'That does not look like a repo URL. Send a https:// or git@ link, or pick a zip.',
    slug_taken: 'A project with that slug already exists.',
    bad_priority: 'That priority is out of range.',
    bad_requires: 'Those capabilities are not valid.',
    bad_executor: 'Pick claude, opencode, dsh or devin — or any.',
    client_executor: 'Client work only runs on Claude Code.',
    bad_settings: 'One of those settings is out of range.',
    bad_overrides: 'Those node settings are out of range.',
    bad_node: 'That node is not known.',
    not_running: 'That run already finished.',
    file_type: 'That type of file is not accepted. Images, PDF, text, CSV, JSON, zip, Word and Excel are.',
    file_too_large: 'A file is over 10 MB.',
    too_many_files: 'Too many files: at most 5 at a time, 30 on one request.',
    bad_file: 'A file was empty or had no name.',
    files_unavailable: 'Attachments are not available right now. Send the text alone, or try later.',
    not_withdrawable: 'Ali has already approved this one. Write to him below to stop it.',
    forbidden: 'That needs the admin account.',
  };
  return MAP[code] ?? 'Something went wrong. Try again.';
}

/**
 * Save a file from the Worker. A plain link cannot carry the session token, so
 * fetch it with the token and hand the browser the bytes.
 */
export async function downloadFile(path: string, name: string) {
  const token = session.get();
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) throw new ApiError(res.status === 404 ? 'not_found' : 'error', res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A message's files as download buttons. `base` is the ticket's files path. */
function fileList(files: FileMeta[], base: string) {
  return h(
    'ul',
    { class: 'msg-files' },
    ...files.map((f) => {
      const b = h('button', { type: 'button', class: 'msg-file' }, f.name, h('span', null, sizeText(f.size)));
      b.addEventListener('click', () => {
        b.disabled = true;
        downloadFile(`${base}/${f.id}`, f.name)
          .catch((e) => alertInline(b, errorText(e)))
          .finally(() => (b.disabled = false));
      });
      return h('li', null, b);
    }),
  );
}

function alertInline(el: HTMLElement, text: string) {
  el.title = text;
  el.classList.add('is-error');
}

/**
 * A ticket thread as a ruled list. `viewer` decides whose messages read as
 * "You"; `filesBase` (e.g. /portal/tickets/12/files) makes attachments downloadable.
 */
export function renderThread(messages: Message[], viewer: 'client' | 'admin', filesBase?: string) {
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
        h('div', null, m.body ? h('p', { class: 'msg-body' }, m.body) : null, m.files?.length && filesBase ? fileList(m.files, filesBase) : null),
      ),
    ),
  );
}

/* ————— pricing display ————— */

export const attentionName = (key: string) => ATTENTION.find((a) => a.key === key)?.name ?? key;

/**
 * The bill as the ticket stands: total, then the two parts it is made of.
 * Same block for the client and for Ali — there is nothing to hide in it.
 */
export function costBlock(ticket: Ticket) {
  const p = priceOf({ humanSeconds: ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd });
  const final = ticket.price_cents !== null;
  const total = final ? ticket.price_cents! : p.totalCents;
  const over = ticket.budget_cents !== null && total > ticket.budget_cents;
  return h(
    'div',
    { class: `cost${over ? ' cost--over' : ''}` },
    h('p', { class: 'portal-label' }, final ? 'Total' : 'Cost so far'),
    h('p', { class: 'cost-total' }, money(total)),
    h(
      'p',
      { class: 'cost-parts' },
      `${clock(ticket.human_seconds)} of Ali's time ${money(p.timeCents)} + AI at cost ${money(p.aiCents)}`,
    ),
    h(
      'p',
      { class: 'cost-parts' },
      `${attentionName(ticket.attention)}${ticket.budget_cents !== null ? ` · budget ${money(ticket.budget_cents)}${over ? ' — over' : ''}` : ''}`,
    ),
  );
}
