/* Chat backend seam.
 *
 * Two modes:
 *   1. Live — PUBLIC_CHAT_ENDPOINT is set: stream from the Cloudflare Worker
 *      (worker/), which proxies an OpenRouter model and emits SSE. Turnstile is loaded
 *      lazily and only when PUBLIC_TURNSTILE_SITEKEY is configured.
 *   2. Offline — no endpoint: a local ruleset answers from FACTS, streams
 *      word-chunks, and emits the same `handoff` signal, so `pnpm dev` works
 *      with zero setup.
 *
 * Both modes speak the same vocabulary: `{ type: 'chunk', text }` then
 * `{ type: 'end', kind, handoff }`.
 */

const ENDPOINT = String(import.meta.env.PUBLIC_CHAT_ENDPOINT || '').replace(/\/+$/, '');
const TURNSTILE_SITEKEY = String(import.meta.env.PUBLIC_TURNSTILE_SITEKEY || '');

export const hasBackend = Boolean(ENDPOINT);

/* ————————————————————— live mode ————————————————————— */

// Short-lived session token issued by the Worker after the first Turnstile
// check. Sent back as `x-session` so we don't re-run Turnstile every message.
let sessionToken = null;

let turnstileScript = null;
let turnstileWidget = null;
let resolveToken = null;

/** Inject the Turnstile script once, and only when a site key is configured. */
function loadTurnstile() {
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise((resolve, reject) => {
    if (!TURNSTILE_SITEKEY) return reject(new Error('no turnstile sitekey'));
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.appendChild(script);
  });
  return turnstileScript;
}

/** Return a fresh Turnstile token, or '' when Turnstile is not configured. */
export async function getTurnstileToken() {
  if (!TURNSTILE_SITEKEY) return '';
  const turnstile = await loadTurnstile();

  if (turnstileWidget === null) {
    const container = document.createElement('div');
    container.style.display = 'none';
    document.body.appendChild(container);
    turnstileWidget = turnstile.render(container, {
      sitekey: TURNSTILE_SITEKEY,
      size: 'invisible',
      callback: (token) => {
        resolveToken?.(token);
        resolveToken = null;
      },
      'error-callback': () => {
        resolveToken?.('');
        resolveToken = null;
      },
    });
  }

  return new Promise((resolve) => {
    resolveToken = resolve;
    try {
      turnstile.execute(turnstileWidget);
    } catch {
      resolve('');
    }
  });
}

function authHeaders() {
  const headers = { 'content-type': 'application/json' };
  if (sessionToken) headers['x-session'] = sessionToken;
  return headers;
}

/** Parse an SSE body, yielding our chunk/end events. */
async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === 'chunk') yield { type: 'chunk', text: event.text };
      else if (event.type === 'end') {
        yield { type: 'end', kind: event.kind, handoff: event.handoff ?? null };
        return;
      }
    }
  }
  yield { type: 'end', kind: 'answer', handoff: null };
}

/**
 * Live streaming call. Retries once if the session token was stale (403),
 * re-acquiring a Turnstile token on the retry.
 */
async function* liveStream(text, history, signal) {
  const messages = history
    .filter((m) => m && m.text)
    .map((m) => ({ role: m.role === 'me' ? 'user' : 'assistant', content: String(m.text) }));
  messages.push({ role: 'user', content: String(text) });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = authHeaders();
    let turnstileToken = '';
    if (!sessionToken) {
      try {
        turnstileToken = await getTurnstileToken();
      } catch {
        turnstileToken = '';
      }
    }

    let response;
    try {
      response = await fetch(`${ENDPOINT}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages, turnstileToken }),
        signal,
      });
    } catch {
      if (signal?.aborted) return;
      yield { type: 'end', kind: 'error', handoff: null };
      return;
    }

    if (response.status === 429) {
      yield { type: 'end', kind: 'rate', handoff: null };
      return;
    }
    if (response.status === 403 && attempt === 0) {
      sessionToken = null;
      continue;
    }
    if (!response.ok || !response.body) {
      yield { type: 'end', kind: 'error', handoff: null };
      return;
    }

    const issued = response.headers.get('x-intercom-session');
    if (issued) sessionToken = issued;

    yield* readSse(response.body);
    return;
  }
}

/**
 * Async generator: streams the reply as chunks, then a final `end` event
 * carrying the kind and (for handoffs) the editable summary.
 */
export async function* streamAnswer(text, history = [], { signal } = {}) {
  if (ENDPOINT) {
    yield* liveStream(text, history, signal);
    return;
  }
  yield* mockStream(text, history, signal);
}

/**
 * Send the handoff card. Falls back to a simulated success when offline.
 * Throws on a real delivery failure so the UI can show its error state.
 */
export async function sendHandoff({ email, message, summary }) {
  if (!ENDPOINT) {
    await delay(480);
    return { ok: true, mock: true };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = authHeaders();
    let turnstileToken = '';
    if (!sessionToken) {
      try {
        turnstileToken = await getTurnstileToken();
      } catch {
        turnstileToken = '';
      }
    }

    const response = await fetch(`${ENDPOINT}/handoff`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, message, summary, turnstileToken }),
    });

    if (response.status === 403 && attempt === 0) {
      sessionToken = null;
      continue;
    }
    if (!response.ok) throw new Error(`handoff failed (${response.status})`);
    return response.json().catch(() => ({ ok: true }));
  }
  throw new Error('handoff failed');
}

/* ————————————————————— offline mock ————————————————————— */

const FACTS = {
  who: 'Muhammet Ali Petek — full-stack dev since 2017. Node plus whatever the project needs. I write the code, delete it, and rewrite it better.',
  stack: 'Node, Svelte/SvelteKit, Shopify (Plus, checkout.liquid, apps), Directus, Linux on the desk. Cheap and open-source by conviction.',
  svelte: 'I love Svelte. This site is Astro — the better fit for a mostly-static site. SvelteKit is still the pick for app work.',
  shopify: 'Years of Shopify: Plus migrations, Dawn-based themes, custom apps, checkout.liquid before they took it away. See /experience for the damage.',
  linux: 'Daily drove Linux Mint for years — Cinnamon then XFCE. The blog has the scars: GPU configs, xrandr scripts, ocamlfuse mounts.',
  work: 'Customily → TRUTH NYC → PAX Digital → Bemeir. Mostly e-commerce, mostly Shopify, always the weird integration nobody else wanted.',
  built: 'Shopify apps, small games, and the tools he wished existed. The shelf lists them — see the top of this page.',
  hire: 'Not taking new contracts right now, but notes still get read. Say what you are building and it reaches me.',
  astro: 'This site is Astro — static, cheap, no runtime. The blog and the work record are the interesting parts.',
  bot: 'I am a local ruleset standing in for Ali until the real assistant is wired up. Honest about what I do not know.',
};

const RULES = [
  [/who|muhammet|petek|your name/i, FACTS.who],
  [/stack|tech|tools?|framework/i, FACTS.stack],
  [/svelte/i, FACTS.svelte],
  [/astro/i, FACTS.astro],
  [/shopify|e-?commerce|theme/i, FACTS.shopify],
  [/linux|mint|xfce|ubuntu|debian/i, FACTS.linux],
  [/work|experience|job|agency|career/i, FACTS.work],
  [/built|built\?|projects?|shelf|made|shipped/i, FACTS.built],
  [/bot|chat|ai|robot|who are you/i, FACTS.bot],
  [/blog|post|wrote|writing|article/i, 'Seven entries in the log — Linux wounds, Shopify tricks, one Svelte hydration mystery. The full index is under Writing.'],
  [/hello|hi|hey|selam/i, 'Hey. I know Ali\u2019s work — ask about the stack, Shopify, Linux, or how to reach him.'],
  [/thank|thx|tesekkur/i, 'Noted. Rare politeness appreciated.'],
  [/joke/i, 'I once deleted a working module just to prove I could rewrite it. The joke is that it worked.'],
];

const FALLBACKS = [
  'I only know so much — try "stack", "shopify", "linux", "hire", or "who".',
  'Filed under: things to ask Ali. Meanwhile — "stack" or "experience" might cover it.',
  'No note on that. "who", "work", "stack", "blog" are safe bets.',
];

// A visitor who wants to reach Ali gets a handoff instead of a canned answer.
// This is checked before RULES so "hire" doesn't just return a fact.
const HANDOFF_RE =
  /\b(hire|hiring|work\s+(?:with|together)|collaborat\w*|contract|freelance|get\s+in\s+touch|reach\s+out|contact|available\s+for)\b/i;

// Offline-only sentinels. They let the intercom's error and rate-limited states
// be exercised with zero backend; they are never part of the visible copy.
const ERROR_RE = /^\s*__(?:error|fail)\b/i;
const RATE_RE = /^\s*__(?:rate|limit)\b/i;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** The offline responder: `{ kind, text, summary? }`. */
export async function respond(text, history = []) {
  const t = text.trim();
  await delay(280 + Math.min(t.length * 6, 420));

  if (ERROR_RE.test(t)) return { kind: 'error', text: "Line's down — email instead." };
  if (RATE_RE.test(t))
    return { kind: 'rate', text: 'That is a lot of notes at once. Give it a minute, or email instead.' };
  if (HANDOFF_RE.test(t)) return { kind: 'handoff', text: FACTS.hire, summary: buildSummary(t, history) };

  for (const [re, ans] of RULES) if (re.test(t)) return { kind: 'answer', text: ans };
  return { kind: 'answer', text: FALLBACKS[Math.abs(hash(t)) % FALLBACKS.length] };
}

async function* mockStream(text, history, signal) {
  const res = await respond(text, history);
  if (signal?.aborted) return;
  for (const chunk of chunkText(res.text)) {
    if (signal?.aborted) return;
    yield { type: 'chunk', text: chunk };
  }
  yield { type: 'end', kind: res.kind, handoff: res.summary ?? null };
}

/** Split text into small chunks (two words at a time) for a typing feel. */
export function chunkText(text) {
  const words = String(text).match(/\S+\s*/g) ?? [String(text)];
  const out = [];
  for (let i = 0; i < words.length; i += 2) out.push(words.slice(i, i + 2).join(''));
  return out;
}

function buildSummary(text, history) {
  const prior = history
    .filter((m) => m && m.role === 'me')
    .map((m) => String(m.text).trim())
    .filter(Boolean);
  const lines = [`The visitor wrote: \u201C${text.trim()}\u201D`];
  const first = prior[0];
  if (first && first !== text.trim()) lines.push(`Earlier they asked: \u201C${first}\u201D`);
  lines.push('Reply with a time that works for you.');
  return lines.join(' ');
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
