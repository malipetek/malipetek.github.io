/*
 * Response headers for the static site, written as `dist/_headers` after every
 * build (Workers static assets apply that file to the responses it serves).
 *
 * The portal keeps a 30-day session token in localStorage, so its pages get a
 * Content-Security-Policy. Its point is less "no inline script" than "nowhere
 * to send a stolen token": scripts only from this origin and Turnstile, fetches
 * only to this origin, the portal Worker and Turnstile, no framing.
 *
 * Inline scripts are allowed by hash, and the hashes are computed here from the
 * HTML this build just produced — a hard-coded list would break the portal on
 * the first edit to the layout's theme snippet. Styles keep 'unsafe-inline':
 * the views set `style` attributes, and a style cannot carry a token anywhere
 * that `img-src`/`connect-src` do not already block.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TURNSTILE = 'https://challenges.cloudflare.com';

/**
 * A PUBLIC_ variable as `astro build` saw it: the shell first, then the env
 * files in Vite's order for the production mode.
 */
function publicEnv(name) {
  if (process.env[name] !== undefined) return process.env[name];
  for (const file of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith(`${name}=`));
    if (line !== undefined) return line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

function htmlFiles(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(htmlFiles(path));
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

/** sha256 sources for every inline <script> (no src) in these files. */
export function inlineScriptHashes(files) {
  const hashes = new Set();
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(m[1]) || /type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1])) continue;
      hashes.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes].sort();
}

export function portalPolicy({ hashes, endpoint }) {
  const connect = ["'self'", endpoint, TURNSTILE].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')} ${TURNSTILE}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    `frame-src ${TURNSTILE}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export default function portalHeaders() {
  return {
    name: 'portal-headers',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const portalDir = join(root, 'portal');
        const files = htmlFiles(portalDir);
        if (!files.length) throw new Error(`portal-headers: no HTML under ${portalDir}`);
        const raw = String(publicEnv('PUBLIC_CHAT_ENDPOINT')).replace(/\/+$/, '');
        const endpoint = raw ? new URL(raw).origin : '';
        const policy = portalPolicy({ hashes: inlineScriptHashes(files), endpoint });
        const text = [
          '# Written by src/integrations/portalHeaders.mjs on every build. Do not edit.',
          '/*',
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: strict-origin-when-cross-origin',
          '  Strict-Transport-Security: max-age=31536000',
          '/portal',
          `  Content-Security-Policy: ${policy}`,
          '  X-Frame-Options: DENY',
          '/portal/*',
          `  Content-Security-Policy: ${policy}`,
          '  X-Frame-Options: DENY',
          '',
        ].join('\n');
        writeFileSync(join(root, '_headers'), text);
        logger.info(`wrote _headers: ${files.length} portal pages, connect-src ${endpoint || '(no endpoint)'}`);
      },
    },
  };
}
