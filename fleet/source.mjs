/**
 * The worktree's source files, as the portal stores them for a client's own
 * agent (workspace_files / workspace_read). Content-addressed, text-sized.
 *
 * The list comes from git: the files the commit tracks are the source. A
 * package manager's cache inside the project (pnpm's `.pnpm-store`, npm's
 * `.npm`) is never source, even when the repo forgot to ignore it; walking the
 * folder instead filled the 500-file cap with cache entries and dropped every
 * real file. Without git, the walk skips the same folders.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCE_LIMITS = { files: 500, fileBytes: 512 * 1024, totalBytes: 20 * 1024 * 1024 };

/** Folders that are caches, build state or dependencies, wherever they sit. */
export const NOT_SOURCE = new Set([
  '.git', 'node_modules', '.malipetek-files', '.astro', '.pnpm-store', '.npm', '.yarn', '.cache',
  '.turbo', '.next', '.nuxt', '.svelte-kit', '.vercel', '.netlify', '.wrangler', '.parcel-cache', 'bower_components',
]);

const skipped = (rel, outputRel) => {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some((part) => NOT_SOURCE.has(part))) return true;
  return Boolean(outputRel) && outputRel !== '.' && (rel === outputRel || rel.startsWith(`${outputRel.replace(/\/+$/, '')}/`));
};

/** Tracked paths at HEAD plus staged ones, or null when this is not a git worktree. */
function gitPaths(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function walkPaths(dir) {
  const paths = [];
  const walk = (root, prefix) => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name === '.git') continue; // in a worktree `.git` is a file
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!NOT_SOURCE.has(entry.name)) walk(join(root, entry.name), rel);
      } else if (entry.isFile()) {
        paths.push(rel);
      }
    }
  };
  try { walk(dir, ''); } catch { /* a missing source dir is not fatal */ }
  return paths;
}

/**
 * @param {string} dir - the worktree.
 * @param {string} [outputRel] - the build output folder, which is not source.
 * @returns {{ files: Array<{path: string, sha256: string, size: number, buf: Buffer}>, dropped: number }}
 *   `dropped` counts source files left out because the limits were reached.
 */
export function sourceManifest(dir, outputRel) {
  const candidates = (gitPaths(dir) ?? walkPaths(dir))
    .filter((rel) => !skipped(rel, outputRel))
    // Shallow files first, so a cap drops deep leaves, never the config and pages.
    .sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0));
  const files = [];
  let total = 0;
  let dropped = 0;
  for (const rel of candidates) {
    let buf;
    try {
      if (!statSync(join(dir, rel)).isFile()) continue;
      buf = readFileSync(join(dir, rel));
    } catch {
      continue; // listed by git but deleted in the worktree
    }
    if (buf.length > SOURCE_LIMITS.fileBytes || buf.subarray(0, 4096).includes(0)) continue;
    if (files.length >= SOURCE_LIMITS.files || total + buf.length > SOURCE_LIMITS.totalBytes) { dropped += 1; continue; }
    total += buf.length;
    files.push({ path: rel, sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length, buf });
  }
  return { files, dropped };
}
