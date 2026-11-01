/*
 * Deploying a site into the client's own Cloudflare account.
 *
 * Cloudflare's static-assets upload is three calls (docs: Workers → Static
 * assets → Direct uploads):
 *
 *   1. POST …/workers/scripts/{script}/assets-upload-session
 *        a manifest of { path: { hash, size } }; the answer names the hashes
 *        Cloudflare still lacks and a short-lived upload JWT.
 *   2. POST …/workers/assets/upload?base64=true
 *        each missing hash as a base64 part, with the part's Content-Type.
 *        The last answer carries the completion JWT.
 *   3. PUT …/workers/scripts/{script}  (multipart)
 *        a tiny Worker that serves `env.ASSETS`, plus `assets.jwt`.
 *
 * We mirror the same immutable deploy that lives in R2, so our copy remains
 * the source of truth: if the client's grant lapses, their site can fall back
 * to malipetek.online without rebuilding anything.
 */
import { apiBase, cloudflareAccess } from './cfaccess.ts';
import { type Env } from './shared.ts';

/** A mirror is best-effort; these bounds keep one deploy from eating the Worker. */
export const CLOUDFLARE_MIRROR_LIMITS = {
  files: 500,
  totalBytes: 25 * 1024 * 1024,
};

const COMPATIBILITY_DATE = '2026-01-01';

/*
 * A mirrored preview gets the same feedback launcher as one on
 * malipetek.online. Mirrors are uploaded ahead of time, so unlike our own
 * host this cannot be injected at serve time: the HTML is rewritten here, on
 * the preview channel only. The script is loaded from the portal because the
 * client's Worker has no copy of it.
 */
const FEEDBACK_SCRIPT = 'https://malipetek.dev/preview-feedback.js?v=1';
const FEEDBACK_API = 'https://malipetek.dev/api';

function injectFeedback(html: string, slug: string): string {
  if (html.includes('data-malipetek-feedback')) return html;
  const tag = `<script src="${FEEDBACK_SCRIPT}" data-slug="${slug}" data-api="${FEEDBACK_API}" data-malipetek-feedback="1" defer></script>`;
  const end = html.toLowerCase().lastIndexOf('</body>');
  return end === -1 ? html + tag : html.slice(0, end) + tag + html.slice(end);
}

/** A Worker that does nothing but hand requests to its static assets. */
const ASSET_WORKER = `export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
`;

export interface DeployFile {
  path: string;
  sha: string;
  size: number;
  type?: string;
}

export interface MirrorResult {
  script: string;
  url: string;
  files: number;
  bytes: number;
}

type CfReply<T> = { success?: boolean; result?: T; errors?: { message?: string; code?: number }[] };

function cfError(reply: CfReply<unknown> | null, status: number): string {
  const first = reply?.errors?.[0];
  return first?.message ? `${first.message} (${first.code ?? status})` : `Cloudflare answered ${status}`;
}

// The API base may come from an env override in tests, so every call takes the
// base from the caller instead of a module constant.
async function call<T>(
  env: Env,
  token: string,
  method: string,
  path: string,
  body?: BodyInit,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: CfReply<T> | null }> {
  const res = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => null)) as CfReply<T> | null;
  return { ok: res.ok, status: res.status, data };
}

/* ——————————————————————— bytes and hashes ——————————————————————— */

const encoder = new TextEncoder();

/** Chunked, because `String.fromCharCode(...bigArray)` overflows the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Cloudflare's asset key: the first 32 hex of sha256(base64(content) + ext).
 * The extension is part of it because Cloudflare infers the content type from
 * it — the same bytes under a different extension are a different asset.
 */
async function assetHash(base64: string, path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${base64}${extensionOf(path)}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

interface PreparedFile {
  path: string;
  hash: string;
  type: string;
  base64: string;
  size: number;
}

async function readDeployFiles(
  env: Env,
  slug: string,
  files: DeployFile[],
  channel: 'preview' | 'production',
): Promise<PreparedFile[]> {
  if (!env.SITES) throw new Error('site storage is not configured');
  if (files.length > CLOUDFLARE_MIRROR_LIMITS.files) {
    throw new Error(`this site has ${files.length} files; the Cloudflare mirror takes at most ${CLOUDFLARE_MIRROR_LIMITS.files}`);
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > CLOUDFLARE_MIRROR_LIMITS.totalBytes) {
    throw new Error(`this site is ${Math.round(total / 1024 / 1024)} MB; the Cloudflare mirror takes at most 25 MB`);
  }
  const out: PreparedFile[] = [];
  for (const file of files) {
    const object = await env.SITES.get(`sites/${slug}/blobs/${file.sha}`);
    if (!object) throw new Error(`the deploy is missing ${file.path}`);
    let bytes: Uint8Array = new Uint8Array(await object.arrayBuffer());
    if (channel === 'preview' && /\.html?$/i.test(file.path)) {
      bytes = new TextEncoder().encode(injectFeedback(new TextDecoder().decode(bytes), slug));
    }
    const base64 = bytesToBase64(bytes);
    out.push({
      path: file.path.replace(/^\/+/, ''),
      hash: await assetHash(base64, file.path),
      type: file.type || 'application/octet-stream',
      base64,
      size: bytes.byteLength,
    });
  }
  return out;
}

/* ——————————————————————— the three calls ——————————————————————— */

export function cloudflareScriptName(slug: string, channel: 'preview' | 'production'): string {
  const base = `malipetek-${slug}`.slice(0, 52).replace(/-+$/, '');
  return channel === 'preview' ? `${base}-preview` : base;
}

interface UploadSession {
  jwt?: string;
  buckets?: string[][];
}

async function uploadAssets(
  env: Env,
  token: string,
  accountId: string,
  script: string,
  files: PreparedFile[],
): Promise<string> {
  const manifest: Record<string, { hash: string; size: number }> = {};
  for (const file of files) manifest[`/${file.path}`] = { hash: file.hash, size: file.size };
  const byHash = new Map(files.map((f) => [f.hash, f]));

  const session = await call<UploadSession>(env, token, 'POST', `/accounts/${accountId}/workers/scripts/${script}/assets-upload-session`, JSON.stringify({ manifest }), {
    'content-type': 'application/json',
  });
  if (!session.ok || !session.data?.result?.jwt) {
    throw new Error(`Cloudflare would not start the upload: ${cfError(session.data, session.status)}`);
  }
  const uploadJwt = session.data.result.jwt;
  const buckets = session.data.result.buckets ?? [];
  if (!buckets.length) return uploadJwt; // every asset was already there

  let completion = uploadJwt;
  for (const bucket of buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const file = byHash.get(hash);
      if (!file) continue;
      // `base64=true` means the part's bytes are base64 text; the part's
      // Content-Type is what Cloudflare serves later.
      form.append(hash, new Blob([file.base64], { type: file.type }), file.path.split('/').pop() || hash);
    }
    const uploaded = await call<{ jwt?: string }>(env, uploadJwt, 'POST', `/accounts/${accountId}/workers/assets/upload?base64=true`, form);
    if (!uploaded.ok) throw new Error(`Cloudflare refused an asset: ${cfError(uploaded.data, uploaded.status)}`);
    if (uploaded.data?.result?.jwt) completion = uploaded.data.result.jwt;
  }
  return completion;
}

async function uploadScript(
  env: Env,
  token: string,
  accountId: string,
  script: string,
  completion: string,
  spa: boolean,
): Promise<void> {
  const metadata = {
    main_module: 'worker.mjs',
    compatibility_date: COMPATIBILITY_DATE,
    assets: {
      jwt: completion,
      config: {
        html_handling: 'auto-trailing-slash',
        not_found_handling: spa ? 'single-page-application' : '404-page',
      },
    },
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
  form.append('worker.mjs', new Blob([ASSET_WORKER], { type: 'application/javascript+module' }), 'worker.mjs');
  const put = await call(env, token, 'PUT', `/accounts/${accountId}/workers/scripts/${script}`, form);
  if (!put.ok) throw new Error(`Cloudflare would not deploy ${script}: ${cfError(put.data, put.status)}`);

  // A script is not reachable on workers.dev until its subdomain is enabled.
  // Best effort: a failure here still leaves the version deployed.
  await call(env, token, 'POST', `/accounts/${accountId}/workers/scripts/${script}/subdomain`, JSON.stringify({ enabled: true }), {
    'content-type': 'application/json',
  }).catch(() => null);
}

async function workersDevUrl(env: Env, token: string, accountId: string, script: string): Promise<string> {
  const found = await call<{ subdomain?: string }>(env, token, 'GET', `/accounts/${accountId}/workers/subdomain`);
  const subdomain = found.data?.result?.subdomain;
  if (!subdomain) {
    throw new Error('this Cloudflare account has no workers.dev subdomain; enable one in Cloudflare, then try again');
  }
  return `https://${script}.${subdomain}.workers.dev`;
}

/* ——————————————————————— the public call ——————————————————————— */

/**
 * Copy one immutable deploy into the client's account. Throws with a sentence
 * the portal can show; the caller records it and keeps our copy working.
 */
export async function mirrorDeploy(
  env: Env,
  opts: {
    connectionId: number;
    accountId: string;
    slug: string;
    channel: 'preview' | 'production';
    files: DeployFile[];
    spa: boolean;
  },
): Promise<MirrorResult> {
  const token = await cloudflareAccess(env, opts.connectionId);
  if (!token) throw new Error('the Cloudflare connection has expired; reconnect it in Connections');

  const prepared = await readDeployFiles(env, opts.slug, opts.files, opts.channel);
  const script = cloudflareScriptName(opts.slug, opts.channel);
  const completion = await uploadAssets(env, token, opts.accountId, script, prepared);
  await uploadScript(env, token, opts.accountId, script, completion, opts.spa);
  const url = await workersDevUrl(env, token, opts.accountId, script);
  return { script, url, files: prepared.length, bytes: prepared.reduce((n, f) => n + f.size, 0) };
}
