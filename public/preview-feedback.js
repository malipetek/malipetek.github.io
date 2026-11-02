/*!
 * Preview feedback — the launcher a preview site carries.
 *
 * A preview is where a client sees work before it is live, and that is where
 * they notice what is wrong. This script adds a small launcher to the page:
 * write a note, record a voice note, or mark up a screenshot, and it files a
 * real request on the project through the portal's API.
 *
 * It is served from malipetek.dev and injected into preview HTML by
 * malipetek-sites (and into client-hosted mirrors at upload time). It has no
 * dependencies at load; the screenshot renderer is fetched on first use.
 *
 * Auth: the portal opens previews with `?mf=<site feedback token>`. The token
 * is read once, stripped from the address bar, and kept for the tab. Without
 * it the launcher still explains where to open the preview from.
 */
(function () {
  'use strict';

  if (window.__malipetekFeedback) return;
  window.__malipetekFeedback = true;

  var script = document.currentScript || document.querySelector('script[data-malipetek-feedback]');
  if (!script) return;

  var API = (script.getAttribute('data-api') || 'https://malipetek.dev/api').replace(/\/+$/, '');
  var PORTAL = API.replace(/\/api$/, '');
  var SLUG = script.getAttribute('data-slug') || '';
  var TOKEN_KEY = 'mf_token:' + SLUG;

  var MAX_TEXT = 2000;
  var MAX_RECORDING_MS = 3 * 60 * 1000;
  var MAX_CAPTURE_HEIGHT = 6000;

  /*
   * English is the shape and the fallback: the portal's catalog fills these in
   * the client's own language (GET /portal/preview-feedback/config). Anything
   * the catalog has not translated yet stays English rather than showing a key.
   */
  var DEFAULT_STRINGS = {
    launcher: 'Feedback',
    launcherLabel: 'Send feedback on this preview',
    title: 'Send feedback',
    subtitle: 'Goes to Ali as a request',
    close: 'Close',
    placeholder: 'What should change? Describe it, or record a voice note.',
    voice: 'Voice note',
    screenshot: 'Screenshot',
    send: 'Send request',
    recording: 'Recording. Say what should change.',
    stop: 'Stop',
    micBlocked: 'Microphone access was blocked. Allow it in the browser, or write the note instead.',
    noRecorder: 'This browser cannot record audio.',
    nothingRecorded: 'Nothing was recorded.',
    voiceReady: 'Voice note ready.',
    capturing: 'Taking the screenshot\u2026',
    captureFailed: 'Could not capture the page. Try again, or describe it in the note.',
    screenshotAttached: 'Screenshot attached.',
    saveFailed: 'Could not save the marked-up screenshot.',
    loadFailed: 'Could not load the screenshot.',
    sending: 'Sending\u2026',
    empty: 'Add a note, a voice note or a screenshot first.',
    offline: 'Could not reach the portal. Check the connection and try again.',
    failed: 'Could not send that. Try again in a moment.',
    signedOut: 'This preview is not linked to your portal. Open it again from your portal.',
    unknownSite: 'This preview is no longer available.',
    rateLimited: 'Too many notes from here just now. Try again in a little while.',
    tooLarge: 'An attachment is over the 10 MB limit. Try a smaller screenshot or a shorter note.',
    noFiles: 'Attachments are unavailable right now. Send the note as text.',
    openFromPortal: 'Open this preview from your portal so the request goes on the right project.',
    openPortal: 'Open your portal',
    done: 'Request #{id} sent',
    replyInPortal: 'Ali will reply in your portal.',
    transcribed: 'Voice note transcribed.',
    openRequest: 'Open request',
    sendAnother: 'Send another',
    markup: 'Mark up the screenshot',
    tools: 'Drawing tools',
    pen: 'Pen',
    arrow: 'Arrow',
    box: 'Box',
    text: 'Text',
    hide: 'Hide',
    undo: 'Undo',
    clear: 'Clear',
    cancel: 'Cancel',
    attach: 'Attach screenshot',
    drawHint: 'Draw on the screenshot to show what should change.',
    typeHere: 'Type\u2026',
    removeAttachment: 'Remove {name}',
    colour: 'Colour {value}',
  };

  var strings = {};

  /** A string in the client's language, with `{name}` variables filled. */
  function t(key, vars) {
    var value = strings[key] || DEFAULT_STRINGS[key] || key;
    return vars
      ? value.replace(/\{(\w+)\}/g, function (match, name) {
          return vars[name] === undefined ? match : vars[name];
        })
      : value;
  }

  /* —————————————————————— the token —————————————————————— */

  var token = '';
  try {
    var params = new URLSearchParams(location.search);
    token = params.get('mf') || '';
    if (token) {
      params.delete('mf');
      var query = params.toString();
      history.replaceState(history.state, '', location.pathname + (query ? '?' + query : '') + location.hash);
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
      } catch (e) {}
    } else {
      try {
        token = sessionStorage.getItem(TOKEN_KEY) || '';
      } catch (e) {}
    }
  } catch (e) {
    token = '';
  }

  /* —————————————————————— styles —————————————————————— */

  var CSS = [
    ':host{all:initial}',
    '.mf-root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#1d1a15;-webkit-font-smoothing:antialiased}',
    '.mf-root *{box-sizing:border-box}',
    '.mf-root [hidden]{display:none!important}',
    '.mf-launcher{position:fixed;right:20px;bottom:20px;display:flex;align-items:center;gap:8px;padding:10px 15px 10px 12px;border:0;border-radius:999px;background:#191612;color:#f7f1e6;font:inherit;font-weight:600;font-size:13.5px;letter-spacing:.01em;box-shadow:0 8px 24px rgba(20,16,10,.22),0 1px 2px rgba(20,16,10,.18);cursor:pointer;pointer-events:auto;transition:transform .16s ease,box-shadow .16s ease}',
    '.mf-launcher:hover{transform:translateY(-1px);box-shadow:0 12px 30px rgba(20,16,10,.26)}',
    '.mf-launcher svg{width:17px;height:17px;flex:none}',
    '.mf-panel{position:fixed;right:20px;bottom:20px;width:min(390px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fbf8f1;border:1px solid #e2dccd;border-radius:16px;box-shadow:0 24px 60px rgba(24,19,11,.26),0 2px 6px rgba(24,19,11,.12);overflow:hidden;pointer-events:auto}',
    '.mf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 16px 12px;border-bottom:1px solid #ece6d8;background:#fffdf8}',
    '.mf-title{font-weight:650;font-size:15px;letter-spacing:-.01em}',
    '.mf-sub{display:block;color:#7c7465;font-size:12px;margin-top:2px}',
    '.mf-x{flex:none;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#6f6759;font-size:20px;line-height:1;cursor:pointer}',
    '.mf-x:hover{background:#f0ebdf;color:#2a251d}',
    '.mf-body{padding:14px 16px 16px;overflow:auto}',
    '.mf-text{width:100%;min-height:96px;max-height:220px;resize:vertical;padding:11px 12px;border:1px solid #ddd6c7;border-radius:11px;background:#fff;color:inherit;font:inherit;font-size:14px;outline:none}',
    '.mf-text:focus{border-color:#b9ac92;box-shadow:0 0 0 3px rgba(185,172,146,.18)}',
    '.mf-tools{display:flex;gap:8px;margin-top:10px}',
    '.mf-tool{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid #ddd6c7;border-radius:9px;background:#fff;color:#3a342a;font:inherit;font-size:13px;cursor:pointer}',
    '.mf-tool:hover:not(:disabled){border-color:#c9bfa9;background:#fffdf8}',
    '.mf-tool:disabled{opacity:.5;cursor:default}',
    '.mf-tool svg{width:15px;height:15px}',
    '.mf-rec{display:flex;align-items:center;gap:10px;margin-top:10px;padding:9px 11px;border:1px solid #e8b4b1;border-radius:10px;background:#fdf1f0}',
    '.mf-dot{width:9px;height:9px;border-radius:50%;background:#d93b34;animation:mf-pulse 1.2s ease-in-out infinite;flex:none}',
    '@keyframes mf-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '.mf-time{font-variant-numeric:tabular-nums;font-weight:600;color:#8a2f2b}',
    '.mf-sendstop{margin-left:auto;padding:5px 10px;border:0;border-radius:7px;background:#d93b34;color:#fff;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}',
    '.mf-files{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}',
    '.mf-file{display:flex;align-items:center;gap:9px;padding:7px 8px;border:1px solid #e3ddce;border-radius:9px;background:#fff}',
    '.mf-file img{width:42px;height:32px;object-fit:cover;border-radius:5px;border:1px solid #e6e0d2;flex:none}',
    '.mf-file audio{height:30px;flex:1;min-width:0}',
    '.mf-file .mf-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:#5c5548}',
    '.mf-remove{flex:none;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:#8b8272;font-size:16px;cursor:pointer}',
    '.mf-remove:hover{background:#f3eee3;color:#2a251d}',
    '.mf-status{margin-top:10px;font-size:12.5px;color:#7c7465;min-height:0}',
    '.mf-status.mf-error{color:#b3382f}',
    '.mf-status.mf-good{color:#2f7a4d}',
    '.mf-send{width:100%;margin-top:12px;padding:11px 14px;border:0;border-radius:10px;background:#191612;color:#f7f1e6;font:inherit;font-weight:600;font-size:14px;cursor:pointer}',
    '.mf-send:hover:not(:disabled){background:#2b261f}',
    '.mf-send:disabled{opacity:.5;cursor:default}',
    '.mf-auth{padding:18px 16px;color:#5c5548;font-size:13.5px}',
    '.mf-auth p{margin:0 0 12px}',
    '.mf-auth a{display:inline-block;padding:9px 13px;border-radius:9px;background:#191612;color:#f7f1e6;text-decoration:none;font-weight:600;font-size:13px}',
    '.mf-done{padding:22px 18px;text-align:center}',
    '.mf-done .mf-check{width:42px;height:42px;margin:0 auto 12px;border-radius:50%;background:#e7f3ea;color:#2f7a4d;display:grid;place-items:center}',
    '.mf-done h3{margin:0 0 4px;font-size:16px}',
    '.mf-done p{margin:0 0 14px;color:#6f6759;font-size:13px}',
    '.mf-done a,.mf-done button{display:inline-block;margin:0 4px;padding:8px 12px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer}',
    '.mf-done a{background:#191612;color:#f7f1e6;border:0}',
    '.mf-done button{background:transparent;border:1px solid #d8d0bf;color:#3a342a}',
    /* annotator */
    '.mf-annotator{position:fixed;inset:0;background:rgba(18,15,10,.72);display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:auto}',
    '.mf-ann{display:flex;flex-direction:column;width:min(1180px,100%);max-height:calc(100vh - 32px);background:#f7f3ea;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4)}',
    '.mf-ann-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #e2dccd;background:#fffdf8}',
    '.mf-ann-head strong{font-size:13.5px;margin-right:4px}',
    '.mf-toolset{display:flex;align-items:center;gap:4px;padding:3px;border:1px solid #e3ddce;border-radius:9px;background:#fbf8f1}',
    '.mf-ann-tool{width:30px;height:28px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:#5c5548;cursor:pointer}',
    '.mf-ann-tool:hover{background:#efe9dc}',
    '.mf-ann-tool[aria-pressed="true"]{background:#191612;color:#f7f1e6}',
    '.mf-ann-tool svg{width:16px;height:16px}',
    '.mf-colors{display:flex;gap:4px;margin-left:2px}',
    '.mf-color{width:20px;height:20px;border-radius:50%;border:2px solid #f7f3ea;box-shadow:0 0 0 1px #d4ccba;cursor:pointer;padding:0}',
    '.mf-color[aria-pressed="true"]{box-shadow:0 0 0 2px #191612}',
    '.mf-spacer{flex:1}',
    '.mf-linkbtn{border:0;background:transparent;color:#5c5548;font:inherit;font-size:12.5px;cursor:pointer;padding:6px 7px;border-radius:6px}',
    '.mf-linkbtn:hover{background:#efe9dc;color:#1d1a15}',
    '.mf-ann-scroll{flex:1;overflow:auto;padding:14px;display:flex;justify-content:center;background:#efe9dc}',
    '.mf-stage{position:relative;line-height:0;box-shadow:0 2px 12px rgba(30,24,16,.16);background:#fff}',
    '.mf-stage canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}',
    '.mf-stage .mf-live{cursor:crosshair}',
    '.mf-ann-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #e2dccd;background:#fffdf8}',
    '.mf-ann-foot .mf-hint{color:#7c7465;font-size:12px;flex:1}',
    '.mf-btn{padding:8px 12px;border-radius:8px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #d8d0bf;background:transparent;color:#3a342a}',
    '.mf-btn:hover{background:#f1ebdd}',
    '.mf-btn--primary{border:0;background:#191612;color:#f7f1e6}',
    '.mf-btn--primary:hover{background:#2b261f}',
    '.mf-textinput{position:absolute;z-index:3;min-width:120px;padding:4px 6px;border:1px solid #191612;border-radius:5px;background:#fff;color:#1d1a15;font:600 15px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none}',
    '@media (max-width:520px){.mf-panel{right:12px;bottom:12px;width:calc(100vw - 24px)}.mf-launcher{right:14px;bottom:14px}.mf-ann-head{gap:6px}.mf-ann-head strong{display:none}}',
  ].join('\n');

  /* —————————————————————— icons —————————————————————— */

  var ICON = {
    bubble:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.5-.7L3 21l1.4-4.1A8.4 8.4 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    camera:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="M13.5 6.5l3 3"/></svg>',
    arrow:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 19 5M11 5h8v8"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4" y="5" width="16" height="14" rx="1.5"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 6h14M12 6v13M9 19h6"/></svg>',
    hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 12h16M8 5v14M16 5v14" opacity=".55"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  };

  /* —————————————————————— shell —————————————————————— */

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) for (var key in attrs) node.setAttribute(key, attrs[key]);
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  var host = el('div', { id: 'malipetek-feedback' });
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.appendChild(el('style', null, CSS));
  var root = el('div', { class: 'mf-root' });
  shadow.appendChild(root);

  var launcher = el(
    'button',
    { class: 'mf-launcher', type: 'button', 'aria-label': 'Send feedback on this preview', 'data-mf-aria': 'launcherLabel' },
    ICON.bubble + '<span data-mf="launcher">Feedback</span>',
  );
  root.appendChild(launcher);

  var panel = el(
    'div',
    { class: 'mf-panel', role: 'dialog', 'aria-label': 'Send feedback on this preview', 'data-mf-aria': 'launcherLabel', hidden: '' },
    '<div class="mf-head"><div><div class="mf-title" data-mf="title">Send feedback</div><span class="mf-sub" data-mf="subtitle">Goes to Ali as a request</span></div><button class="mf-x" type="button" aria-label="Close" data-mf-aria="close">\u00d7</button></div>' +
      '<div class="mf-body">' +
      '<textarea class="mf-text" maxlength="' + MAX_TEXT + '" placeholder="What should change? Describe it, or record a voice note." data-mf-placeholder="placeholder"></textarea>' +
      '<div class="mf-tools">' +
      '<button class="mf-tool" type="button" data-act="voice">' + ICON.mic + '<span data-mf="voice">Voice note</span></button>' +
      '<button class="mf-tool" type="button" data-act="shot">' + ICON.camera + '<span data-mf="screenshot">Screenshot</span></button>' +
      '</div>' +
      '<ul class="mf-files" hidden></ul>' +
      '<div class="mf-status" role="status" aria-live="polite"></div>' +
      '<button class="mf-send" type="button" data-mf="send">Send request</button>' +
      '</div>' +
      '<div class="mf-auth" hidden><p data-mf="openFromPortal">Open this preview from your portal so the request goes on the right project.</p><a target="_blank" rel="noopener" data-mf="openPortal">Open your portal</a></div>' +
      '<div class="mf-done" hidden></div>',
  );
  root.appendChild(panel);

  var annotator = el('div', { class: 'mf-annotator', hidden: '' });
  root.appendChild(annotator);

  document.documentElement.appendChild(host);

  var $ = function (selector) {
    return panel.querySelector(selector);
  };
  var text = $('.mf-text');
  var list = $('.mf-files');
  var status = $('.mf-status');
  var sendButton = $('.mf-send');
  var body = $('.mf-body');
  var auth = $('.mf-auth');
  var done = $('.mf-done');
  var voiceButton = $('[data-act="voice"]');
  var shotButton = $('[data-act="shot"]');
  var recorderStop = null;
  var attachments = [];
  var busy = false;

  auth.querySelector('a').href = PORTAL + '/portal';
  if (!token) {
    body.hidden = true;
    auth.hidden = false;
  }

  /** Re-apply the static copy after the client's catalog arrives. */
  function applyStrings() {
    root.querySelectorAll('[data-mf]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-mf'));
    });
    root.querySelectorAll('[data-mf-placeholder]').forEach(function (node) {
      node.setAttribute('placeholder', t(node.getAttribute('data-mf-placeholder')));
    });
    root.querySelectorAll('[data-mf-aria]').forEach(function (node) {
      node.setAttribute('aria-label', t(node.getAttribute('data-mf-aria')));
    });
  }

  /**
   * The site token says which client the preview belongs to, so the portal can
   * answer in that client's language. Any string missing from the catalog
   * stays English; a failed request leaves the whole widget in English.
   */
  function loadStrings() {
    if (!token) return;
    fetch(API + '/portal/preview-feedback/config?token=' + encodeURIComponent(token), {
      mode: 'cors',
      credentials: 'omit',
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (!data || !data.strings) return;
        Object.keys(data.strings).forEach(function (key) {
          if (typeof data.strings[key] === 'string') strings[key] = data.strings[key];
        });
        if (data.locale) root.setAttribute('lang', data.locale);
        applyStrings();
      })
      .catch(function () {});
  }

  loadStrings();

  function setStatus(message, tone) {
    status.textContent = message || '';
    status.className = 'mf-status' + (tone ? ' mf-' + tone : '');
  }

  function open() {
    panel.hidden = false;
    launcher.hidden = true;
    done.hidden = true;
    body.hidden = !token;
    auth.hidden = !!token;
    setStatus('');
    setTimeout(function () {
      if (token) text.focus();
    }, 30);
  }

  function close() {
    if (recorderStop) recorderStop();
    panel.hidden = true;
    launcher.hidden = false;
  }

  launcher.addEventListener('click', open);
  $('.mf-x').addEventListener('click', close);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) close();
  });

  /* —————————————————————— attachments —————————————————————— */

  function renderFiles() {
    list.innerHTML = '';
    list.hidden = attachments.length === 0;
    attachments.forEach(function (attachment, index) {
      var row = el('li', { class: 'mf-file' });
      if (attachment.kind === 'shot') {
        var img = el('img', { alt: 'Screenshot', src: attachment.url });
        row.appendChild(img);
      } else {
        row.appendChild(el('audio', { controls: '', src: attachment.url, preload: 'metadata' }));
      }
      row.appendChild(el('span', { class: 'mf-name', title: attachment.name }, attachment.name));
      var remove = el('button', { class: 'mf-remove', type: 'button', 'aria-label': t('removeAttachment', { name: attachment.name }) }, '\u00d7');
      remove.addEventListener('click', function () {
        URL.revokeObjectURL(attachment.url);
        attachments.splice(index, 1);
        renderFiles();
      });
      row.appendChild(remove);
      list.appendChild(row);
    });
  }

  function addAttachment(attachment) {
    attachments.push(attachment);
    renderFiles();
  }

  function setBusy(state, message) {
    busy = state;
    sendButton.disabled = state;
    voiceButton.disabled = state;
    shotButton.disabled = state;
    if (message !== undefined) setStatus(message);
  }

  /* —————————————————————— voice —————————————————————— */

  function pickMime() {
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (e) {}
    }
    return '';
  }

  function extensionFor(type) {
    if (type.indexOf('mp4') !== -1) return 'm4a';
    if (type.indexOf('ogg') !== -1) return 'ogg';
    return 'webm';
  }

  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus(t('noRecorder'), 'error');
      return;
    }
    var stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setStatus(t('micBlocked'), 'error');
      return;
    }
    var mime = pickMime();
    var recorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      setStatus(t('noRecorder'), 'error');
      return;
    }

    var chunks = [];
    var started = Date.now();
    var row = el(
      'div',
      { class: 'mf-rec' },
      '<span class="mf-dot"></span><span class="mf-time">0:00</span><button class="mf-sendstop" type="button">' + t('stop') + '</button>',
    );
    var time = row.querySelector('.mf-time');
    voiceButton.parentNode.insertAdjacentElement('afterend', row);
    voiceButton.disabled = true;
    shotButton.disabled = true;
    setStatus(t('recording'));

    var tick = setInterval(function () {
      time.textContent = formatTime(Date.now() - started);
    }, 250);

    function cleanup() {
      clearInterval(tick);
      row.remove();
      voiceButton.disabled = false;
      shotButton.disabled = false;
      recorderStop = null;
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
    }

    recorderStop = function () {
      try {
        recorder.stop();
      } catch (e) {
        cleanup();
      }
    };

    row.querySelector('.mf-sendstop').addEventListener('click', function () {
      recorderStop && recorderStop();
    });

    var limit = setTimeout(function () {
      recorderStop && recorderStop();
    }, MAX_RECORDING_MS);

    recorder.ondataavailable = function (event) {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onstop = function () {
      clearTimeout(limit);
      cleanup();
      if (!chunks.length) {
        setStatus(t('nothingRecorded'), 'error');
        return;
      }
      var type = mime || recorder.mimeType || 'audio/webm';
      var blob = new Blob(chunks, { type: type });
      var name = 'voice-note.' + extensionFor(type);
      addAttachment({ kind: 'audio', blob: blob, name: name, url: URL.createObjectURL(blob), type: type });
      setStatus(t('voiceReady'));
      if (attachments.length + text.value.trim().length > 0) sendButton.disabled = false;
    };

    recorder.start();
  }

  voiceButton.addEventListener('click', startRecording);

  /* —————————————————————— screenshot —————————————————————— */

  function loadCapture() {
    if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = PORTAL + '/vendor/modern-screenshot.js?v=1';
      tag.async = true;
      tag.onload = function () {
        if (window.modernScreenshot) resolve(window.modernScreenshot);
        else reject(new Error('renderer missing'));
      };
      tag.onerror = function () {
        reject(new Error('renderer failed'));
      };
      document.head.appendChild(tag);
    });
  }

  function isWidgetNode(node) {
    return node === host || (node.id && node.id === 'malipetek-feedback');
  }

  async function takeScreenshot() {
    if (busy) return;
    setBusy(true, t('capturing'));
    launcher.hidden = true;
    var dataUrl;
    try {
      var lib = await loadCapture();
      var doc = document.documentElement;
      var width = doc.clientWidth;
      var height = Math.min(doc.scrollHeight, MAX_CAPTURE_HEIGHT);
      var scale = height > 2600 ? 1 : Math.min(2, window.devicePixelRatio || 1);
      var background = '#ffffff';
      try {
        var computed = getComputedStyle(document.body || doc).backgroundColor;
        if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') background = computed;
      } catch (e) {}
      dataUrl = await lib.domToPng(doc, {
        width: width,
        height: height,
        scale: scale,
        backgroundColor: background,
        maximumCanvasSize: 16000000,
        timeout: 15000,
        filter: function (node) {
          return !isWidgetNode(node);
        },
      });
    } catch (e) {
      setBusy(false);
      setStatus(t('captureFailed'), 'error');
      return;
    }
    setBusy(false, '');
    openAnnotator(dataUrl);
  }

  shotButton.addEventListener('click', takeScreenshot);

  /* —————————————————————— annotator —————————————————————— */

  var COLORS = ['#e5484d', '#f5a524', '#3b82f6', '#1c1c1c'];
  var ann = null;

  document.addEventListener('keydown', function (event) {
    if (!ann) return;
    if (event.key === 'Escape') {
      ann.close();
      return;
    }
    if ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      ann.ops.pop();
      ann.redraw();
    }
  });

  function openAnnotator(dataUrl) {
    annotator.innerHTML = '';
    annotator.hidden = false;
    panel.hidden = true;
    launcher.hidden = true;

    var tools = [
      ['pen', t('pen'), ICON.pen],
      ['arrow', t('arrow'), ICON.arrow],
      ['box', t('box'), ICON.box],
      ['text', t('text'), ICON.text],
      ['hide', t('hide'), ICON.hide],
    ];

    var header = el('div', { class: 'mf-ann-head' }, '<strong>' + t('markup') + '</strong>');
    var toolset = el('div', { class: 'mf-toolset', role: 'group', 'aria-label': t('tools') });
    var toolButtons = {};
    tools.forEach(function (tool) {
      var button = el('button', { class: 'mf-ann-tool', type: 'button', title: tool[1], 'aria-label': tool[1], 'aria-pressed': tool[0] === 'pen' ? 'true' : 'false' }, tool[2]);
      button.addEventListener('click', function () {
        ann.tool = tool[0];
        Object.keys(toolButtons).forEach(function (key) {
          toolButtons[key].setAttribute('aria-pressed', key === tool[0] ? 'true' : 'false');
        });
        ann.input && ann.input.remove();
      });
      toolButtons[tool[0]] = button;
      toolset.appendChild(button);
    });

    var colors = el('div', { class: 'mf-colors' });
    var colorButtons = [];
    COLORS.forEach(function (color, index) {
      var button = el('button', {
        class: 'mf-color',
        type: 'button',
        title: color,
        'aria-label': t('colour', { value: color }),
        'aria-pressed': index === 0 ? 'true' : 'false',
      });
      button.style.background = color;
      button.addEventListener('click', function () {
        ann.color = color;
        colorButtons.forEach(function (other) {
          other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
        });
      });
      colorButtons.push(button);
      colors.appendChild(button);
    });

    var undo = el('button', { class: 'mf-linkbtn', type: 'button' }, t('undo'));
    var clear = el('button', { class: 'mf-linkbtn', type: 'button' }, t('clear'));
    var close = el('button', { class: 'mf-x', type: 'button', 'aria-label': t('cancel') }, '\u00d7');

    header.appendChild(toolset);
    header.appendChild(colors);
    header.appendChild(el('span', { class: 'mf-spacer' }));
    header.appendChild(undo);
    header.appendChild(clear);
    header.appendChild(close);

    var scroll = el('div', { class: 'mf-ann-scroll' });
    var stage = el('div', { class: 'mf-stage' });
    var base = el('canvas', { class: 'mf-base' });
    var live = el('canvas', { class: 'mf-live' });
    stage.appendChild(base);
    stage.appendChild(live);
    scroll.appendChild(stage);

    var foot = el(
      'div',
      { class: 'mf-ann-foot' },
      '<span class="mf-hint">' + t('drawHint') + '</span>' +
        '<button class="mf-btn mf-cancel" type="button">' + t('cancel') + '</button>' +
        '<button class="mf-btn mf-btn--primary mf-attach" type="button">' + t('attach') + '</button>',
    );

    var shell = el('div', { class: 'mf-ann' });
    shell.appendChild(header);
    shell.appendChild(scroll);
    shell.appendChild(foot);
    annotator.appendChild(shell);

    var image = new Image();
    image.onload = function () {
      var source = document.createElement('canvas');
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      source.getContext('2d').drawImage(image, 0, 0);

      var maxWidth = Math.min(window.innerWidth - 64, 1140);
      var displayWidth = Math.min(image.naturalWidth, Math.max(280, maxWidth));
      var displayHeight = Math.round((image.naturalHeight / image.naturalWidth) * displayWidth);
      stage.style.width = displayWidth + 'px';
      stage.style.height = displayHeight + 'px';
      base.width = live.width = source.width;
      base.height = live.height = source.height;

      ann = {
        tool: 'pen',
        color: COLORS[0],
        ops: [],
        source: source,
        base: base,
        live: live,
        baseCtx: base.getContext('2d'),
        liveCtx: live.getContext('2d'),
        drawing: null,
        input: null,
        displayWidth: displayWidth,
        overlay: null,
      };

      function point(event) {
        var rect = live.getBoundingClientRect();
        return {
          x: ((event.clientX - rect.left) / rect.width) * source.width,
          y: ((event.clientY - rect.top) / rect.height) * source.height,
        };
      }

      function redraw() {
        var ctx = ann.baseCtx;
        ctx.clearRect(0, 0, source.width, source.height);
        ctx.drawImage(source, 0, 0);
        ann.ops.forEach(function (op) {
          drawOp(ctx, op, source);
        });
      }

      function commit(op) {
        ann.ops.push(op);
        drawOp(ann.baseCtx, op, source);
        ann.liveCtx.clearRect(0, 0, source.width, source.height);
      }

      live.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return;
        if (ann.tool === 'text') {
          placeText(event);
          return;
        }
        live.setPointerCapture(event.pointerId);
        var at = point(event);
        ann.drawing = { tool: ann.tool, color: ann.color, width: Math.max(3, source.width / 380), points: [at] };
      });

      live.addEventListener('pointermove', function (event) {
        if (!ann.drawing) return;
        var at = point(event);
        var op = ann.drawing;
        if (op.tool === 'pen') {
          op.points.push(at);
        } else {
          op.points[1] = at;
        }
        var ctx = ann.liveCtx;
        ctx.clearRect(0, 0, source.width, source.height);
        drawOp(ctx, op, source);
      });

      function finish() {
        if (!ann.drawing) return;
        var op = ann.drawing;
        ann.drawing = null;
        var distance = 0;
        if (op.points.length > 1) {
          var first = op.points[0];
          var last = op.points[op.points.length - 1];
          distance = Math.abs(last.x - first.x) + Math.abs(last.y - first.y);
        }
        if (op.tool !== 'pen' && distance < 4) {
          ann.liveCtx.clearRect(0, 0, source.width, source.height);
          return;
        }
        commit(op);
      }

      live.addEventListener('pointerup', finish);
      live.addEventListener('pointercancel', finish);
      live.addEventListener('pointerleave', function () {
        if (ann.drawing) finish();
      });

      function placeText(event) {
        ann.input && ann.input.remove();
        var rect = live.getBoundingClientRect();
        var cssX = event.clientX - rect.left;
        var cssY = event.clientY - rect.top;
        var input = el('input', { class: 'mf-textinput', type: 'text', placeholder: t('typeHere'), maxlength: '80' });
        input.style.left = cssX + 'px';
        input.style.top = cssY + 'px';
        stage.appendChild(input);
        ann.input = input;
        input.focus();
        var cancelled = false;

        function commitText() {
          if (cancelled) return;
          var value = input.value.trim();
          input.remove();
          ann.input = null;
          if (!value) return;
          commit({
            tool: 'text',
            color: ann.color,
            text: value,
            x: (cssX / rect.width) * source.width,
            y: (cssY / rect.height) * source.height,
            size: Math.max(20, source.width / 55),
          });
        }
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') commitText();
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancelled = true;
            input.value = '';
            input.remove();
            ann.input = null;
          }
        });
        input.addEventListener('blur', commitText);
      }

      undo.addEventListener('click', function () {
        ann.ops.pop();
        redraw();
      });
      clear.addEventListener('click', function () {
        ann.ops = [];
        redraw();
      });

      function closeAnnotator() {
        annotator.hidden = true;
        annotator.innerHTML = '';
        ann = null;
        panel.hidden = false;
        launcher.hidden = true;
      }
      close.addEventListener('click', closeAnnotator);
      foot.querySelector('.mf-cancel').addEventListener('click', closeAnnotator);
      annotator.addEventListener('click', function (event) {
        if (event.target === annotator) closeAnnotator();
      });
      ann.close = closeAnnotator;
      ann.redraw = redraw;

      foot.querySelector('.mf-attach').addEventListener('click', function () {
        exportScreenshot(base, source, 1800, function (blob) {
          if (!blob) {
            setStatus(t('saveFailed'), 'error');
            return;
          }
          addAttachment({
            kind: 'shot',
            blob: blob,
            name: 'screenshot-' + Date.now() + '.png',
            url: URL.createObjectURL(blob),
            type: 'image/png',
          });
          closeAnnotator();
          setStatus(t('screenshotAttached'));
        });
      });

      redraw();
    };
    image.onerror = function () {
      annotator.hidden = true;
      setStatus(t('loadFailed'), 'error');
      panel.hidden = false;
    };
    image.src = dataUrl;
  }

  /**
   * PNG of the marked-up screenshot, under the 10 MB attachment limit. A very
   * tall or busy page can still be large at 1800px, so the width steps down
   * until it fits.
   */
  function exportScreenshot(base, source, limit, done) {
    var output = document.createElement('canvas');
    var ratio = Math.min(1, limit / source.width);
    output.width = Math.max(1, Math.round(source.width * ratio));
    output.height = Math.max(1, Math.round(source.height * ratio));
    output.getContext('2d').drawImage(base, 0, 0, output.width, output.height);
    output.toBlob(function (blob) {
      if (blob && blob.size > 9 * 1024 * 1024 && limit > 900) {
        exportScreenshot(base, source, Math.round(limit * 0.7), done);
        return;
      }
      done(blob);
    }, 'image/png');
  }

  function drawOp(ctx, op, source) {
    ctx.save();
    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    ctx.lineWidth = op.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (op.tool === 'pen') {
      if (op.points.length === 1) {
        ctx.beginPath();
        ctx.arc(op.points[0].x, op.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(op.points[0].x, op.points[0].y);
        for (var i = 1; i < op.points.length; i += 1) ctx.lineTo(op.points[i].x, op.points[i].y);
        ctx.stroke();
      }
    } else if (op.tool === 'box') {
      var a = op.points[0];
      var b = op.points[1];
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (op.tool === 'arrow') {
      var start = op.points[0];
      var end = op.points[1];
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      var angle = Math.atan2(end.y - start.y, end.x - start.x);
      var head = Math.max(14, (op.width || 4) * 4.2);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 7), end.y - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 7), end.y - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    } else if (op.tool === 'text') {
      ctx.font = '700 ' + op.size + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.lineWidth = Math.max(4, op.size / 6);
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.strokeText(op.text, op.x, op.y);
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, op.x, op.y);
    } else if (op.tool === 'hide') {
      var left = Math.min(op.points[0].x, op.points[1].x);
      var top = Math.min(op.points[0].y, op.points[1].y);
      var width = Math.abs(op.points[1].x - op.points[0].x);
      var height = Math.abs(op.points[1].y - op.points[0].y);
      if (width < 6 || height < 6) {
        ctx.restore();
        return;
      }
      var block = Math.max(6, Math.round(Math.min(width, height) / 9));
      var tiny = document.createElement('canvas');
      tiny.width = Math.max(1, Math.round(width / block));
      tiny.height = Math.max(1, Math.round(height / block));
      var tctx = tiny.getContext('2d');
      tctx.drawImage(source, left, top, width, height, 0, 0, tiny.width, tiny.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, left, top, width, height);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.restore();
  }

  /* —————————————————————— send —————————————————————— */

  function showDone(result) {
    body.hidden = true;
    auth.hidden = true;
    done.hidden = false;
    done.innerHTML =
      '<div class="mf-check">' + ICON.check + '</div>' +
      '<h3>' + t('done', { id: Number(result.ticketId) }) + '</h3>' +
      '<p>' + (result.transcript ? t('transcribed') + ' ' : '') + t('replyInPortal') + '</p>' +
      '<a target="_blank" rel="noopener">' + t('openRequest') + '</a>' +
      '<button type="button">' + t('sendAnother') + '</button>';
    done.querySelector('a').href = result.url || PORTAL + '/portal';
    done.querySelector('button').addEventListener('click', function () {
      done.hidden = true;
      body.hidden = false;
      attachments.forEach(function (attachment) {
        URL.revokeObjectURL(attachment.url);
      });
      attachments = [];
      text.value = '';
      renderFiles();
      setStatus('');
      text.focus();
    });
  }

  function friendlyError(code) {
    switch (code) {
      case 'signed_out':
        return t('signedOut');
      case 'unknown_site':
        return t('unknownSite');
      case 'rate_limited':
        return t('rateLimited');
      case 'file_too_large':
        return t('tooLarge');
      case 'files_unavailable':
        return t('noFiles');
      case 'empty':
        return t('empty');
      default:
        return t('failed');
    }
  }

  async function sendFeedback() {
    if (busy) return;
    if (!token) {
      showAuth();
      return;
    }
    if (!text.value.trim() && !attachments.length) {
      setStatus(t('empty'), 'error');
      return;
    }
    setBusy(true, t('sending'));
    var form = new FormData();
    form.append('token', token);
    form.append('body', text.value.trim());
    form.append('page', location.href);
    form.append('viewport', window.innerWidth + 'x' + window.innerHeight);
    attachments.forEach(function (attachment) {
      form.append('files', attachment.blob, attachment.name);
    });
    try {
      var response = await fetch(API + '/portal/preview-feedback', {
        method: 'POST',
        body: form,
        mode: 'cors',
        credentials: 'omit',
      });
      var data = null;
      try {
        data = await response.json();
      } catch (e) {}
      if (!response.ok) {
        setBusy(false, friendlyError(data && data.error), 'error');
        return;
      }
      setBusy(false, '');
      attachments.forEach(function (attachment) {
        URL.revokeObjectURL(attachment.url);
      });
      attachments = [];
      renderFiles();
      text.value = '';
      showDone(data || {});
    } catch (e) {
      setBusy(false, t('offline'), 'error');
    }
  }

  function showAuth() {
    body.hidden = true;
    auth.hidden = false;
  }

  sendButton.addEventListener('click', sendFeedback);
})();
