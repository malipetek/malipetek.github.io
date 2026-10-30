#!/usr/bin/env node
/*
 * Move run sessions into the workspace they belong to.
 *
 * A workspace owns an ordered `sessionIds` array in
 * ~/.dsh/storages/workspace.json; a session in none of them is "Ungrouped".
 * A run's session lives in a throwaway worktree directory, so it never gets
 * accounted to a workspace — this maps slug -> project folder (the node's own
 * table), finds that folder's workspace, and moves the ids.
 *
 *   node tools/relink-sessions.mjs           dry run
 *   node tools/relink-sessions.mjs --apply   backup, write, validate
 *
 * Quit the Harness first: it owns this file and would overwrite it.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const apply = process.argv.includes('--apply');
const STORE = join(homedir(), '.dsh/storages/workspace.json');
const NODE = join(homedir(), '.config/malipetek-runner/config.json');
const SESSIONS = join(homedir(), '.dsh/sessions');

const store = JSON.parse(readFileSync(STORE, 'utf8'));
const projects = JSON.parse(readFileSync(NODE, 'utf8')).projects ?? {};
const workspaces = store.tables?.workspaces ?? {};

const norm = (p) => String(p ?? '').replace(/\/+$/, '');
const pathFor = (slug) => norm(typeof projects[slug] === 'string' ? projects[slug] : projects[slug]?.path);

// One workspace per project folder.
const byPath = new Map();
for (const [id, w] of Object.entries(workspaces)) byPath.set(norm(w.path), id);

// Run sessions: <...>-worktrees-<slug>-(task|ticket)-<n>[-run<k>]--
const found = new Map(); // workspaceId -> [sessionId]
const unmatched = [];
for (const dir of readdirSync(SESSIONS)) {
  const m = /-worktrees-(.+?)-(task|ticket)-(\d+)(?:-run\d+)?--$/.exec(dir);
  if (!m) continue;
  const slug = m[1];
  const target = byPath.get(pathFor(slug));
  const ids = readdirSync(join(SESSIONS, dir)).filter((n) => n.startsWith('session-'));
  if (target === undefined) { unmatched.push({ slug, sessions: ids.length }); continue; }
  if (!found.has(target)) found.set(target, []);
  found.get(target).push(...ids);
}

let moved = 0, dupes = 0;
const plan = [];
for (const [wsId, ids] of found) {
  const ws = workspaces[wsId];
  const have = new Set(ws.sessionIds ?? []);
  const add = [];
  for (const id of ids) {
    if (have.has(id)) { dupes += 1; continue; }
    have.add(id); add.push(id);
  }
  // Drop ids that live in more than one workspace, keeping this one.
  for (const [otherId, other] of Object.entries(workspaces)) {
    if (otherId === wsId || !other.sessionIds) continue;
    const before = other.sessionIds.length;
    other.sessionIds = other.sessionIds.filter((id) => !add.includes(id));
    dupes += before - other.sessionIds.length;
  }
  moved += add.length;
  plan.push({ workspace: ws.title?.slice(0, 30) ?? wsId.slice(0, 8), path: norm(ws.path).split('/').slice(-2).join('/'), add: add.length, total: (ws.sessionIds?.length ?? 0) + add.length });
  if (apply && add.length) ws.sessionIds = [...(ws.sessionIds ?? []), ...add];
}

console.table(plan);
console.log(`sessions to add: ${moved} · duplicates removed: ${dupes} · unmatched projects: ${unmatched.length}`);
for (const u of unmatched) console.log(`  unmatched: ${u.slug} (${u.sessions} sessions)`);

if (!apply) { console.log('\ndry run — nothing written. Rerun with --apply (Harness quit) to write.'); }
else {
  const backup = `${STORE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(STORE, backup);
  writeFileSync(STORE, JSON.stringify(store, null, '\t'));
  JSON.parse(readFileSync(STORE, 'utf8'));
  console.log(`\nwritten. backup: ${backup}`);
}
