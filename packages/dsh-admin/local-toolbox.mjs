/**
 * Local toolbox: the agent skills and MCP servers on the admin's own machine.
 *
 * Fleet agents (Claude Code, OpenCode and the DeepSeek Harness) read these
 * files, so Settings → "This machine's tools" lists and edits them without
 * anyone opening a config file by hand:
 *
 *  - `~/.claude.json` top-level `mcpServers` (Claude Code's user-scope MCP) and
 *    the sibling `_ptechDisabledMcpServers` this module moves entries into to
 *    disable them (Claude Code has no per-server enabled flag at user scope);
 *  - `~/.claude/skills/<name>/SKILL.md` (user skills) and
 *    `~/.claude/plugins/**\/skills/<name>/SKILL.md` (plugin skills);
 *  - `~/.config/opencode/opencode.json` (or `opencode.jsonc`) key `mcp`;
 *  - `~/.dsh/plugins` entries (directories or symlinks).
 *
 * Secrets never leave: env and header values are dropped, only their key names
 * are shown. Every write reads the file fresh, saves a timestamped backup
 * (`<file>.bak-ptech-<ts>`, the last three are kept) and replaces the file
 * atomically, preserving all other keys and the file mode.
 *
 * No dependencies: the Host loads this module directly.
 *
 * @module @malipetek/dsh-admin/local-toolbox
 */
import { copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** Names of MCP servers the two configs accept, identical to what both tools allow. */
const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
/** Where Claude Code's user-scope MCP entries go when disabled. */
const DISABLED_KEY = '_ptechDisabledMcpServers';
const MAX_BACKUPS = 3;
/** Skill frontmatter is tiny; never read a whole book because a path was odd. */
const MAX_SKILL_BYTES = 512 * 1024;
/** How deep under ~/.claude/plugins a marketplace may nest its skills. */
const PLUGIN_SKILL_DEPTH = 4;
const TARGETS = new Set(['claude', 'opencode']);

const bad = (message) => Object.assign(new Error(message), { code: 'bad_call' });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exists = (path) => stat(path).then(() => true, () => false);
const byName = (a, b) => a.name.localeCompare(b.name);
/** Env/header keys only: the values are secrets and are never returned. */
const keysOf = (value) => (isObject(value) ? Object.keys(value).filter((key) => typeof key === 'string') : []);

const pad = (number, width = 2) => String(number).padStart(width, '0');

/** A backup timestamp that sorts and never collides inside one second. */
function timestamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${pad(date.getMilliseconds(), 3)}`;
}

function claudePaths(home) {
  return { config: join(home, '.claude.json'), skills: join(home, '.claude', 'skills'), plugins: join(home, '.claude', 'plugins') };
}

function opencodePaths(home) {
  const dir = join(home, '.config', 'opencode');
  return { dir, json: join(dir, 'opencode.json'), jsonc: join(dir, 'opencode.jsonc') };
}

/* ------------------------------------------------------------------ JSONC */

/**
 * Strip `//` and `/* *\/` comments from JSONC, leaving strings alone.
 * A `//` inside `"https://…"` is text, and a quote inside a comment is not a
 * string start — both are the traps this scanner exists for.
 */
function stripJsonComments(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\' && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Drop trailing commas before `}`/`]`, which JSONC allows and JSON does not. */
function stripTrailingCommas(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === '\\' && text[i + 1] !== undefined) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      i += 1;
      continue;
    }
    if (char === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === '}' || text[j] === ']') {
        i += 1;
        continue;
      }
    }
    out += char;
    i += 1;
  }
  return out;
}

/**
 * Parse OpenCode's config dialect: JSON plus comments and trailing commas.
 * Exported because the rules are worth testing on their own.
 * @param {string} text
 */
export function parseJsonc(text) {
  if (typeof text !== 'string') throw bad('Expected JSONC text.');
  const cleaned = stripTrailingCommas(stripJsonComments(text.replace(/^\uFEFF/, '')));
  return JSON.parse(cleaned);
}

/* -------------------------------------------------------------- frontmatter */

/** Undo the two YAML quotes a skill description may use. */
function unquote(value) {
  const quote = value[0];
  const end = value.lastIndexOf(quote);
  if (end <= 0) return value.replace(/^["']|["']$/g, '');
  const inner = value.slice(1, end);
  if (quote === "'") return inner.replace(/''/g, "'");
  const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  return inner.replace(/\\(["\\/bfnrt])/g, (_, code) => escapes[code]);
}

/**
 * A deliberately tiny YAML frontmatter reader: top-level `key: value`, quoted
 * values and `|`/`>` blocks, which is what SKILL.md files actually use. Nested
 * mappings are skipped — `name` and `description` are all this module needs.
 */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const fields = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s/.test(line) || line.trimStart().startsWith('#')) {
      i += 1;
      continue;
    }
    const pair = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) {
      i += 1;
      continue;
    }
    const [, key, rest] = pair;
    i += 1;
    const block = /^([|>])[+-]?$/.exec(rest.trim());
    if (block) {
      const folded = block[1] === '>';
      const parts = [];
      while (i < lines.length && (lines[i].trim() === '' || /^\s/.test(lines[i]))) {
        parts.push(lines[i].replace(/^\s+/, ''));
        i += 1;
      }
      while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
      fields[key] = folded ? parts.join(' ') : parts.join('\n');
      continue;
    }
    if (/^["']/.test(rest)) {
      fields[key] = unquote(rest);
      continue;
    }
    // A plain scalar may continue on indented lines; fold them like YAML does.
    const parts = [rest.trim()];
    while (i < lines.length && lines[i].trim() && /^\s/.test(lines[i])) {
      parts.push(lines[i].trim());
      i += 1;
    }
    fields[key] = parts.join(' ').trim();
  }
  return fields;
}

/**
 * Read one SKILL.md. A missing file is not an error (the folder is not a
 * skill); a file without frontmatter still counts, with its name from the
 * folder and no description.
 */
async function readSkill(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR') return null;
    throw error;
  }
  const front = parseFrontmatter(text.slice(0, MAX_SKILL_BYTES));
  return {
    name: typeof front.name === 'string' && front.name.trim() ? front.name.trim() : '',
    description: typeof front.description === 'string' ? front.description.trim() : '',
  };
}

async function readdirOr(path, warnings) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') warnings.push(`Could not read ${path}: ${error.message}`);
    return [];
  }
}

/* -------------------------------------------------------------- Claude Code */

/** One Claude Code MCP entry, normalized; env/header values are dropped. */
function claudeServer(name, entry, disabled, warnings) {
  if (!isObject(entry)) {
    warnings.push(`Claude Code MCP server “${name}” is not an object and was skipped.`);
    return null;
  }
  const type = ['stdio', 'http', 'sse'].includes(entry.type) ? entry.type : typeof entry.url === 'string' && entry.url ? 'http' : 'stdio';
  const view = { name, type };
  if (type === 'stdio') {
    if (typeof entry.command === 'string' && entry.command) view.command = entry.command;
    else warnings.push(`Claude Code MCP server “${name}” has no command.`);
    if (Array.isArray(entry.args)) view.args = entry.args.map(String);
  } else if (typeof entry.url === 'string' && entry.url) {
    view.url = entry.url;
  } else {
    warnings.push(`Claude Code MCP server “${name}” has no URL.`);
  }
  const envKeys = keysOf(entry.env);
  if (envKeys.length > 0) view.envKeys = envKeys;
  const headerKeys = keysOf(entry.headers);
  if (headerKeys.length > 0) view.headerKeys = headerKeys;
  if (disabled) view.disabled = true;
  view.scope = 'user';
  return view;
}

async function readClaudeConfig(home, warnings) {
  const paths = claudePaths(home);
  let text;
  try {
    text = await readFile(paths.config, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { paths, exists: false, value: {} };
    warnings.push(`Could not read ${paths.config}: ${error.message}`);
    return { paths, exists: false, value: {} };
  }
  try {
    const value = JSON.parse(text);
    if (!isObject(value)) {
      warnings.push(`${basename(paths.config)} is not a JSON object.`);
      return { paths, exists: true, value: {} };
    }
    return { paths, exists: true, value };
  } catch (error) {
    warnings.push(`${basename(paths.config)} is not valid JSON: ${error.message}`);
    return { paths, exists: true, value: {} };
  }
}

async function listClaude(home) {
  const warnings = [];
  const { paths, value: config } = await readClaudeConfig(home, warnings);
  const enabled = isObject(config.mcpServers) ? config.mcpServers : {};
  const disabled = isObject(config[DISABLED_KEY]) ? config[DISABLED_KEY] : {};
  const mcp = [];
  for (const [name, entry] of Object.entries(enabled)) {
    const view = claudeServer(name, entry, false, warnings);
    if (view) mcp.push(view);
  }
  for (const [name, entry] of Object.entries(disabled)) {
    if (Object.hasOwn(enabled, name)) {
      warnings.push(`Claude Code has “${name}” both enabled and disabled; showing the enabled one.`);
      continue;
    }
    const view = claudeServer(name, entry, true, warnings);
    if (view) mcp.push(view);
  }
  mcp.sort(byName);

  const skills = [];
  for (const entry of await readdirOr(paths.skills, warnings)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const file = join(paths.skills, entry.name, 'SKILL.md');
    const skill = await readSkill(file);
    if (!skill) continue;
    skills.push({ name: skill.name || entry.name, description: skill.description, path: file, source: 'user' });
  }
  // Plugin skills: <plugin root>/**/skills/<name>/SKILL.md, depth-limited.
  const walkPlugins = async (dir, level) => {
    for (const entry of await readdirOr(dir, warnings)) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) continue;
      const child = join(dir, entry.name);
      if (entry.name === 'skills') {
        for (const skillEntry of await readdirOr(child, warnings)) {
          if (!skillEntry.isDirectory() && !skillEntry.isSymbolicLink()) continue;
          const file = join(child, skillEntry.name, 'SKILL.md');
          const skill = await readSkill(file);
          if (skill) skills.push({ name: skill.name || skillEntry.name, description: skill.description, path: file, source: 'plugin' });
        }
        continue;
      }
      if (level < PLUGIN_SKILL_DEPTH) await walkPlugins(child, level + 1);
    }
  };
  await walkPlugins(paths.plugins, 0);
  skills.sort(byName);
  return { mcp, skills, warnings };
}

/* ----------------------------------------------------------------- OpenCode */

function commandText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => (typeof part === 'string' ? part : String(part))).join(' ');
  return '';
}

function opencodeServer(name, entry, warnings) {
  const type = entry.type === 'remote' ? 'remote' : entry.type === 'local' ? 'local' : typeof entry.url === 'string' && entry.url ? 'remote' : 'local';
  const view = { name, type, enabled: entry.enabled !== false };
  if (type === 'local') {
    const command = commandText(entry.command);
    if (command) view.command = command;
    else warnings.push(`OpenCode MCP server “${name}” has no command.`);
  } else if (typeof entry.url === 'string' && entry.url) {
    view.url = entry.url;
  } else {
    warnings.push(`OpenCode MCP server “${name}” has no URL.`);
  }
  const envKeys = keysOf(entry.environment ?? entry.env);
  if (envKeys.length > 0) view.envKeys = envKeys;
  const headerKeys = keysOf(entry.headers);
  if (headerKeys.length > 0) view.headerKeys = headerKeys;
  return view;
}

/** The file a read should use: opencode.json wins over opencode.jsonc. */
async function opencodeFile(paths) {
  if (await exists(paths.json)) return paths.json;
  if (await exists(paths.jsonc)) return paths.jsonc;
  return null;
}

async function listOpencode(home) {
  const warnings = [];
  const paths = opencodePaths(home);
  const file = await opencodeFile(paths);
  if (!file) return { mcp: [], configPath: null, warnings };
  let config;
  try {
    config = parseJsonc(await readFile(file, 'utf8'));
  } catch (error) {
    warnings.push(`${basename(file)} could not be parsed: ${error.message}`);
    return { mcp: [], configPath: file, warnings };
  }
  if (!isObject(config)) {
    warnings.push(`${basename(file)} is not a JSON object.`);
    return { mcp: [], configPath: file, warnings };
  }
  const servers = isObject(config.mcp) ? config.mcp : {};
  if (config.mcp !== undefined && !isObject(config.mcp)) warnings.push(`${basename(file)}: “mcp” is not an object.`);
  const mcp = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (!isObject(entry)) {
      warnings.push(`OpenCode MCP server “${name}” is not an object and was skipped.`);
      continue;
    }
    mcp.push(opencodeServer(name, entry, warnings));
  }
  mcp.sort(byName);
  return { mcp, configPath: file, warnings };
}

/* ------------------------------------------------------------------- Harness */

async function listHarness(home) {
  const warnings = [];
  const dir = join(home, '.dsh', 'plugins');
  const plugins = [];
  for (const entry of await readdirOr(dir, warnings)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    plugins.push({ name: entry.name, path: join(dir, entry.name), linked: entry.isSymbolicLink() });
  }
  plugins.sort(byName);
  return { plugins, warnings };
}

/* --------------------------------------------------------------- write side */

/** Read a JSON file for a read-modify-write; a missing file is an empty one. */
async function readJsonForWrite(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, value: {}, mode: 0o600 };
    throw bad(`Could not read ${path}: ${error.message}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw bad(`${basename(path)} is not valid JSON; refusing to rewrite it (${error.message}).`);
  }
  let mode = 0o644;
  try {
    mode = (await stat(path)).mode & 0o777;
  } catch {
    /* keep the default */
  }
  return { exists: true, value, mode };
}

/** Copy the current file aside, keeping only the last three backups. */
async function backupFile(path) {
  const dir = dirname(path);
  const base = basename(path);
  const stamp = timestamp();
  let target = join(dir, `${base}.bak-ptech-${stamp}`);
  for (let suffix = 2; await exists(target); suffix += 1) target = join(dir, `${base}.bak-ptech-${stamp}-${suffix}`);
  await copyFile(path, target);
  const backups = (await readdir(dir)).filter((name) => name.startsWith(`${base}.bak-ptech-`)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) await unlink(join(dir, old)).catch(() => undefined);
  return target;
}

/** Write a file atomically: a sibling temp file, then rename over the original. */
async function writeAtomic(path, value, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.tmp-ptech-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Save one config file: backup first (when it exists), then replace it whole. */
async function saveJson(path, value, { exists, mode }) {
  const backup = exists ? await backupFile(path) : null;
  await writeAtomic(path, value, mode);
  return { path, backup };
}

function cleanName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw bad('A server name is 1–64 letters, digits, dots, dashes or underscores.');
  return name;
}

function cleanTarget(target, method) {
  if (!TARGETS.has(target)) throw bad(`${method}: target must be "claude" or "opencode".`);
  return target;
}

/** Validate what addMcp was handed and normalize it; no secrets are echoed back. */
function cleanConnection({ command, args, url, env }) {
  const hasUrl = typeof url === 'string' && url.trim().length > 0;
  const hasCommand = typeof command === 'string' && command.trim().length > 0;
  if (hasUrl && hasCommand) throw bad('Give either a command or a URL, not both.');
  if (!hasUrl && !hasCommand) throw bad('Give a command or a URL.');
  let cleanArgs = [];
  if (args !== undefined) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw bad('args must be an array of strings.');
    cleanArgs = args.slice(0, 100);
  }
  if (hasCommand && (command.includes('\0') || command.length > 4096)) throw bad('The command is not valid.');
  let cleanUrl = '';
  if (hasUrl) {
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw bad('The URL is not valid.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw bad('The URL must be http or https.');
    cleanUrl = url.trim();
  }
  let cleanEnv;
  if (env !== undefined) {
    if (!isObject(env)) throw bad('env must be an object of strings.');
    cleanEnv = {};
    for (const [key, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw bad(`“${key}” is not a valid environment variable name.`);
      if (typeof value !== 'string' || value.includes('\0')) throw bad(`The value of “${key}” must be a string.`);
      cleanEnv[key] = value;
    }
  }
  if (cleanEnv && !hasCommand) throw bad('env is only for stdio servers (give a command).');
  return { command: hasCommand ? command.trim() : '', args: hasCommand ? cleanArgs : [], url: cleanUrl, env: cleanEnv };
}

function entryFor(target, clean) {
  if (target === 'claude') {
    return clean.command
      ? { type: 'stdio', command: clean.command, args: clean.args, ...(clean.env && Object.keys(clean.env).length > 0 ? { env: clean.env } : {}) }
      : { type: 'http', url: clean.url };
  }
  return clean.command
    ? { type: 'local', command: [clean.command, ...clean.args], ...(clean.env && Object.keys(clean.env).length > 0 ? { environment: clean.env } : {}), enabled: true }
    : { type: 'remote', url: clean.url, enabled: true };
}

/**
 * The toolbox for one machine.
 * @param {{ home?: string }} [options] - `home` defaults to the real one; tests pass a temp dir.
 */
export function createToolbox({ home = homedir() } = {}) {
  if (typeof home !== 'string' || home.length === 0) throw bad('home must be a directory path.');

  async function list() {
    const claude = await listClaude(home);
    const opencode = await listOpencode(home);
    const harness = await listHarness(home);
    return {
      claude: { mcp: claude.mcp, skills: claude.skills },
      opencode: { mcp: opencode.mcp, configPath: opencode.configPath },
      harness: { plugins: harness.plugins },
      warnings: [...claude.warnings, ...opencode.warnings, ...harness.warnings],
    };
  }

  /** Read and validate Claude's user config for a read-modify-write. */
  async function openClaudeForWrite() {
    const paths = claudePaths(home);
    const current = await readJsonForWrite(paths.config);
    if (!isObject(current.value)) throw bad(`${basename(paths.config)} is not a JSON object; refusing to rewrite it.`);
    return { path: paths.config, ...current };
  }

  /** Read and validate OpenCode's config for a read-modify-write. */
  async function openOpencodeForWrite() {
    const paths = opencodePaths(home);
    const file = (await opencodeFile(paths)) ?? paths.json;
    let text = null;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw bad(`Could not read ${file}: ${error.message}`);
    }
    if (text === null) return { path: file, exists: false, value: {}, mode: 0o644 };
    let value;
    try {
      value = parseJsonc(text);
    } catch (error) {
      throw bad(`${basename(file)} could not be parsed; refusing to rewrite it (${error.message}).`);
    }
    if (!isObject(value)) throw bad(`${basename(file)} is not a JSON object; refusing to rewrite it.`);
    let mode = 0o644;
    try {
      mode = (await stat(file)).mode & 0o777;
    } catch {
      /* keep the default */
    }
    return { path: file, exists: true, value, mode };
  }

  async function addMcp({ target, name, command, args, url, env } = {}) {
    cleanTarget(target, 'addMcp');
    const serverName = cleanName(name);
    const clean = cleanConnection({ command, args, url, env });
    const entry = entryFor(target, clean);

    if (target === 'claude') {
      const current = await openClaudeForWrite();
      const config = current.value;
      const enabled = isObject(config.mcpServers) ? config.mcpServers : {};
      const disabled = isObject(config[DISABLED_KEY]) ? config[DISABLED_KEY] : {};
      if (Object.hasOwn(enabled, serverName) || Object.hasOwn(disabled, serverName)) throw bad(`“${serverName}” already exists in Claude Code.`);
      config.mcpServers = { ...enabled, [serverName]: entry };
      const saved = await saveJson(current.path, config, current);
      return { ok: true, target, name: serverName, path: saved.path, backup: saved.backup, changed: true, list: await list() };
    }

    const current = await openOpencodeForWrite();
    const config = current.value;
    const servers = isObject(config.mcp) ? config.mcp : {};
    if (Object.hasOwn(servers, serverName)) throw bad(`“${serverName}” already exists in OpenCode.`);
    config.mcp = { ...servers, [serverName]: entry };
    const saved = await saveJson(current.path, config, current);
    return { ok: true, target, name: serverName, path: saved.path, backup: saved.backup, changed: true, list: await list() };
  }

  async function removeMcp({ target, name } = {}) {
    cleanTarget(target, 'removeMcp');
    const serverName = cleanName(name);

    if (target === 'claude') {
      const current = await openClaudeForWrite();
      const config = current.value;
      const enabled = isObject(config.mcpServers) ? { ...config.mcpServers } : {};
      const disabled = isObject(config[DISABLED_KEY]) ? { ...config[DISABLED_KEY] } : {};
      const inEnabled = Object.hasOwn(enabled, serverName);
      const inDisabled = Object.hasOwn(disabled, serverName);
      if (!inEnabled && !inDisabled) throw bad(`Claude Code has no MCP server named “${serverName}”.`);
      delete enabled[serverName];
      delete disabled[serverName];
      if (Object.keys(enabled).length > 0) config.mcpServers = enabled;
      else delete config.mcpServers;
      if (Object.keys(disabled).length > 0) config[DISABLED_KEY] = disabled;
      else delete config[DISABLED_KEY];
      const saved = await saveJson(current.path, config, current);
      return { ok: true, target, name: serverName, path: saved.path, backup: saved.backup, changed: true, removed: true, list: await list() };
    }

    const current = await openOpencodeForWrite();
    const config = current.value;
    if (!isObject(config.mcp) || !Object.hasOwn(config.mcp, serverName)) throw bad(`OpenCode has no MCP server named “${serverName}”.`);
    const servers = { ...config.mcp };
    delete servers[serverName];
    if (Object.keys(servers).length > 0) config.mcp = servers;
    else delete config.mcp;
    const saved = await saveJson(current.path, config, current);
    return { ok: true, target, name: serverName, path: saved.path, backup: saved.backup, changed: true, removed: true, list: await list() };
  }

  async function toggleMcp({ target, name, enabled } = {}) {
    cleanTarget(target, 'toggleMcp');
    const serverName = cleanName(name);
    if (typeof enabled !== 'boolean') throw bad('toggleMcp: enabled must be true or false.');

    if (target === 'claude') {
      // Claude Code has no per-server switch at user scope: an enabled entry
      // lives in mcpServers, a disabled one in the sibling _ptechDisabled set.
      const current = await openClaudeForWrite();
      const config = current.value;
      const servers = isObject(config.mcpServers) ? { ...config.mcpServers } : {};
      const disabled = isObject(config[DISABLED_KEY]) ? { ...config[DISABLED_KEY] } : {};
      const inEnabled = Object.hasOwn(servers, serverName);
      const inDisabled = Object.hasOwn(disabled, serverName);
      if (!inEnabled && !inDisabled) throw bad(`Claude Code has no MCP server named “${serverName}”.`);
      if ((enabled && inEnabled) || (!enabled && inDisabled)) {
        return { ok: true, target, name: serverName, path: current.path, backup: null, changed: false, enabled, list: await list() };
      }
      if (enabled) {
        servers[serverName] = disabled[serverName];
        delete disabled[serverName];
      } else {
        disabled[serverName] = servers[serverName];
        delete servers[serverName];
      }
      if (Object.keys(servers).length > 0) config.mcpServers = servers;
      else delete config.mcpServers;
      if (Object.keys(disabled).length > 0) config[DISABLED_KEY] = disabled;
      else delete config[DISABLED_KEY];
      const saved = await saveJson(current.path, config, current);
      return { ok: true, target, name: serverName, path: saved.path, backup: saved.backup, changed: true, enabled, list: await list() };
    }

    const current = await openOpencodeForWrite();
    const config = current.value;
    if (!isObject(config.mcp) || !Object.hasOwn(config.mcp, serverName)) throw bad(`OpenCode has no MCP server named “${serverName}”.`);
    const entry = { ...config.mcp[serverName] };
    if ((entry.enabled !== false) === enabled) {
      return { ok: true, target, name: serverName, path: current.path, backup: null, changed: false, enabled, list: await list() };
    }
    entry.enabled = enabled;
    config.mcp = { ...config.mcp, [serverName]: entry };
    const saved = await saveJson(current.path, config, current);
    return { ok: true, target, name: serverName, path: saved.path, backup: saved.backup, changed: true, enabled, list: await list() };
  }

  return { list, addMcp, removeMcp, toggleMcp };
}
