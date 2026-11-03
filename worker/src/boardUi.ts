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
import { BOARD3D_JS } from './board3dBundle.ts';

export const BOARD_UI_URI = 'ui://malipetek/board-v9.html';

export const BOARD_MIME = 'text/html;profile=mcp-app';

export const BOARD_PORTAL = 'https://malipetek.dev/portal';

export interface BoardRequest {
  id: number;
  title: string | null;
  status: string | null;
  project: string | null;
  project_id: string | null;
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
  project_id: string | null;
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
  spending?: { billed_cents: number; open_cents: number; ai_cents: number };
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
    /* Chart marks: brand orange, one step deeper on dark (validated for each surface); grey for context. */
    --mk-data: light-dark(#ff5a1f, #f2531a);
    --mk-quiet: #8a857b;
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
    padding: 12px 14px;
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
  /* The host's composer floats over the bottom of the card. A real empty card
     at the end of the scroll is the space it sits over, so the last section is
     never hidden behind it. */
  .mk-tail {
    height: 180px;
    margin-top: 14px;
    border: 1px dashed color-mix(in srgb, var(--mk-rule) 75%, transparent);
    border-radius: var(--mk-radius);
    background: color-mix(in srgb, var(--mk-ink) 2%, transparent);
  }
  body[data-mode="fullscreen"] .mk-tail {
    height: 240px;
  }
  body[data-view="thread"] .mk-tail {
    display: none;
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
  /* —— the workshop: the portal's 3D board, with HTML labels riding the scene —— */
  .mk-tab[hidden] { display: none; }
  .mk-stage {
    position: relative; height: 300px; overflow: hidden;
    border: 1px solid var(--mk-rule); border-radius: var(--mk-radius);
    background: radial-gradient(120% 90% at 60% 40%, var(--mk-paper) 40%, var(--mk-tint) 100%);
  }
  body[data-mode="fullscreen"] .mk-stage { height: calc(100vh - 230px); }
  .mk-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .mk-labels { position: absolute; inset: 0; pointer-events: none; }
  .mk-node, .mk-cap, .mk-tip3d { position: absolute; top: 0; left: 0; will-change: transform, opacity; white-space: nowrap; }
  .mk-node {
    display: inline-flex; align-items: center; gap: 6px; max-width: 210px;
    padding: 4px 8px 4px 6px; border: 1px solid var(--mk-rule); border-radius: 8px;
    background: color-mix(in srgb, var(--mk-paper) 92%, transparent); backdrop-filter: blur(5px);
    color: var(--mk-ink); font: 500 11px/1 var(--mk-mono); cursor: pointer; pointer-events: auto; opacity: 0;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--mk-ink) 8%, transparent); transition: opacity .18s, background .12s;
  }
  .mk-node--project { border-left: 3px solid var(--mk-orange); }
  .mk-node--project.is-on { background: var(--mk-ink); border-color: var(--mk-ink); color: var(--mk-paper); }
  .mk-node__idx { font-weight: 700; font-size: 10px; }
  .mk-node__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .mk-node__count { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; color: #fff; font: 700 10px/1 var(--mk-sans); }
  .mk-node--site { padding: 3px 6px; border-radius: 6px; font-size: 10px; color: var(--mk-soft); }
  .mk-node--site.is-live { color: var(--mk-ink); }
  .mk-node--site.is-ghost { border-style: dashed; cursor: default; }
  .mk-node__dot { width: 7px; height: 7px; border-radius: 50%; background: color-mix(in srgb, var(--mk-ink) 25%, transparent); }
  .mk-node__dot.is-preview { background: var(--mk-orange); }
  .mk-node__dot.is-live { background: #95bf47; }
  .mk-node__state { font-size: 9px; letter-spacing: .05em; text-transform: uppercase; opacity: .6; }
  .mk-cap {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px 4px 4px; border-radius: 20px;
    border: 1px solid var(--mk-rule); background: color-mix(in srgb, var(--mk-paper) 88%, transparent); backdrop-filter: blur(4px);
    color: var(--mk-ink); font: 500 10.5px/1 var(--mk-mono); cursor: pointer; pointer-events: auto;
  }
  .mk-cap b { display: inline-grid; place-items: center; min-width: 18px; height: 18px; border-radius: 9px; background: var(--mk-orange); color: #fff; font: 700 10px/1 var(--mk-sans); }
  .mk-cap.is-empty { opacity: .55; }
  .mk-cap.is-empty b { background: color-mix(in srgb, var(--mk-ink) 25%, transparent); }
  .mk-cap.is-on { background: var(--mk-ink); color: var(--mk-paper); border-color: var(--mk-ink); }
  .mk-tip3d {
    padding: 6px 9px; border-radius: 8px; background: var(--mk-ink); color: var(--mk-paper);
    font: 500 12px/1.3 var(--mk-sans); max-width: 260px; overflow: hidden; text-overflow: ellipsis; opacity: 0; transition: opacity .12s;
  }
  .mk-tip3d span { font-family: var(--mk-mono); opacity: .7; margin-right: 4px; }
  .mk-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .mk-legend button {
    display: inline-flex; align-items: center; gap: 7px; padding: 6px 10px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--mk-rule); background: transparent; color: var(--mk-ink); font: 500 11.5px/1 var(--mk-sans);
  }
  .mk-legend button[aria-pressed="true"] { background: var(--mk-ink); color: var(--mk-paper); border-color: var(--mk-ink); }
  .mk-legend__no { font: 600 10px/1 var(--mk-mono); color: var(--mk-soft); }
  .mk-legend button[aria-pressed="true"] .mk-legend__no { color: inherit; opacity: .7; }
  .mk-legend b { font: 700 11px/1 var(--mk-mono); }
  .mk-node--yard { gap: 5px; }
  /* —— the overview: headline numbers, two small charts —— */
  .mk-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0 10px; }
  .mk-kpi { border: 1px solid var(--mk-rule); border-radius: var(--mk-radius); padding: 10px 12px; min-width: 0; }
  .mk-kpi__label { font-size: 11.5px; color: var(--mk-soft); }
  .mk-kpi__value { font: 600 21px/1.2 var(--mk-sans); letter-spacing: -.01em; margin-top: 4px; }
  .mk-kpi__sub { font-size: 11px; color: var(--mk-soft); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .mk-chart { margin: 0; border: 1px solid var(--mk-rule); border-radius: var(--mk-radius); padding: 12px 12px 10px; min-width: 0; position: relative; }
  .mk-chart__title { font: 600 12.5px/1.2 var(--mk-sans); }
  .mk-chart__sub { font-size: 11px; color: var(--mk-soft); margin-top: 3px; }
  .mk-chart__empty { font-size: 12px; color: var(--mk-soft); padding: 26px 0 18px; text-align: center; }
  .mk-cols { display: flex; align-items: flex-end; gap: 6px; height: 118px; margin-top: 12px; border-bottom: 1px solid var(--mk-rule); }
  .mk-col { flex: 1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; outline: none; }
  .mk-col__val { font: 500 10.5px/1 var(--mk-sans); color: var(--mk-soft); margin-bottom: 4px; white-space: nowrap; }
  .mk-col__bar { width: min(24px, 70%); background: var(--mk-quiet); border-radius: 4px 4px 0 0; }
  .mk-col.is-now .mk-col__bar { background: var(--mk-data); }
  .mk-col:hover .mk-col__bar, .mk-col:focus-visible .mk-col__bar { filter: brightness(1.08); }
  .mk-col:focus-visible .mk-col__bar { outline: 2px solid var(--mk-ink); outline-offset: 2px; }
  .mk-xs { display: flex; gap: 6px; margin-top: 5px; }
  .mk-xs span { flex: 1; text-align: center; font: 500 10.5px/1 var(--mk-sans); color: var(--mk-soft); }
  .mk-hbars { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .mk-hbar { display: grid; grid-template-columns: minmax(0, 40%) minmax(0, 1fr); align-items: center; gap: 8px; outline: none; }
  .mk-hbar__name { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
  .mk-hbar__name span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-hbar__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .mk-hbar__track { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .mk-hbar__bar { height: 12px; min-width: 2px; background: var(--mk-data); border-radius: 0 4px 4px 0; }
  .mk-hbar:focus-visible .mk-hbar__bar { outline: 2px solid var(--mk-ink); outline-offset: 2px; }
  .mk-hbar__val { font: 500 11px/1 var(--mk-sans); color: var(--mk-soft); white-space: nowrap; }
  .mk-h { font: 600 13px/1.2 var(--mk-sans); margin: 18px 0 8px; }
  .mk-tooltip {
    position: fixed; top: 0; left: 0; z-index: 20; pointer-events: none; opacity: 0;
    padding: 6px 8px; border-radius: 6px; background: var(--mk-ink); color: var(--mk-paper);
    font: 500 12px/1.35 var(--mk-sans); white-space: nowrap; transition: opacity .1s;
  }
  .mk-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 560px) {
    .mk-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .mk-charts { grid-template-columns: minmax(0, 1fr); }
  }

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
  <button class="mk-tab" role="tab" id="tab-overview" data-tab="overview" aria-controls="panel-overview" aria-selected="true" type="button">Overview</button>
  <button class="mk-tab" role="tab" id="tab-projects" data-tab="projects" aria-controls="panel-projects" aria-selected="false" tabindex="-1" type="button">Projects <span class="mk-tab__n" id="n-projects">–</span></button>
  <button class="mk-tab" role="tab" id="tab-sites" data-tab="sites" aria-controls="panel-sites" aria-selected="false" tabindex="-1" type="button">Sites <span class="mk-tab__n" id="n-sites">–</span></button>
  <button class="mk-tab" role="tab" id="tab-requests" data-tab="requests" aria-controls="panel-requests" aria-selected="false" tabindex="-1" type="button">Requests <span class="mk-tab__n" id="n-requests">–</span></button>
</div>

<section class="mk-panel" role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" aria-live="polite">
  <div id="workshop">
    <div class="mk-stage" id="stage">
      <canvas id="scene" aria-hidden="true"></canvas>
      <div class="mk-labels" id="labels"></div>
    </div>
    <div class="mk-legend" id="legend" role="group" aria-label="Stations"></div>
  </div>
  <div class="mk-kpis" id="kpis"></div>
  <div class="mk-charts">
    <figure class="mk-chart" id="chart-months"></figure>
    <figure class="mk-chart" id="chart-projects"></figure>
  </div>
  <h2 class="mk-h">Projects</h2>
  <div class="mk-list" id="overview-projects"><div class="mk-skel"></div><div class="mk-skel"></div></div>
</section>
<section class="mk-panel" role="tabpanel" id="panel-projects" aria-labelledby="tab-projects" hidden>
  <div class="mk-list" id="projects"></div>
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

<div class="mk-tooltip" id="tooltip" role="tooltip"></div>
<div class="mk-foot">
  <span>Every request is read by a human before work starts.</span>
  <button class="mk-link" id="portal" type="button">Open the portal ↗</button>
</div>
<div class="mk-tail" aria-hidden="true"></div>
</main>

<script>${BOARD3D_JS}</script>
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
  var TABS = ['overview', 'projects', 'sites', 'requests'];

  var host = window.parent;
  var nextId = 1;
  var pending = {};
  var rendered = false;
  var fallbackTimer = null;
  var board = null;
  var tab = 'overview';
  var chosen = false;
  var projectFilter = null;
  var threadId = null;
  var focusDone = false;

  function $(id) { return document.getElementById(id); }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.setAttribute('data-theme', 'dark');
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
    // The 3D scene follows data-theme, as it does on the site.
    if (context.theme) document.documentElement.setAttribute('data-theme', context.theme);
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
    if (name === 'overview' && scene3d) scene3d.focus(null);
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
  $('tabs').addEventListener('keydown', function (event) {
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

  /* The same cards in two places: the Projects tab, and under the overview's charts. */
  function renderProjects() {
    ['projects', 'overview-projects'].forEach(function (id) {
      var list = $(id);
      clear(list);
      var projects = board.projects || [];
      if (!projects.length) {
        list.appendChild(el('div', 'mk-empty', 'No projects yet. Start one in the portal and it shows up here.'));
        return;
      }
      for (var i = 0; i < projects.length; i++) list.appendChild(projectCard(projects[i]));
    });
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

  /* —— the overview: the portal's 3D workshop, headline numbers, two charts —— */

  var STAGE_KEYS = ['new', 'approved', 'in_progress', 'review', 'done'];
  var STAGE_NAMES = { new: 'Waiting for Ali', approved: 'Approved', in_progress: 'Being built', review: 'Being checked', done: 'Shipped' };
  // On the scene the captions are crowded at card width: the station's own short name; the legend says it in full.
  var STAGE_SHORT = { new: 'Request', approved: 'Approve', in_progress: 'Build', review: 'Check', done: 'Ship' };
  // Projects get a tint, so a belt, its pylon and its label read as one thing (the portal's colours).
  var LANE_TINTS = [0xff5a1f, 0x95bf47, 0x3b82f6, 0xa855f7, 0xeab308, 0xec4899];
  var GREY_TINT = 0x8a857b;
  var RECENT_MS = 14 * 86400 * 1000;
  var scene3d = null;
  var sceneOff = false;
  var sceneItems = [];
  var sceneLanes = [];
  var sceneStage = null;
  var sceneProject = null;
  var capEls = {};
  var nodeEls = new Map();
  var tipEl = null;
  var tooltipEl = $('tooltip');

  function tintHex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isOpen(r) { return r.status === 'new' || r.status === 'approved' || r.status === 'in_progress' || r.status === 'review'; }

  function dollars(cents) {
    var value = (cents || 0) / 100;
    return '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* What rides the machine: everything open, plus the few most recently shipped (as the portal does). */
  function workshopFeed() {
    var now = Date.now();
    var all = board.requests || [];
    var shipped = all.filter(function (r) {
      return r.status === 'done' && r.updated_at && now - Date.parse(r.updated_at) < RECENT_MS;
    }).slice(0, 3);
    sceneItems = all.filter(isOpen).concat(shipped);
    sceneLanes = (board.projects || []).map(function (p, i) {
      var color = LANE_TINTS[i % LANE_TINTS.length];
      return {
        id: p.id, name: p.name || 'Project', lane: i, color: color, tint: tintHex(color),
        sites: (board.sites || []).filter(function (s) { return s.project_id === p.id; }).map(function (s) {
          return { id: s.id, name: s.name || 'Site', live: !!s.live, url: s.live ? s.production_url : s.has_preview ? s.preview_url : null };
        })
      };
    });
    if (!sceneLanes.length || sceneItems.some(function (r) { return !r.project_id; })) {
      sceneLanes.push({ id: -1, name: 'Getting set up', lane: sceneLanes.length, color: GREY_TINT, tint: tintHex(GREY_TINT), sites: [], unassigned: true });
    }
  }

  function laneIndex(projectId) {
    for (var i = 0; i < sceneLanes.length; i++) {
      var lane = sceneLanes[i];
      if (projectId ? (!lane.unassigned && lane.id === projectId) : lane.unassigned) return i;
    }
    return 0;
  }

  function inLane(lane) {
    return sceneItems.filter(function (r) { return lane.unassigned ? !r.project_id : r.project_id === lane.id; }).length;
  }

  function stageCount(key) { return sceneItems.filter(function (r) { return r.status === key; }).length; }

  function pickLane(id) {
    sceneProject = sceneProject === id ? null : id;
    if (scene3d) scene3d.lane(sceneProject);
    buildLabels();
  }

  function zoomStage(key) {
    sceneStage = sceneStage === key ? null : key;
    if (scene3d) scene3d.zoom(sceneStage);
    buildLegend();
    for (var k in capEls) capEls[k].classList.toggle('is-on', k === sceneStage);
  }

  function openSite(site) { if (site && site.url) openLink(site.url); }

  function nodeEl(key, className, title, onClick) {
    var node = el('button', 'mk-node ' + className);
    node.type = 'button';
    node.title = title;
    node.tabIndex = -1;
    node.addEventListener('click', onClick);
    nodeEls.set(key, node);
    return node;
  }

  /* HTML labels that ride the scene: one per project pylon, its yard or its sites, and each station. */
  function buildLabels() {
    var layer = $('labels');
    clear(layer);
    nodeEls = new Map();
    capEls = {};
    sceneLanes.forEach(function (lane) {
      var project = nodeEl('p:' + lane.id, 'mk-node--project' + (sceneProject === lane.id ? ' is-on' : ''), 'Show only ' + lane.name, function () { pickLane(lane.id); });
      project.style.borderLeftColor = lane.tint;
      var idx = el('span', 'mk-node__idx', lane.unassigned ? '—' : pad2(lane.lane + 1));
      idx.style.color = lane.tint;
      project.appendChild(idx);
      project.appendChild(el('span', 'mk-node__name', lane.name));
      var count = el('span', 'mk-node__count', inLane(lane));
      count.style.background = lane.tint;
      project.appendChild(count);
      layer.appendChild(project);
      if (lane.unassigned) return;
      if (sceneProject === null) {
        // All projects: one yard label each.
        var yard = nodeEl('y:' + lane.id, 'mk-node--site mk-node--yard', 'Show only ' + lane.name, function () { pickLane(lane.id); });
        var dot = el('span', 'mk-node__dot');
        dot.style.background = lane.tint;
        yard.appendChild(dot);
        yard.appendChild(el('span', 'mk-node__name', lane.name));
        yard.appendChild(el('span', 'mk-node__state', plural(lane.sites.length, 'site')));
        layer.appendChild(yard);
      } else if (sceneProject === lane.id) {
        // One project picked: its sites.
        if (!lane.sites.length) {
          var ghost = nodeEl('s:' + lane.id + ':0', 'mk-node--site is-ghost', 'No site yet', function () {});
          ghost.appendChild(el('span', 'mk-node__dot'));
          ghost.appendChild(el('span', 'mk-node__name', 'No site yet'));
          layer.appendChild(ghost);
        }
        lane.sites.forEach(function (site) {
          var pod = nodeEl('s:' + lane.id + ':' + site.id, 'mk-node--site' + (site.live ? ' is-live' : ''), site.url ? 'Open ' + site.name : site.name, function () { openSite(site); });
          pod.appendChild(el('span', 'mk-node__dot' + (site.live ? ' is-live' : ' is-preview')));
          pod.appendChild(el('span', 'mk-node__name', site.name));
          pod.appendChild(el('span', 'mk-node__state', site.live ? 'Live' : 'Preview'));
          layer.appendChild(pod);
        });
      }
    });
    STAGE_KEYS.forEach(function (key) {
      var cap = el('button', 'mk-cap' + (stageCount(key) ? '' : ' is-empty') + (sceneStage === key ? ' is-on' : ''));
      cap.type = 'button';
      cap.tabIndex = -1;
      cap.appendChild(el('b', null, stageCount(key)));
      cap.appendChild(document.createTextNode(STAGE_SHORT[key]));
      cap.title = STAGE_NAMES[key];
      cap.addEventListener('click', function () { zoomStage(key); });
      capEls[key] = cap;
      layer.appendChild(cap);
    });
    tipEl = el('div', 'mk-tip3d');
    layer.appendChild(tipEl);
  }

  /* The stations as buttons too: the keyboard way into the scene, and its counts. */
  function buildLegend() {
    var legend = $('legend');
    clear(legend);
    STAGE_KEYS.forEach(function (key, i) {
      var b = el('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', sceneStage === key ? 'true' : 'false');
      b.appendChild(el('span', 'mk-legend__no', pad2(i + 1)));
      b.appendChild(el('span', null, STAGE_NAMES[key]));
      b.appendChild(el('b', null, stageCount(key)));
      b.addEventListener('click', function () { zoomStage(key); });
      legend.appendChild(b);
    });
  }

  function place(node, x, y, lift) {
    node.style.transform = 'translate(' + x + 'px, ' + y + 'px) translate(-50%, ' + (lift ? 'calc(-100% - 10px)' : '-100%') + ')';
  }

  function mountScene() {
    if (scene3d || sceneOff) return;
    if (typeof window.mkInitBoard !== 'function') { dropScene(); return; }
    try {
      scene3d = window.mkInitBoard($('scene'), {
        items: function () {
          return sceneItems.map(function (r) { return { id: r.id, stage: r.status, lane: laneIndex(r.project_id) }; });
        },
        lanes: function () { return sceneLanes; },
        onHover: function (id) {
          var r = id === null || id === undefined ? null : requestById(id);
          clear(tipEl);
          if (r) {
            tipEl.appendChild(el('span', null, '#' + r.id));
            tipEl.appendChild(document.createTextNode(r.title || 'Untitled request'));
          }
        },
        onPick: function (id) {
          // Go in toward the ticket, then open its conversation.
          scene3d.focus(id);
          setTimeout(function () { openThread(id); }, 380);
        },
        onPickNode: function (node) {
          if (node.kind === 'project') { pickLane(node.projectId); return; }
          var lane = sceneLanes[laneIndex(node.projectId)];
          openSite(lane && lane.sites.filter(function (s) { return s.id === node.siteId; })[0]);
        },
        onFrame: function (stations, hover, nodes) {
          for (var key in stations) if (capEls[key]) place(capEls[key], stations[key].x, stations[key].y);
          if (tipEl) {
            tipEl.style.opacity = hover ? '1' : '0';
            if (hover) place(tipEl, hover.x, hover.y, true);
          }
          var seen = {};
          for (var i = 0; i < (nodes || []).length; i++) {
            var n = nodes[i];
            var label = nodeEls.get(n.key);
            if (!label) continue;
            seen[n.key] = true;
            place(label, n.x, n.y);
            label.style.opacity = n.visible === false ? '0' : '1';
          }
          nodeEls.forEach(function (label, k) { if (!seen[k]) label.style.opacity = '0'; });
        }
      });
      if (sceneProject !== null) scene3d.lane(sceneProject);
      if (sceneStage !== null) scene3d.zoom(sceneStage);
    } catch (e) {
      dropScene();
    }
  }

  /* No WebGL here: the numbers, charts and lists carry the overview on their own. */
  function dropScene() {
    sceneOff = true;
    scene3d = null;
    $('workshop').hidden = true;
  }

  function kpi(label, value, sub) {
    var tile = el('div', 'mk-kpi');
    tile.appendChild(el('div', 'mk-kpi__label', label));
    tile.appendChild(el('div', 'mk-kpi__value', value));
    if (sub) tile.appendChild(el('div', 'mk-kpi__sub', sub));
    return tile;
  }

  function renderKpis() {
    var box = $('kpis');
    clear(box);
    var spend = board.spending;
    var open = board.requests.filter(isOpen);
    var waiting = open.filter(function (r) { return r.status === 'new'; }).length;
    var live = board.sites.filter(function (s) { return s.live; }).length;
    var previews = board.sites.filter(function (s) { return !s.live && s.has_preview; }).length;
    box.appendChild(kpi('Spent so far', dollars(spend.billed_cents), spend.ai_cents ? 'AI at cost: ' + dollars(spend.ai_cents) : 'Finished work, billed'));
    box.appendChild(kpi('Running on open work', dollars(spend.open_cents), plural(open.length, 'open request')));
    box.appendChild(kpi('Open requests', String(open.length), waiting ? waiting + ' waiting for Ali' : 'None waiting for Ali'));
    box.appendChild(kpi('Live sites', board.sites.length ? live + ' of ' + board.sites.length : '0', previews ? plural(previews, 'preview') + ' not live yet' : board.sites.length ? 'All published' : 'No hosted site yet'));
  }

  /* A hover and focus tooltip for one mark; the table under each chart says the same for screen readers. */
  function tooltip(node, text) {
    node.tabIndex = 0;
    node.setAttribute('aria-label', text);
    function showTip() {
      tooltipEl.textContent = text;
      var r = node.getBoundingClientRect();
      var w = tooltipEl.offsetWidth;
      var x = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2));
      tooltipEl.style.transform = 'translate(' + x + 'px, ' + Math.max(4, r.top - tooltipEl.offsetHeight - 6) + 'px)';
      tooltipEl.style.opacity = '1';
    }
    function hideTip() { tooltipEl.style.opacity = '0'; }
    node.addEventListener('mouseenter', showTip);
    node.addEventListener('focus', showTip);
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('blur', hideTip);
  }

  function chartHead(fig, title, sub) {
    clear(fig);
    var cap = el('figcaption');
    cap.appendChild(el('div', 'mk-chart__title', title));
    if (sub) cap.appendChild(el('div', 'mk-chart__sub', sub));
    fig.appendChild(cap);
  }

  function srTable(fig, head, rows) {
    var table = el('table', 'mk-sr');
    var tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    table.appendChild(tr);
    rows.forEach(function (row) {
      var r = el('tr');
      row.forEach(function (c) { r.appendChild(el('td', null, c)); });
      table.appendChild(r);
    });
    fig.appendChild(table);
  }

  /* Billed per month: finished requests by the month they finished, last six months, this month in orange. */
  function renderMonths() {
    var fig = $('chart-months');
    chartHead(fig, 'Billed per month', 'Finished requests, last 6 months');
    var now = new Date();
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth(), cents: 0, n: 0, label: d.toLocaleString(undefined, { month: 'short' }), long: d.toLocaleString(undefined, { month: 'long', year: 'numeric' }) });
    }
    board.requests.forEach(function (r) {
      if (r.status !== 'done' || !r.price_cents || !r.updated_at) return;
      var d = new Date(r.updated_at);
      months.forEach(function (b) { if (b.y === d.getFullYear() && b.m === d.getMonth()) { b.cents += r.price_cents; b.n += 1; } });
    });
    var max = Math.max.apply(null, months.map(function (b) { return b.cents; }));
    if (!max) {
      fig.appendChild(el('div', 'mk-chart__empty', 'Nothing billed yet. Finished requests show up here.'));
      return;
    }
    var cols = el('div', 'mk-cols');
    var xs = el('div', 'mk-xs');
    months.forEach(function (b, i) {
      var now = i === months.length - 1;
      var col = el('div', 'mk-col' + (now ? ' is-now' : ''));
      // Selective labels: this month and the highest month carry their value; the rest are in the tooltip.
      if (b.cents && (now || b.cents === max)) col.appendChild(el('span', 'mk-col__val', dollars(b.cents)));
      var bar = el('div', 'mk-col__bar');
      bar.style.height = b.cents ? Math.max(2, Math.round((b.cents / max) * 92)) + 'px' : '0';
      col.appendChild(bar);
      tooltip(col, b.long + ': ' + dollars(b.cents) + (b.n ? ' · ' + plural(b.n, 'request') : ''));
      cols.appendChild(col);
      xs.appendChild(el('span', null, b.label));
    });
    fig.appendChild(cols);
    fig.appendChild(xs);
    srTable(fig, ['Month', 'Billed', 'Requests'], months.map(function (b) { return [b.long, dollars(b.cents), String(b.n)]; }));
  }

  /* Cost by project: everything each project has cost so far, finished and open, largest first. */
  function renderProjectCosts() {
    var fig = $('chart-projects');
    chartHead(fig, 'Cost by project', 'Finished and open work');
    var rows = (board.projects || []).map(function (p, i) {
      var cents = board.requests.filter(function (r) { return r.project_id === p.id; }).reduce(function (sum, r) { return sum + (r.price_cents || 0); }, 0);
      return { name: p.name || 'Project', tint: tintHex(LANE_TINTS[i % LANE_TINTS.length]), cents: cents };
    });
    var loose = board.requests.filter(function (r) { return !r.project_id; }).reduce(function (sum, r) { return sum + (r.price_cents || 0); }, 0);
    if (loose) rows.push({ name: 'Getting set up', tint: tintHex(GREY_TINT), cents: loose });
    rows = rows.filter(function (r) { return r.cents > 0; }).sort(function (a, b) { return b.cents - a.cents; });
    if (!rows.length) {
      fig.appendChild(el('div', 'mk-chart__empty', 'No costs yet.'));
      return;
    }
    var max = rows[0].cents;
    var list = el('div', 'mk-hbars');
    rows.slice(0, 6).forEach(function (row) {
      var item = el('div', 'mk-hbar');
      var name = el('div', 'mk-hbar__name');
      var dot = el('span', 'mk-hbar__dot');
      dot.style.background = row.tint;
      name.appendChild(dot);
      name.appendChild(el('span', null, row.name));
      item.appendChild(name);
      var track = el('div', 'mk-hbar__track');
      var bar = el('div', 'mk-hbar__bar');
      bar.style.width = Math.max(2, Math.round((row.cents / max) * 72)) + '%';
      track.appendChild(bar);
      track.appendChild(el('span', 'mk-hbar__val', dollars(row.cents)));
      item.appendChild(track);
      tooltip(item, row.name + ': ' + dollars(row.cents));
      list.appendChild(item);
    });
    fig.appendChild(list);
    srTable(fig, ['Project', 'Cost'], rows.map(function (r) { return [r.name, dollars(r.cents)]; }));
  }

  function renderOverview() {
    workshopFeed();
    buildLabels();
    buildLegend();
    mountScene();
    renderKpis();
    renderMonths();
    renderProjectCosts();
  }

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
    board.spending = data.spending || { billed_cents: 0, open_cents: 0, ai_cents: 0 };
    renderProjects();
    renderSites();
    renderRequests();
    renderOverview();
    if (data.focus && !focusDone && requestById(data.focus)) {
      // Opened on one request (portal_board with request_id): straight to its conversation.
      focusDone = true;
      openThread(data.focus);
      return;
    }
    // Something new to read beats the overview, until the person picks a tab.
    if (threadId) notifySize();
    else if (!chosen) show(board.requests.some(function (r) { return r.unread; }) ? 'requests' : 'overview');
    else notifySize();
  }

  function showError(message) {
    rendered = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    var list = $('overview-projects');
    clear(list);
    list.appendChild(el('div', 'mk-err', message || 'Your work could not load.'));
    show('overview');
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
