/**
 * Host half of the Projects panel bundle.
 *
 * The desktop composition mounts the **native** directory picker, which serves
 * `pick()` only — it has no `list` capability — so the browser cannot enumerate
 * a folder outside the workspace through the directory-picker Remote. Instead
 * this half scans the projects folder with Node and writes a small JSONL index
 * that the Client half reads through the session-scoped file Remote.
 *
 * Nothing here is model-facing: it produces one cache file and watches the
 * folder so the index follows adds, renames and removals.
 *
 * @module @malipetek/dsh-projects-panel
 */
import { watch } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * DSH's data root. `DSH_HOME` wins when the launcher sets it, `~/.dsh` is the
 * default. The Client half cannot read the environment, so it rebuilds this
 * same path from the Host home published on the Remote host facts.
 */
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');

/**
 * The folder the panel browses. `DSH_PROJECTS_ROOT` overrides it; the
 * `~/Documents/Documents/Projects` default is the author's own layout, so set
 * the override instead of editing this line.
 */
const PROJECTS_ROOT = process.env.DSH_PROJECTS_ROOT || join(homedir(), 'Documents', 'Documents', 'Projects');

/** Where the generated JSONL index lives; the Client rebuilds this path too. */
const STATE_DIR = process.env.DSH_PROJECTS_PANEL_DIR || join(DSH_HOME, 'projects-panel');
const INDEX_PATH = join(STATE_DIR, 'index.jsonl');

/** Re-scan cadence: activity inside an existing project fires no watch event. */
const RESCAN_INTERVAL_MS = 5 * 60 * 1000;

/** Collapse a burst of watch events into one rebuild. */
const WATCH_DEBOUNCE_MS = 500;

/**
 * Modification time of a path, or 0 when it does not exist or cannot be read.
 * @param target - absolute path to stat.
 * @returns epoch milliseconds, or 0.
 */
async function mtimeOf(target) {
  try {
    return (await stat(target)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * A one-line description for a project, preferring its package manifest.
 * @param projectPath - absolute project directory.
 * @returns the manifest description, else its name, else an empty string.
 */
async function descriptionOf(projectPath) {
  try {
    const raw = await readFile(join(projectPath, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.description === 'string' && parsed.description.trim().length > 0) return parsed.description.trim();
    if (typeof parsed?.name === 'string' && parsed.name.trim().length > 0) return parsed.name.trim();
  } catch {
    // No readable package manifest: fall through to no description.
  }
  return '';
}

/**
 * Build one index record for a project directory.
 *
 * `lastActivity` is the newest of the directory itself and the cheap
 * activity markers inside it, because editing a file in place does not move its
 * parent directory's mtime. A project with no markers falls back to its
 * directory mtime.
 *
 * @param name - the directory name.
 * @param projectPath - its absolute path.
 * @returns the index record.
 */
async function describe(name, projectPath) {
  const [directory, gitIndex, gitHead, manifest] = await Promise.all([
    mtimeOf(projectPath),
    mtimeOf(join(projectPath, '.git', 'index')),
    mtimeOf(join(projectPath, '.git', 'HEAD')),
    mtimeOf(join(projectPath, 'package.json')),
  ]);
  const isGit = gitIndex > 0 || gitHead > 0;
  return {
    name,
    path: projectPath,
    hidden: name.startsWith('.'),
    isGit,
    description: await descriptionOf(projectPath),
    lastActivity: Math.max(directory, gitIndex, gitHead, manifest),
  };
}

/**
 * Scan the projects folder and rewrite the index atomically enough for a read
 * to see either the old file or the new one.
 * @returns nothing; failures are reported and leave the previous index in place.
 */
async function writeIndex() {
  try {
    const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
    const records = [];
    for (const entry of candidates) {
      try {
        records.push(await describe(entry.name, join(PROJECTS_ROOT, entry.name)));
      } catch (error) {
        console.warn(`[projects-panel] skipped ${entry.name}:`, error);
      }
    }
    records.sort((left, right) => left.name.localeCompare(right.name));
    await mkdir(dirname(INDEX_PATH), { recursive: true });
    await writeFile(INDEX_PATH, records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    console.log(`[projects-panel] indexed ${records.length} projects -> ${INDEX_PATH}`);
  } catch (error) {
    console.warn('[projects-panel] index build failed:', error);
  }
}

/**
 * Build the index once, then keep it fresh from a folder watch and a slow
 * re-scan, and tear all of it down with the plugin.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => {
    void writeIndex();

    let debounce;
    const schedule = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { void writeIndex(); }, WATCH_DEBOUNCE_MS);
    };

    let watcher = null;
    try {
      watcher = watch(PROJECTS_ROOT, { persistent: false }, schedule);
    } catch (error) {
      console.warn('[projects-panel] cannot watch the projects folder:', error);
    }

    const interval = setInterval(() => { void writeIndex(); }, RESCAN_INTERVAL_MS);
    if (typeof interval.unref === 'function') interval.unref();

    return () => {
      clearTimeout(debounce);
      clearInterval(interval);
      try {
        watcher?.close();
      } catch {
        // Already closed; nothing to release.
      }
    };
  }, 'projects-panel: projects index');
}
