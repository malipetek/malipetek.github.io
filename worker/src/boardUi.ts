/*
 * The plugin's one piece of UI, "malipetek development": the account's
 * projects, sites and requests in three tabs, served as an MCP Apps resource
 * (specification: `text/html;profile=mcp-app`, `ui://` URI).
 *
 * Deliberately hand-written — no bundler, no framework, no external asset.
 * The iframe loads with no network access at all: every byte arrives with the
 * resource, and the only way out is the MCP Apps bridge (postMessage), which
 * the host proxies to this same server. That is also why the resource declares
 * no CSP domains — the default restrictive policy is exactly what it needs.
 *
 * Versioned URI: it is the cache key, so a breaking change here means a new
 * URI in BOARD_UI_URI and in the tool's _meta (clientTools.ts).
 */

import { ALI_AVATAR } from './boardAvatar.ts';

export const BOARD_UI_URI = 'ui://malipetek/board-v5.html';

export const BOARD_MIME = 'text/html;profile=mcp-app';

export const BOARD_PORTAL = 'https://malipetek.dev/portal';

export interface BoardRequest {
  id: number;
  title: string | null;
  status: string | null;
  project: string | null;
  site: string | null;
  updated_at: string | null;
  unread: boolean;
  price_cents: number | null;
  budget_cents: number | null;
}

export interface BoardProject {
  id: string | null;
  name: string | null;
  requests: number;
  open: number;
  sites: number;
  setup: { ready: number; total: number; next: string | null };
}

export interface BoardSite {
  id: string | null;
  name: string | null;
  project: string | null;
  state: string | null;
  live: boolean;
  has_preview: boolean;
  preview_url: string | null;
  production_url: string | null;
  updated_at: string | null;
}

export interface Board {
  account: { name: string | null };
  projects: BoardProject[];
  sites: BoardSite[];
  requests: BoardRequest[];
  updated_at: string;
  /** The request whose conversation the card opens on. */
  focus?: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Waiting for Ali',
  approved: 'Approved',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
  declined: 'Declined',
};

const dollars = (cents: number | null) =>
  cents ? `$${(cents / 100).toFixed(2)}` : '';

/** What a site is doing, in the words the card uses too. */
export function siteLabel(site: Pick<BoardSite, 'state' | 'live' | 'has_preview'>): string {
  if (site.state === 'failed') return 'Failed';
  if (site.state !== 'ready') return 'Setting up';
  if (site.live) return 'Live';
  return site.has_preview ? 'Preview only' : 'Nothing built yet';
}

/**
 * The text half of the tool result: what a host without UI support (or a model
 * reading the result back) gets. Kept to what matters rather than dumping the
 * whole payload twice.
 */
export function boardSummary(board: Board): string {
  const who = board.account?.name ? ` for ${board.account.name}` : '';
  const projects = board.projects ?? [];
  const sites = board.sites ?? [];
  const requests = board.requests ?? [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const out = [`malipetek development${who}: ${plural(projects.length, 'project')}, ${plural(sites.length, 'site')}, ${plural(requests.length, 'request')}.`];
  if (projects.length) {
    out.push('', 'Projects:');
    for (const project of projects) {
      const bits = [
        `${project.open} open of ${plural(project.requests, 'request')}`,
        project.setup.total ? `setup ${project.setup.ready}/${project.setup.total}` : '',
        project.setup.next ? `next: ${project.setup.next}` : '',
      ].filter(Boolean);
      out.push(`- ${project.name ?? 'Untitled project'} — ${bits.join(' · ')}`);
    }
  }
  if (sites.length) {
    out.push('', 'Sites:');
    for (const site of sites) {
      const address = site.live ? site.production_url : site.has_preview ? site.preview_url : null;
      out.push(`- ${site.name ?? 'Site'} (${site.project ?? 'no project'}) — ${siteLabel(site)}${address ? ` · ${address}` : ''}`);
    }
  }
  if (requests.length) {
    out.push('', 'Requests, newest activity first:');
    for (const request of requests) {
      const bits = [STATUS_LABELS[request.status ?? ''] ?? request.status, request.project, dollars(request.price_cents)].filter(Boolean);
      out.push(`#${request.id} ${request.title ?? 'Untitled request'} — ${bits.join(' · ')}`);
    }
  } else {
    out.push('', 'No requests yet.');
  }
  const focused = board.focus ? requests.find((request) => request.id === board.focus) : null;
  if (focused) out.push('', `The card is open on #${focused.id} ${focused.title ?? 'Untitled request'}: its conversation with Ali, where the client can reply.`);
  out.push('', `The same in the portal: ${BOARD_PORTAL}`);
  return out.join('\n');
}

/**
 * The view. Everything below is inline on purpose: the host's default CSP is
 * `script-src 'self' 'unsafe-inline'` with `connect-src 'none'`, so this file
 * works unmodified in any MCP Apps host.
 */
export const BOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>malipetek development</title>
<style>
  :root {
    color-scheme: light;
    --mk-bg: var(--color-background-primary, transparent);
    --mk-ink: var(--color-text-primary, light-dark(#16140f, #ece5d8));
    --mk-soft: var(--color-text-secondary, light-dark(#5d5850, #a0978a));
    --mk-rule: var(--color-border-secondary, light-dark(#e8e4dd, #2a2622));
    --mk-tint: light-dark(#faf8f4, #1b1917);
    --mk-bubble: light-dark(#f4f4f4, #303030);
    --mk-field: light-dark(#ffffff, #303030);
    --mk-paper: light-dark(#ffffff, #212121);
    --mk-orange: #ff5a1f;
    --mk-ok: light-dark(#2f9e5b, #6fce8f);
    --mk-bad: light-dark(#c0392b, #f08a80);
    --mk-radius: var(--border-radius-md, 10px);
    --mk-sans: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif);
    --mk-mono: var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--mk-bg); }
  body {
    font: 14px/1.45 var(--mk-sans);
    color: var(--mk-ink);
    padding: 12px 14px 10px;
    -webkit-font-smoothing: antialiased;
  }
  .mk-app { max-width: 760px; margin: 0 auto; }
  .mk-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mk-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .mk-mark { width: 10px; height: 10px; border-radius: 3px; background: var(--mk-orange); flex: none; }
  .mk-name { font: 600 15px/1.2 var(--mk-sans); letter-spacing: -.01em; white-space: nowrap; }
  .mk-who { font: 500 11px/1 var(--mk-mono); color: var(--mk-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-btn {
    font: 500 11px/1 var(--mk-mono);
    color: var(--mk-ink);
    background: transparent;
    border: 1px solid var(--mk-rule);
    border-radius: 999px;
    padding: 6px 10px;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color .15s ease, color .15s ease, background .15s ease;
  }
  .mk-btn:hover { border-color: var(--mk-orange); color: var(--mk-orange); }
  .mk-btn:focus-visible, .mk-tab:focus-visible, .mk-card:focus-visible { outline: 2px solid var(--mk-orange); outline-offset: 2px; }
  .mk-btn[disabled] { opacity: .5; cursor: default; }
  .mk-tabs { display: flex; gap: 2px; margin: 12px 0 10px; border-bottom: 1px solid var(--mk-rule); }
  .mk-tab {
    font: 550 13px/1 var(--mk-sans);
    color: var(--mk-soft);
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 8px 10px 9px;
    cursor: pointer;
    display: flex; align-items: center; gap: 6px;
  }
  .mk-tab:hover { color: var(--mk-ink); }
  .mk-tab[aria-selected="true"] { color: var(--mk-ink); border-bottom-color: var(--mk-orange); }
  .mk-tab__n { font: 500 10.5px/1 var(--mk-mono); padding: 2px 6px; border-radius: 999px; background: color-mix(in srgb, var(--mk-ink) 7%, transparent); }
  .mk-tab[aria-selected="true"] .mk-tab__n { background: color-mix(in srgb, var(--mk-orange) 14%, transparent); color: var(--mk-orange); }
  .mk-panel[hidden] { display: none; }
  .mk-list { display: flex; flex-direction: column; gap: 10px; }
  /* Projects: one card each, the thing a client thinks in. */
  .mk-card {
    display: block; width: 100%; text-align: left; font: inherit; color: inherit;
    border: 1px solid var(--mk-rule); border-radius: var(--mk-radius);
    background: transparent; padding: 11px 12px; cursor: pointer;
    transition: border-color .15s ease;
  }
  .mk-card:hover { border-color: color-mix(in srgb, var(--mk-orange) 55%, var(--mk-rule)); }
  .mk-card__top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .mk-card__name { font: 600 13.5px/1.25 var(--mk-sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-card__go { font: 500 11px/1 var(--mk-mono); color: var(--mk-soft); white-space: nowrap; }
  .mk-card:hover .mk-card__go { color: var(--mk-orange); }
  .mk-bar { height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--mk-ink) 8%, transparent); overflow: hidden; margin: 9px 0 6px; }
  .mk-bar span { display: block; height: 100%; background: var(--mk-orange); border-radius: inherit; }
  .mk-bar[data-done="true"] span { background: var(--mk-ok); }
  .mk-next { font-size: 12px; color: var(--mk-soft); margin-top: 4px; }
  .mk-next b { font-weight: 600; color: var(--mk-ink); }
  /* Requests: grouped by project, newest activity first inside each. */
  .mk-group { border: 1px solid var(--mk-rule); border-radius: var(--mk-radius); overflow: hidden; }
  .mk-group__head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 12px; background: var(--mk-tint);
    border-bottom: 1px solid var(--mk-rule);
  }
  .mk-group__name { font: 600 12.5px/1.2 var(--mk-sans); letter-spacing: -.005em; }
  .mk-group__meta { font: 500 10.5px/1 var(--mk-mono); color: var(--mk-soft); text-transform: uppercase; letter-spacing: .08em; }
  .mk-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
  }
  .mk-row + .mk-row { border-top: 1px solid var(--mk-rule); }
  .mk-boxed { border: 1px solid var(--mk-rule); border-radius: var(--mk-radius); overflow: hidden; }
  .mk-title { font-weight: 550; font-size: 13.5px; display: flex; align-items: center; gap: 6px; min-width: 0; }
  .mk-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--mk-orange); flex: none; }
  .mk-meta { margin-top: 3px; font-size: 11.5px; color: var(--mk-soft); display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
  .mk-url { font: 500 11px/1.3 var(--mk-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .mk-btns { display: flex; gap: 6px; }
  .mk-pill {
    font: 500 10px/1 var(--mk-mono);
    letter-spacing: .02em;
    padding: 3px 7px;
    border-radius: 999px;
    border: 1px solid var(--mk-rule);
    color: var(--mk-soft);
    white-space: nowrap;
  }
  .mk-pill[data-tone="wait"] { color: var(--mk-orange); border-color: color-mix(in srgb, var(--mk-orange) 40%, transparent); background: color-mix(in srgb, var(--mk-orange) 8%, transparent); }
  .mk-pill[data-tone="active"] { color: var(--mk-ink); border-color: color-mix(in srgb, var(--mk-ink) 25%, transparent); }
  .mk-pill[data-tone="done"] { color: var(--mk-ok); border-color: color-mix(in srgb, var(--mk-ok) 40%, transparent); }
  .mk-pill[data-tone="bad"] { color: var(--mk-bad); border-color: color-mix(in srgb, var(--mk-bad) 35%, transparent); }
  .mk-filter { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12px; color: var(--mk-soft); }
  .mk-filter[hidden] { display: none; }
  .mk-filter b { color: var(--mk-ink); font-weight: 600; }
  .mk-empty { padding: 14px 2px 6px; color: var(--mk-soft); font-size: 13px; }
  .mk-skel { height: 48px; margin: 0 0 10px; border-radius: var(--mk-radius); background: color-mix(in srgb, var(--mk-ink) 6%, transparent); animation: mk-pulse 1.4s ease-in-out infinite; }
  @keyframes mk-pulse { 50% { opacity: .45; } }
  .mk-foot {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px dashed var(--mk-rule);
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    color: var(--mk-soft);
  }
  .mk-link {
    font: 500 11px/1 var(--mk-mono);
    color: var(--mk-soft);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-style: dashed;
    white-space: nowrap;
  }
  .mk-link:hover { color: var(--mk-orange); }
  .mk-err { color: var(--mk-bad); font-size: 12.5px; padding: 8px 0; }
  /* —— one request as a conversation, laid out like a ChatGPT chat —— */
  .mk-tabs[hidden] { display: none; }
  .mk-thread-head { display: flex; align-items: center; gap: 10px; margin: 12px 0 0; padding-bottom: 10px; border-bottom: 1px solid var(--mk-rule); }
  .mk-thread-title { flex: 1; min-width: 0; font: 600 14px/1.3 var(--mk-sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-chat { display: flex; flex-direction: column; gap: 20px; padding: 18px 4px 14px; max-height: 460px; overflow-y: auto; overscroll-behavior: contain; }
  body[data-mode="fullscreen"] .mk-chat { max-height: calc(100vh - 210px); }
  .mk-turn--client {
    align-self: flex-end; max-width: 78%;
    background: var(--mk-bubble); border-radius: 18px; padding: 9px 15px;
  }
  .mk-turn--client.mk-sending { opacity: .55; }
  .mk-turn--other { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 11px; }
  .mk-avatar {
    width: 26px; height: 26px; border-radius: 999px; display: grid; place-items: center;
    font: 600 11px/1 var(--mk-sans); color: #fff; background: var(--mk-orange); margin-top: 1px;
  }
  .mk-avatar[data-who="ali"] { background: var(--mk-tint) center / cover no-repeat url("${ALI_AVATAR}"); }
  .mk-avatar[data-who="runner"] { background: color-mix(in srgb, var(--mk-ink) 72%, transparent); color: var(--mk-paper); }
  .mk-who-line { font: 600 13px/1.2 var(--mk-sans); margin-bottom: 4px; }
  .mk-when { font: 400 11.5px/1 var(--mk-sans); color: var(--mk-soft); margin-left: 6px; }
  .mk-text { font-size: 15px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
  .mk-turn--client .mk-when { display: block; text-align: right; margin: 4px 0 0; }
  .mk-sys { align-self: center; max-width: 88%; text-align: center; font-size: 12px; line-height: 1.45; color: var(--mk-soft); }
  .mk-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .mk-file { font: 500 11px/1 var(--mk-mono); border: 1px solid var(--mk-rule); border-radius: 8px; padding: 6px 8px; background: var(--mk-paper); }
  .mk-inline-link { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; text-align: left; }
  .mk-inline-link:hover { color: var(--mk-orange); }
  .mk-composer {
    display: flex; align-items: flex-end; gap: 8px;
    border: 1px solid var(--mk-rule); border-radius: 26px; background: var(--mk-field);
    padding: 6px 6px 6px 18px; box-shadow: 0 1px 8px rgba(0, 0, 0, .06);
  }
  .mk-composer:focus-within { border-color: color-mix(in srgb, var(--mk-ink) 30%, var(--mk-rule)); }
  .mk-composer textarea {
    flex: 1; min-width: 0; border: 0; outline: 0; resize: none; background: transparent;
    color: var(--mk-ink); font: 15px/1.5 var(--mk-sans); padding: 7px 0; max-height: 160px;
  }
  .mk-composer textarea::placeholder { color: var(--mk-soft); }
  .mk-send {
    width: 36px; height: 36px; flex: none; border: 0; border-radius: 999px; cursor: pointer;
    display: grid; place-items: center; background: var(--mk-ink); color: var(--mk-paper);
    transition: opacity .15s ease;
  }
  .mk-send[disabled] { opacity: .25; cursor: default; }
  .mk-send:focus-visible { outline: 2px solid var(--mk-orange); outline-offset: 2px; }
  body[data-view="thread"] .mk-foot { display: none; }
  .mk-compose-note { margin-top: 7px; text-align: center; font-size: 11px; color: var(--mk-soft); }
  @media (max-width: 420px) {
    .mk-row { grid-template-columns: minmax(0, 1fr); }
    .mk-tab { padding: 8px 7px 9px; }
  }
  @media (prefers-reduced-motion: reduce) { .mk-skel { animation: none; } }
</style>
</head>
<body>
<main class="mk-app">
<div class="mk-top">
  <div class="mk-brand">
    <span class="mk-mark" aria-hidden="true"></span>
    <span class="mk-name">malipetek development</span>
    <span class="mk-who" id="who"></span>
  </div>
  <button class="mk-btn" id="refresh" type="button">Refresh</button>
</div>

<div class="mk-tabs" id="tabs" role="tablist" aria-label="Your work">
  <button class="mk-tab" role="tab" id="tab-projects" data-tab="projects" aria-controls="panel-projects" aria-selected="true" type="button">Projects <span class="mk-tab__n" id="n-projects">–</span></button>
  <button class="mk-tab" role="tab" id="tab-sites" data-tab="sites" aria-controls="panel-sites" aria-selected="false" tabindex="-1" type="button">Sites <span class="mk-tab__n" id="n-sites">–</span></button>
  <button class="mk-tab" role="tab" id="tab-requests" data-tab="requests" aria-controls="panel-requests" aria-selected="false" tabindex="-1" type="button">Requests <span class="mk-tab__n" id="n-requests">–</span></button>
</div>

<section class="mk-panel" role="tabpanel" id="panel-projects" aria-labelledby="tab-projects" aria-live="polite">
  <div class="mk-list" id="projects"><div class="mk-skel"></div><div class="mk-skel"></div></div>
</section>
<section class="mk-panel" role="tabpanel" id="panel-sites" aria-labelledby="tab-sites" hidden>
  <div class="mk-list" id="sites"></div>
</section>
<section class="mk-panel" role="tabpanel" id="panel-requests" aria-labelledby="tab-requests" hidden>
  <div class="mk-filter" id="filter" hidden>
    <span>Showing <b id="filter-name"></b></span>
    <button class="mk-link" id="filter-clear" type="button">Show all</button>
  </div>
  <div class="mk-list" id="requests"></div>
</section>

<section class="mk-panel" id="panel-thread" aria-label="Conversation" hidden>
  <div class="mk-thread-head">
    <button class="mk-btn" id="back" type="button">← Requests</button>
    <div class="mk-thread-title" id="thread-title"></div>
    <span id="thread-status"></span>
  </div>
  <div class="mk-chat" id="chat" role="log" aria-live="polite"></div>
  <form class="mk-composer" id="composer">
    <textarea id="reply" rows="1" placeholder="Reply to Ali" aria-label="Reply to Ali"></textarea>
    <button class="mk-send" id="send" type="submit" aria-label="Send" disabled>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </form>
  <div class="mk-compose-note">Ali gets your reply by email and answers here. <button class="mk-link" id="thread-portal" type="button">Open in the portal ↗</button></div>
</section>

<div class="mk-foot">
  <span>Every request is read by a human before work starts.</span>
  <button class="mk-link" id="portal" type="button">Open the portal ↗</button>
</div>
</main>

<script>
(function () {
  'use strict';

  var PORTAL = 'https://malipetek.dev/portal';
  var STATUS = {
    new: { label: 'Waiting for Ali', tone: 'wait' },
    approved: { label: 'Approved', tone: 'active' },
    in_progress: { label: 'In progress', tone: 'active' },
    review: { label: 'In review', tone: 'active' },
    done: { label: 'Done', tone: 'done' },
    declined: { label: 'Declined', tone: 'bad' }
  };
  var TABS = ['projects', 'sites', 'requests'];

  var host = window.parent;
  var nextId = 1;
  var pending = {};
  var rendered = false;
  var fallbackTimer = null;
  var board = null;
  var tab = 'projects';
  var chosen = false;
  var projectFilter = null;
  var threadId = null;
  var focusDone = false;

  function $(id) { return document.getElementById(id); }
  var refreshEl = $('refresh');

  function send(message) {
    host.postMessage(message, '*');
  }

  function request(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: '2.0', id: id, method: method, params: params || {} });
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          reject(new Error('The host did not answer ' + method + '.'));
        }
      }, 25000);
    });
  }

  function notify(method, params) {
    send({ jsonrpc: '2.0', method: method, params: params || {} });
  }

  function openLink(url) {
    if (url) request('ui/open-link', { url: url }).catch(function () {});
  }

  function money(cents) {
    /* No cost yet is not "$0.00" — it is nothing to say. */
    if (typeof cents !== 'number' || !cents) return '';
    return '$' + (cents / 100).toFixed(2);
  }

  function relative(iso) {
    if (!iso) return '';
    var then = new Date(iso);
    if (isNaN(then.getTime())) return '';
    var seconds = Math.round((then.getTime() - Date.now()) / 1000);
    var rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    var steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
    var value = seconds;
    for (var i = 0; i < steps.length; i++) {
      if (Math.abs(value) < steps[i][0]) return rtf.format(Math.round(value), steps[i][1]);
      value = value / steps[i][0];
    }
    return '';
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return url || ''; }
  }

  function textOf(result) {
    if (!result || !result.content) return '';
    for (var i = 0; i < result.content.length; i++) {
      if (result.content[i] && result.content[i].type === 'text') return String(result.content[i].text || '');
    }
    return '';
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function button(label, onClick, className) {
    var b = el('button', className || 'mk-btn', label);
    b.type = 'button';
    b.addEventListener('click', function (event) { event.stopPropagation(); onClick(); });
    return b;
  }

  function pill(label, tone) {
    var p = el('span', 'mk-pill', label);
    p.setAttribute('data-tone', tone);
    return p;
  }

  function applyContext(context) {
    if (!context) return;
    // The host's theme wins over the OS: ChatGPT decides how its card looks.
    if (context.theme) document.documentElement.style.colorScheme = context.theme;
    if (context.locale) document.documentElement.lang = context.locale;
    if (context.displayMode) document.body.setAttribute('data-mode', context.displayMode);
    var vars = context.styles && context.styles.variables;
    for (var key in vars) {
      if (vars[key]) document.documentElement.style.setProperty(key, vars[key]);
    }
    var fonts = context.styles && context.styles.css && context.styles.css.fonts;
    if (fonts) {
      var style = document.createElement('style');
      style.textContent = fonts;
      document.head.appendChild(style);
    }
  }

  /* —— tabs —— */

  function show(name, focus) {
    tab = name;
    threadId = null;
    document.body.removeAttribute('data-view');
    $('panel-thread').hidden = true;
    $('tabs').hidden = false;
    for (var i = 0; i < TABS.length; i++) {
      var on = TABS[i] === name;
      var t = $('tab-' + TABS[i]);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      $('panel-' + TABS[i]).hidden = !on;
      if (on && focus) t.focus();
    }
    notifySize();
  }

  for (var k = 0; k < TABS.length; k++) {
    (function (name) {
      $('tab-' + name).addEventListener('click', function () { chosen = true; show(name); });
    })(TABS[k]);
  }
  $('tab-projects').parentNode.addEventListener('keydown', function (event) {
    var step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    chosen = true;
    show(TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length], true);
  });

  /* —— projects —— */

  function projectCard(project) {
    var card = el('button', 'mk-card');
    card.type = 'button';
    var top = el('div', 'mk-card__top');
    top.appendChild(el('span', 'mk-card__name', project.name || 'Untitled project'));
    top.appendChild(el('span', 'mk-card__go', project.requests ? 'Requests →' : ''));
    card.appendChild(top);

    var setup = project.setup || { ready: 0, total: 0, next: null };
    if (setup.total) {
      var bar = el('div', 'mk-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(setup.total));
      bar.setAttribute('aria-valuenow', String(setup.ready));
      bar.setAttribute('aria-label', 'Setup');
      if (setup.ready >= setup.total) bar.setAttribute('data-done', 'true');
      var fill = el('span');
      fill.style.width = Math.round((setup.ready / setup.total) * 100) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    var meta = el('div', 'mk-meta');
    if (setup.total) meta.appendChild(el('span', null, 'Setup ' + setup.ready + '/' + setup.total));
    meta.appendChild(el('span', null, project.open ? plural(project.open, 'open request') : project.requests ? 'No open requests' : 'No requests yet'));
    meta.appendChild(el('span', null, plural(project.sites || 0, 'site')));
    card.appendChild(meta);

    if (setup.next) {
      var next = el('div', 'mk-next');
      next.appendChild(el('b', null, 'Next: '));
      next.appendChild(document.createTextNode(setup.next));
      card.appendChild(next);
    }

    card.addEventListener('click', function () {
      projectFilter = project.name || null;
      chosen = true;
      renderRequests();
      show('requests');
    });
    return card;
  }

  function renderProjects() {
    var list = $('projects');
    clear(list);
    var projects = board.projects || [];
    if (!projects.length) {
      list.appendChild(el('div', 'mk-empty', 'No projects yet. Start one in the portal and it shows up here.'));
      return;
    }
    for (var i = 0; i < projects.length; i++) list.appendChild(projectCard(projects[i]));
  }

  /* —— sites —— */

  function siteState(site) {
    if (site.state === 'failed') return { label: 'Failed', tone: 'bad' };
    if (site.state !== 'ready') return { label: 'Setting up', tone: 'wait' };
    if (site.live) return { label: 'Live', tone: 'done' };
    return site.has_preview ? { label: 'Preview only', tone: 'active' } : { label: 'Nothing built yet', tone: '' };
  }

  function siteRow(site) {
    var wrap = el('div', 'mk-row');
    var main = el('div');
    var title = el('div', 'mk-title');
    title.appendChild(el('span', null, site.name || 'Site'));
    main.appendChild(title);

    var meta = el('div', 'mk-meta');
    var state = siteState(site);
    meta.appendChild(pill(state.label, state.tone));
    if (site.project && site.project !== site.name) meta.appendChild(el('span', null, site.project));
    var address = site.live ? site.production_url : site.has_preview ? site.preview_url : null;
    if (address) meta.appendChild(el('span', 'mk-url', hostOf(address)));
    var when = relative(site.updated_at);
    if (when) meta.appendChild(el('span', null, 'updated ' + when));
    main.appendChild(meta);
    wrap.appendChild(main);

    var actions = el('div', 'mk-btns');
    if (site.has_preview && site.preview_url) actions.appendChild(button('Preview ↗', function () { openLink(site.preview_url); }));
    if (site.live && site.production_url) actions.appendChild(button('Live ↗', function () { openLink(site.production_url); }));
    wrap.appendChild(actions);
    return wrap;
  }

  function renderSites() {
    var list = $('sites');
    clear(list);
    var sites = board.sites || [];
    if (!sites.length) {
      list.appendChild(el('div', 'mk-empty', 'No hosted sites yet. When a project gets one, its preview and live links show up here.'));
      return;
    }
    var box = el('div', 'mk-boxed');
    for (var i = 0; i < sites.length; i++) box.appendChild(siteRow(sites[i]));
    list.appendChild(box);
  }

  /* —— requests —— */

  function requestRow(item, showProject) {
    var status = STATUS[item.status] || { label: item.status || 'Unknown', tone: 'active' };
    var wrap = el('div', 'mk-row');
    var main = el('div');
    var title = el('div', 'mk-title');
    if (item.unread) {
      var dot = el('span', 'mk-dot');
      dot.setAttribute('title', 'New reply');
      title.appendChild(dot);
    }
    title.appendChild(el('span', null, '#' + item.id + ' ' + (item.title || 'Untitled request')));
    main.appendChild(title);

    var meta = el('div', 'mk-meta');
    meta.appendChild(pill(status.label, status.tone));
    if (showProject && item.project) meta.appendChild(el('span', null, item.project));
    if (item.site && item.site !== item.project) meta.appendChild(el('span', null, item.site));
    var cost = money(item.price_cents);
    if (cost) meta.appendChild(el('span', null, cost));
    var when = relative(item.updated_at);
    if (when) meta.appendChild(el('span', null, 'updated ' + when));
    main.appendChild(meta);
    wrap.appendChild(main);

    wrap.appendChild(button('Open', function () { openThread(item.id); }));
    return wrap;
  }

  function renderRequests() {
    var list = $('requests');
    clear(list);
    var all = board.requests || [];
    var requests = projectFilter
      ? all.filter(function (r) { return (r.project || 'Other work') === projectFilter; })
      : all;
    $('filter').hidden = !projectFilter;
    $('filter-name').textContent = projectFilter || '';

    if (!requests.length) {
      list.appendChild(el('div', 'mk-empty', projectFilter
        ? 'No requests on this project yet.'
        : 'No requests yet. Describe the work you need and it lands here.'));
      return;
    }
    var order = (board.projects || []).map(function (p) { return p.name; });
    var groups = new Map();
    for (var i = 0; i < requests.length; i++) {
      var key = requests[i].project || 'Other work';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(requests[i]);
    }
    // Projects as the board lists them, then anything else; most recent first
    // inside each group (the payload already arrives in that order).
    var keys = Array.from(groups.keys()).sort(function (a, b) {
      var ia = order.indexOf(a);
      var ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    for (var g = 0; g < keys.length; g++) {
      var items = groups.get(keys[g]);
      var section = el('section', 'mk-group');
      var head = el('div', 'mk-group__head');
      head.appendChild(el('span', 'mk-group__name', keys[g]));
      var open = items.filter(function (r) { return r.status !== 'done' && r.status !== 'declined'; }).length;
      head.appendChild(el('span', 'mk-group__meta', open === items.length ? items.length + ' open' : open + ' of ' + items.length + ' open'));
      section.appendChild(head);
      for (var j = 0; j < items.length; j++) section.appendChild(requestRow(items[j], keys[g] === 'Other work'));
      list.appendChild(section);
    }
  }

  $('filter-clear').addEventListener('click', function () {
    projectFilter = null;
    renderRequests();
    notifySize();
  });

  /* —— one request as a conversation —— */

  var WHO = { ali: { name: 'Ali', mark: 'A' }, runner: { name: 'Agent', mark: '⚙' } };
  var NL = String.fromCharCode(10);
  var replyEl = $('reply');
  var sendEl = $('send');

  function at(value) {
    return typeof value === 'number' ? relative(new Date(value * 1000).toISOString()) : relative(value);
  }

  function requestById(id) {
    return ((board && board.requests) || []).filter(function (r) { return r.id === id; })[0] || null;
  }

  /* Plain text with its line breaks, and web addresses that open through the host. */
  function linkify(node, text) {
    var lines = String(text || '').split(NL);
    for (var i = 0; i < lines.length; i++) {
      if (i) node.appendChild(document.createTextNode(NL));
      var words = lines[i].split(' ');
      for (var j = 0; j < words.length; j++) {
        if (j) node.appendChild(document.createTextNode(' '));
        var word = words[j];
        if (/^https?:[/][/]/.test(word)) {
          var url = word.replace(/[).,;:!?]+$/, '');
          (function (href) {
            var link = el('button', 'mk-inline-link', href);
            link.type = 'button';
            link.addEventListener('click', function () { openLink(href); });
            node.appendChild(link);
          })(url);
          if (url.length < word.length) node.appendChild(document.createTextNode(word.slice(url.length)));
        } else {
          node.appendChild(document.createTextNode(word));
        }
      }
    }
  }

  /* Status lines are stored in English as "Status changed to “In review”. Total: $6.40." */
  function systemText(body) {
    var moved = /^Status changed to “([^”]+)”[.]?(?: Total: (.+?)[.]?)?$/.exec(String(body || ''));
    if (!moved) return body;
    return 'Moved to ' + moved[1] + (moved[2] ? ' · total ' + moved[2] : '');
  }

  function attachments(list) {
    var wrap = el('div', 'mk-files');
    for (var i = 0; i < list.length; i++) wrap.appendChild(el('span', 'mk-file', '📎 ' + (list[i].name || 'file')));
    return wrap;
  }

  function text(body) {
    var node = el('div', 'mk-text');
    linkify(node, body);
    return node;
  }

  /* The client on the right in a bubble, Ali and the agent on the left, status lines centred. */
  function turn(m, sending) {
    var when = at(m.created_at);
    if (m.author === 'system') {
      var line = el('div', 'mk-sys');
      linkify(line, systemText(m.body));
      if (when) line.appendChild(document.createTextNode(' · ' + when));
      return line;
    }
    if (m.author === 'client') {
      var mine = el('div', 'mk-turn--client' + (sending ? ' mk-sending' : ''));
      mine.appendChild(text(m.body));
      if (m.files && m.files.length) mine.appendChild(attachments(m.files));
      var stamp = sending ? 'Sending…' : when;
      if (stamp) mine.appendChild(el('span', 'mk-when', stamp));
      return mine;
    }
    var who = WHO[m.author] || { name: m.author || 'malipetek', mark: '•' };
    var row = el('div', 'mk-turn--other');
    // Ali's photo is the background of his avatar (CSS); the others show a mark.
    var avatar = el('span', 'mk-avatar', m.author === 'ali' ? '' : who.mark);
    avatar.setAttribute('data-who', m.author || '');
    avatar.setAttribute('aria-hidden', 'true');
    row.appendChild(avatar);
    var main = el('div');
    var head = el('div', 'mk-who-line', who.name);
    if (when) head.appendChild(el('span', 'mk-when', when));
    main.appendChild(head);
    main.appendChild(text(m.body));
    if (m.files && m.files.length) main.appendChild(attachments(m.files));
    row.appendChild(main);
    return row;
  }

  function threadHead(id, title, status) {
    $('thread-title').textContent = '#' + id + ' ' + (title || 'Untitled request');
    var holder = $('thread-status');
    clear(holder);
    if (status) {
      var known = STATUS[status] || { label: status, tone: 'active' };
      holder.appendChild(pill(known.label, known.tone));
    }
  }

  function openThread(id) {
    threadId = id;
    document.body.setAttribute('data-view', 'thread');
    $('tabs').hidden = true;
    for (var i = 0; i < TABS.length; i++) $('panel-' + TABS[i]).hidden = true;
    $('panel-thread').hidden = false;
    var known = requestById(id);
    threadHead(id, known && known.title, known && known.status);
    var chat = $('chat');
    clear(chat);
    chat.appendChild(el('div', 'mk-skel'));
    chat.appendChild(el('div', 'mk-skel'));
    notifySize();
    loadThread(id);
  }

  function closeThread() {
    show(tab);
  }

  function threadError(message) {
    var chat = $('chat');
    clear(chat);
    chat.appendChild(el('div', 'mk-err', message || 'This conversation could not load.'));
    notifySize();
  }

  function renderThread(data) {
    var ticket = data.ticket;
    threadHead(ticket.id, ticket.title, ticket.status);
    var known = requestById(ticket.id);
    // Reading it in the portal marks it seen; so does reading it here.
    if (known && known.unread) { known.unread = false; renderRequests(); }
    var chat = $('chat');
    clear(chat);
    var messages = data.messages || [];
    if (!messages.length) chat.appendChild(el('div', 'mk-empty', 'No messages yet.'));
    for (var i = 0; i < messages.length; i++) chat.appendChild(turn(messages[i]));
    chat.scrollTop = chat.scrollHeight;
    notifySize();
  }

  function loadThread(id) {
    refreshEl.disabled = true;
    return request('tools/call', { name: 'portal_request', arguments: { request_id: id } })
      .then(function (result) {
        if (threadId !== id) return;
        if (!result || result.isError) { threadError(textOf(result)); return; }
        var data = result.structuredContent;
        if (!data) { try { data = JSON.parse(textOf(result)); } catch (e) { data = null; } }
        if (!data || !data.ticket) { threadError(); return; }
        renderThread(data);
      })
      .catch(function (error) { if (threadId === id) threadError(error && error.message); })
      .then(function () { refreshEl.disabled = false; });
  }

  function fit() {
    replyEl.style.height = 'auto';
    replyEl.style.height = Math.min(replyEl.scrollHeight, 160) + 'px';
  }

  function submitReply() {
    var body = replyEl.value.trim();
    var id = threadId;
    if (!body || !id || sendEl.disabled) return;
    replyEl.value = '';
    fit();
    sendEl.disabled = true;
    var chat = $('chat');
    var empty = chat.querySelector('.mk-empty');
    if (empty) chat.removeChild(empty);
    var sending = turn({ author: 'client', body: body }, true);
    chat.appendChild(sending);
    chat.scrollTop = chat.scrollHeight;
    notifySize();
    request('tools/call', { name: 'portal_reply', arguments: { request_id: id, text: body } })
      .then(function (result) {
        if (!result || result.isError) throw new Error(textOf(result) || 'Your reply was not sent.');
        return loadThread(id);
      })
      .catch(function (error) {
        if (sending.parentNode) sending.parentNode.removeChild(sending);
        if (threadId !== id) return;
        replyEl.value = body;
        fit();
        sendEl.disabled = false;
        chat.appendChild(el('div', 'mk-err', (error && error.message) || 'Your reply was not sent.'));
        notifySize();
      });
  }

  replyEl.addEventListener('input', function () { sendEl.disabled = !replyEl.value.trim(); fit(); });
  replyEl.addEventListener('keydown', function (event) {
    // Enter sends and Shift+Enter starts a new line, as in the chat around it.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submitReply();
    }
  });
  $('composer').addEventListener('submit', function (event) { event.preventDefault(); submitReply(); });
  $('back').addEventListener('click', closeThread);
  $('thread-portal').addEventListener('click', function () { if (threadId) openLink(PORTAL + '/#/ticket/' + threadId); });

  /* —— the whole board —— */

  function render(data) {
    board = {
      account: data.account || {},
      projects: data.projects || [],
      sites: data.sites || [],
      requests: data.requests || []
    };
    rendered = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    $('who').textContent = board.account.name ? '· ' + board.account.name : '';
    $('n-projects').textContent = board.projects.length;
    $('n-sites').textContent = board.sites.length;
    var openCount = board.requests.filter(function (r) { return r.status !== 'done' && r.status !== 'declined'; }).length;
    $('n-requests').textContent = openCount ? openCount + ' open' : board.requests.length;
    renderProjects();
    renderSites();
    renderRequests();
    if (data.focus && !focusDone && requestById(data.focus)) {
      // Opened on one request (portal_board with request_id): straight to its conversation.
      focusDone = true;
      openThread(data.focus);
      return;
    }
    // Something new to read beats the overview, until the person picks a tab.
    if (threadId) notifySize();
    else if (!chosen) show(board.requests.some(function (r) { return r.unread; }) ? 'requests' : 'projects');
    else notifySize();
  }

  function showError(message) {
    rendered = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    var list = $('projects');
    clear(list);
    list.appendChild(el('div', 'mk-err', message || 'Your work could not load.'));
    show('projects');
  }

  function handleResult(result) {
    if (!result) return;
    if (result.isError) { showError(textOf(result)); return; }
    var data = result.structuredContent;
    if (!data) { try { data = JSON.parse(textOf(result)); } catch (e) { data = null; } }
    if (data && data.projects && data.requests) { render(data); return; }
    showError('Your work could not load.');
  }

  function load() {
    refreshEl.disabled = true;
    return request('tools/call', { name: 'portal_board', arguments: {} })
      .then(function (result) { handleResult(result); })
      .catch(function (error) { if (!rendered) showError(error && error.message); })
      .then(function () { refreshEl.disabled = false; });
  }

  function notifySize() {
    var rect = document.body.getBoundingClientRect();
    notify('ui/notifications/size-changed', { width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
  }

  refreshEl.addEventListener('click', function () {
    if (refreshEl.disabled) return;
    if (threadId) loadThread(threadId);
    else load();
  });
  $('portal').addEventListener('click', function () { openLink(PORTAL); });

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;

    if (message.id !== undefined && pending[message.id]) {
      var waiting = pending[message.id];
      delete pending[message.id];
      if (message.error) waiting.reject(new Error(message.error.message || 'Host error'));
      else waiting.resolve(message.result);
      return;
    }

    if (message.method === 'ui/notifications/tool-result') {
      handleResult(message.params);
      return;
    }
    if (message.method === 'ui/notifications/tool-cancelled') {
      if (!rendered) showError('Loading was cancelled.');
      return;
    }
    if (message.method === 'ui/resource-teardown') {
      if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    }
    if (message.method === 'ui/notifications/host-context-changed') {
      applyContext(message.params);
      return;
    }
  }, { passive: true });

  if (typeof ResizeObserver === 'function') {
    var last = 0;
    new ResizeObserver(function () {
      var height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      notifySize();
    }).observe(document.body);
  }

  function armFallback() {
    /* Some hosts render the view without a result (a sidebar open, a
       prefetch). Pull the data through the bridge instead of sitting empty. */
    fallbackTimer = setTimeout(function () {
      if (!rendered) load();
    }, 1200);
  }

  request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    clientInfo: { name: 'malipetek-development', version: '3.0.0' }
  }).then(function (result) {
    applyContext((result && result.hostContext) || {});
    notify('ui/notifications/initialized');
    armFallback();
  }).catch(function () {
    notify('ui/notifications/initialized');
    armFallback();
  });
}());
</script>
</body>
</html>`;
