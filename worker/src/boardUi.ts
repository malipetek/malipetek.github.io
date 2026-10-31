/*
 * The plugin's one piece of UI: a request board, served as an MCP Apps
 * resource (specification: `text/html;profile=mcp-app`, `ui://` URI).
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

export const BOARD_UI_URI = 'ui://malipetek/board-v1.html';

export const BOARD_MIME = 'text/html;profile=mcp-app';

export const BOARD_PORTAL = 'https://malipetek.dev/portal';

export interface BoardRequest {
  id: number;
  title: string;
  status: string;
  project: string | null;
  updated_at: string;
  unread: boolean;
  price_cents: number | null;
  budget_cents: number | null;
}

export interface Board {
  account: { name: string | null };
  projects: Array<{ id: string; name: string; requests: number }>;
  requests: BoardRequest[];
  updated_at: string;
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

/**
 * The text half of the tool result: what a host without UI support (or a model
 * reading the result back) gets. Kept to what matters rather than dumping the
 * whole payload twice.
 */
export function boardSummary(board: Board): string {
  const who = board.account?.name ? ` on ${board.account.name}` : '';
  const count = board.requests.length;
  const lines = board.requests.map((request) => {
    const bits = [
      STATUS_LABELS[request.status] ?? request.status,
      request.project,
      dollars(request.price_cents),
    ].filter(Boolean);
    return `#${request.id} ${request.title} — ${bits.join(' · ')}`;
  });
  const head = count === 0
    ? `No requests yet${who}.`
    : `${count} request${count === 1 ? '' : 's'}${who}, newest activity first:`;
  return [head, ...lines, '', `The same board is in the portal: ${BOARD_PORTAL}`].join('\n');
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
<title>malipetek requests</title>
<style>
  :root {
    color-scheme: light;
    --mk-bg: var(--color-background-primary, transparent);
    --mk-ink: var(--color-text-primary, light-dark(#16140f, #ece5d8));
    --mk-soft: var(--color-text-secondary, light-dark(#5d5850, #a0978a));
    --mk-rule: var(--color-border-secondary, light-dark(#e8e4dd, #2a2622));
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
  .mk-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mk-brand {
    font: 600 10px/1 var(--mk-mono);
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--mk-soft);
  }
  .mk-actions { display: flex; gap: 6px; align-items: center; }
  .mk-btn {
    font: 500 11px/1 var(--mk-mono);
    color: var(--mk-ink);
    background: transparent;
    border: 1px solid var(--mk-rule);
    border-radius: 999px;
    padding: 6px 10px;
    cursor: pointer;
    transition: border-color .15s ease, color .15s ease, background .15s ease;
  }
  .mk-btn:hover { border-color: var(--mk-orange); color: var(--mk-orange); }
  .mk-btn:focus-visible { outline: 2px solid var(--mk-orange); outline-offset: 2px; }
  .mk-btn[disabled] { opacity: .5; cursor: default; }
  .mk-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 12px 0 2px; }
  h1 { font: 600 15px/1.2 var(--mk-sans); letter-spacing: -.01em; margin: 0; }
  .mk-count { font: 500 11px/1 var(--mk-mono); color: var(--mk-soft); }
  .mk-list { margin-top: 4px; }
  .mk-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-top: 1px dashed var(--mk-rule);
  }
  .mk-row:first-child { border-top: 0; }
  .mk-title { font-weight: 550; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
  .mk-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mk-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--mk-orange); flex: none; }
  .mk-dot[hidden] { display: none; }
  .mk-meta { margin-top: 2px; font-size: 11.5px; color: var(--mk-soft); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .mk-pill {
    font: 500 10px/1 var(--mk-mono);
    letter-spacing: .02em;
    padding: 3px 7px;
    border-radius: 999px;
    border: 1px solid var(--mk-rule);
    color: var(--mk-soft);
  }
  .mk-pill[data-tone="wait"] { color: var(--mk-orange); border-color: color-mix(in srgb, var(--mk-orange) 40%, transparent); background: color-mix(in srgb, var(--mk-orange) 8%, transparent); }
  .mk-pill[data-tone="active"] { color: var(--mk-ink); border-color: color-mix(in srgb, var(--mk-ink) 25%, transparent); }
  .mk-pill[data-tone="done"] { color: var(--mk-ok); border-color: color-mix(in srgb, var(--mk-ok) 40%, transparent); }
  .mk-pill[data-tone="bad"] { color: var(--mk-bad); border-color: color-mix(in srgb, var(--mk-bad) 35%, transparent); }
  .mk-empty { padding: 14px 0 6px; color: var(--mk-soft); font-size: 13px; }
  .mk-skel { height: 30px; margin: 8px 0; border-radius: var(--mk-radius); background: color-mix(in srgb, var(--mk-ink) 6%, transparent); animation: mk-pulse 1.4s ease-in-out infinite; }
  @keyframes mk-pulse { 50% { opacity: .45; } }
  .mk-note { margin: 0; }
  .mk-foot {
    margin-top: 10px;
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
  }
  .mk-link:hover { color: var(--mk-orange); }
  .mk-err { color: var(--mk-bad); font-size: 12.5px; padding: 8px 0; }
  @media (prefers-reduced-motion: reduce) { .mk-skel { animation: none; } }
</style>
</head>
<body>
<div class="mk-top">
  <div class="mk-brand">malipetek.dev</div>
  <div class="mk-actions">
    <button class="mk-btn" id="refresh" type="button">Refresh</button>
  </div>
</div>

<div class="mk-head">
  <h1>Your requests</h1>
  <div class="mk-count" id="count">—</div>
</div>

<div class="mk-list" id="list" aria-live="polite">
  <div class="mk-skel"></div>
  <div class="mk-skel"></div>
</div>

<div class="mk-foot">
  <span>Every request is read by a human before work starts.</span>
  <button class="mk-link" id="portal" type="button">Open the portal ↗</button>
</div>

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

  var host = window.parent;
  var nextId = 1;
  var pending = {};
  var rendered = false;
  var fallbackTimer = null;

  var listEl = document.getElementById('list');
  var countEl = document.getElementById('count');
  var refreshEl = document.getElementById('refresh');

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

  function money(cents) {
    /* No cost yet is not "$0.00" — it is nothing to say. */
    if (typeof cents !== 'number' || !cents) return '';
    return '$' + (cents / 100).toFixed(2);
  }

  function relative(iso) {
    if (!iso) return '';
    var then = new Date(String(iso).replace(' ', 'T') + (String(iso).indexOf('Z') === -1 ? 'Z' : ''));
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

  function textOf(result) {
    if (!result || !result.content) return '';
    for (var i = 0; i < result.content.length; i++) {
      if (result.content[i] && result.content[i].type === 'text') return String(result.content[i].text || '');
    }
    return '';
  }

  /* The server sends structuredContent for the board; data tools answer with JSON text. */
  function payload(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    var text = textOf(result);
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
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

  function applyContext(context) {
    if (!context) return;
    // The host's theme wins over the OS: ChatGPT decides how its card looks.
    if (context.theme) document.documentElement.style.colorScheme = context.theme;
    if (context.locale) document.documentElement.lang = context.locale;
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

  function openRequest(id) {
    request('ui/open-link', { url: PORTAL + '/#/ticket/' + id }).catch(function () {});
  }

  function row(requestItem) {
    var status = STATUS[requestItem.status] || { label: requestItem.status || 'Unknown', tone: 'active' };
    var wrap = el('div', 'mk-row');

    var main = el('div', 'mk-main');
    var title = el('div', 'mk-title');
    if (requestItem.unread) title.appendChild(el('span', 'mk-dot'));
    var label = el('span', null, '#' + requestItem.id + ' ' + (requestItem.title || 'Untitled request'));
    title.appendChild(label);
    main.appendChild(title);

    var meta = el('div', 'mk-meta');
    var pill = el('span', 'mk-pill', status.label);
    pill.setAttribute('data-tone', status.tone);
    meta.appendChild(pill);
    if (requestItem.project) meta.appendChild(el('span', null, requestItem.project));
    var cost = money(requestItem.price_cents);
    if (cost) meta.appendChild(el('span', null, cost));
    var when = relative(requestItem.updated_at);
    if (when) meta.appendChild(el('span', null, 'updated ' + when));
    main.appendChild(meta);

    wrap.appendChild(main);

    var open = el('button', 'mk-btn', 'Open');
    open.type = 'button';
    open.addEventListener('click', function () { openRequest(requestItem.id); });
    wrap.appendChild(open);
    return wrap;
  }

  function render(board) {
    var requests = (board && board.requests) || [];
    rendered = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    clear(listEl);
    countEl.textContent = requests.length === 1 ? '1 open item' : requests.length + ' items';

    if (!requests.length) {
      listEl.appendChild(el('div', 'mk-empty', 'No requests yet. Describe the work you need and it lands here.'));
      return;
    }
    for (var i = 0; i < requests.length; i++) listEl.appendChild(row(requests[i]));
    notifySize();
  }

  function showError(message) {
    rendered = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    clear(listEl);
    countEl.textContent = '—';
    listEl.appendChild(el('div', 'mk-err', message || 'The board could not load.'));
    notifySize();
  }

  function handleResult(result) {
    if (!result) return;
    if (result.isError) { showError(textOf(result)); return; }
    var data = payload(result);
    if (!data) { showError('The board could not load.'); return; }
    if (data.requests) { render(data); return; }
    if (data.tickets) {
      render({
        requests: data.tickets.map(function (t) {
          return {
            id: t.id,
            title: t.title,
            status: t.status,
            project: t.project_name || null,
            updated_at: t.updated_at,
            unread: !!t.unread,
            price_cents: typeof t.price_cents === 'number' ? t.price_cents : null,
            budget_cents: typeof t.budget_cents === 'number' ? t.budget_cents : null
          };
        })
      });
      return;
    }
    showError('The board could not load.');
  }

  function load() {
    refreshEl.disabled = true;
    return request('tools/call', { name: 'portal_requests', arguments: {} })
      .then(function (result) { handleResult(result); })
      .catch(function (error) { if (!rendered) showError(error && error.message); })
      .then(function () { refreshEl.disabled = false; });
  }

  function notifySize() {
    var height = Math.ceil(document.body.getBoundingClientRect().height);
    var width = Math.ceil(document.body.getBoundingClientRect().width);
    notify('ui/notifications/size-changed', { width: width, height: height });
  }

  refreshEl.addEventListener('click', function () { if (!refreshEl.disabled) load(); });
  document.getElementById('portal').addEventListener('click', function () {
    request('ui/open-link', { url: PORTAL }).catch(function () {});
  });

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
      if (!rendered) showError('The board was cancelled.');
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
    var last = '';
    var observer = new ResizeObserver(function () {
      var height = Math.ceil(document.body.getBoundingClientRect().height);
      if (height + 'px' === last) return;
      last = height + 'px';
      notifySize();
    });
    observer.observe(document.body);
  }

  function armFallback() {
    /* Some hosts render the view without a result (a prefetch, or a manual
       open). Pull the data through the bridge instead of sitting empty. */
    fallbackTimer = setTimeout(function () {
      if (!rendered) load();
    }, 1200);
  }

  request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appCapabilities: { availableDisplayModes: ['inline'] },
    clientInfo: { name: 'malipetek-board', version: '1.1.0' }
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
