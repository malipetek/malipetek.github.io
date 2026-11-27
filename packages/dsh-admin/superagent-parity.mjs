/**
 * Rule 5's parity check, pure half: what the admin UI can write, what the
 * superagent tools can reach, and the distance between them.
 *
 * docs/product/RULES.md rule 5: every user-facing method the app offers exists
 * as a superagent action calling the same endpoint. The UI side is every
 * `api('POST'|'PUT'|'PATCH'|'DELETE', path, …)` in packages/admin-ui/src; the
 * superagent side is every `request(config, path, {method, body})` reachable
 * from the six admin_* tool handlers in packages/dsh-admin/index.js plus the
 * routes in project-operations.mjs. A UI write with no superagent equivalent
 * is a gap; gaps live in superagent-parity.baseline.json and only shrink.
 *
 * Everything here is pure: functions from source strings to results, no
 * filesystem. The test (superagent-parity.test.mjs) reads the files and feeds
 * them in, and unit-tests the awkward shapes on small strings.
 *
 * Parsing is deliberately lexical (strings, template literals with nested
 * interpolations, comments, regexes), never a flat regex: paths like
 * `/admin/projects/${id}/cloudflare${conn ? `?connection=${id}` : ''}` must
 * normalize to `/admin/projects/:param/cloudflare` and nothing may be fooled
 * by an apostrophe inside a template or a `//` inside a regex.
 */

/* ————————————————————————— lexical scanning ————————————————————————— */

const OPENERS = { '(': ')', '[': ']', '{': '}' };

const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch ?? '');
const isIdentChar = (ch) => /[A-Za-z0-9_$]/.test(ch ?? '');

/** Can a `/` at this point start a regex? Division follows a value (`)`, `]`, a name, a number). */
function regexAllowedAfter(last) {
  if (last === '') return true;
  return '([{,;=:!&|?+-*%<>~^'.includes(last);
}

/**
 * Past the literal starting at `i` (comment, string, template or regex).
 * `regexAllowed` says whether a `/` here starts a regex or is division.
 */
function skipLiteral(src, i, regexAllowed) {
  const ch = src[i];
  if (src.startsWith('//', i)) {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? src.length : nl + 1;
  }
  if (src.startsWith('/*', i)) {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  if (ch === "'" || ch === '"') {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === ch) return j + 1;
      if (src[j] === '\n') return j; // unterminated; recover at the line end
      j += 1;
    }
    return src.length;
  }
  if (ch === '`') return skipTemplate(src, i).end;
  if (ch === '/' && regexAllowed) {
    let j = i + 1;
    let inClass = false;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') return j; // not a regex after all; recover at the line end
      if (inClass) { if (c === ']') inClass = false; } else if (c === '[') inClass = true;
      else if (c === '/') return j + 1;
      j += 1;
    }
    return src.length;
  }
  return i + 1;
}

/** Past the closing backtick of the template literal at `i`, `${…}` nesting included. */
function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return { end: j + 1 };
    if (c === '$' && src[j + 1] === '{') {
      const close = matchBracket(src, j + 1);
      if (close === -1) return { end: src.length };
      j = close + 1;
      continue;
    }
    j += 1;
  }
  return { end: src.length };
}

/** Index of the bracket matching the opener at `src[open]`, or -1. */
function matchBracket(src, open) {
  const closeCh = OPENERS[src[open]];
  if (closeCh === undefined) return -1;
  let depth = 0;
  let i = open;
  let last = '';
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`' || src.startsWith('//', i) || src.startsWith('/*', i)) {
      const end = skipLiteral(src, i, false);
      if (end > i) { last = src[end - 1]; i = end; continue; }
    }
    if (c === '/' && regexAllowedAfter(last)) {
      const end = skipLiteral(src, i, true);
      last = '/'; i = end; continue;
    }
    if (OPENERS[c] !== undefined) depth += 1;
    else if (Object.values(OPENERS).includes(c)) {
      depth -= 1;
      if (depth === 0) return i;
    }
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return -1;
}

/** The `line` (1-based) a source index sits on — for pointing at call sites. */
function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

/**
 * Split the text between `from` and `to` on its top-level commas.
 * Skips strings, templates, comments and regexes so a comma inside `${…}` or
 * a body object never splits an argument.
 */
function splitTopLevel(src, from, to) {
  const parts = [];
  let depth = 0;
  let last = '';
  let start = from;
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`' || src.startsWith('//', i) || src.startsWith('/*', i)) {
      const end = skipLiteral(src, i, false);
      if (end > i) { last = src[end - 1]; i = end; continue; }
    }
    if (c === '/' && regexAllowedAfter(last)) {
      const end = skipLiteral(src, i, true);
      last = '/'; i = end; continue;
    }
    if (OPENERS[c] !== undefined) depth += 1;
    else if (Object.values(OPENERS).includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  parts.push(src.slice(start, to));
  return parts;
}

/**
 * Is the identifier at `i` reached as a member access (`obj.api(…)`)?
 * Only a preceding `.` says so — a ternary's `? name(` is an ordinary call.
 */
function memberAccessBefore(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  return j >= 0 && src[j] === '.';
}

/**
 * Every call `callee(…)` in the range, as `{ index, args }` with raw argument
 * texts. By default only a bare name is a call (`api(…)`), so `x.api(…)` is
 * not; `property: true` also accepts `obj.callee(…)` for scanners that check
 * the receiver themselves.
 */
function findCalls(src, callee, from = 0, to = src.length, { property = false } = {}) {
  const calls = [];
  let i = from;
  let last = '';
  while (i < to) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`' || src.startsWith('//', i) || src.startsWith('/*', i)) {
      const end = skipLiteral(src, i, false);
      if (end > i) { last = src[end - 1]; i = end; continue; }
    }
    if (c === '/' && regexAllowedAfter(last)) {
      const end = skipLiteral(src, i, true);
      last = '/'; i = end; continue;
    }
    if (isIdentStart(c) && !isIdentChar(src[i - 1])) {
      let j = i + 1;
      while (j < to && isIdentChar(src[j])) j += 1;
      const word = src.slice(i, j);
      let k = j;
      while (k < to && /\s/.test(src[k])) k += 1;
      if (word === callee && src[k] === '(' && (property || !memberAccessBefore(src, i))) {
        const close = matchBracket(src, k);
        if (close !== -1) {
          const args = splitTopLevel(src, k + 1, close).map((text) => text.trim());
          calls.push({ index: i, paren: k, close, args });
          i = close + 1;
          last = ')';
          continue;
        }
      }
      i = j;
      last = word.slice(-1);
      continue;
    }
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return calls;
}

/* ————————————————————————— path normalization ————————————————————————— */

/**
 * One interpolation, decided: a known path helper folds in its template, a
 * ternary is a query suffix (cut), anything else is one `:param`.
 * @returns {null | {kind:'param'} | {kind:'query'} | {kind:'path', text:string}}
 */
function resolveInterpolation(inner, { helpers, locals }) {
  const text = inner.trim();
  if (text === '') return { kind: 'param' };
  const helperCall = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(text);
  if (helperCall !== null && helpers[helperCall[1]] !== undefined && text.endsWith(')')) {
    const folded = normalizePath(helpers[helperCall[1]], { helpers, locals });
    return folded === null ? null : { kind: 'path', text: folded };
  }
  const bare = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
  if (bare && locals[text] !== undefined) {
    const folded = normalizePath(locals[text], { helpers, locals });
    return folded === null ? null : { kind: 'path', text: folded };
  }
  if (containsTernary(text)) return { kind: 'query' };
  return { kind: 'param' };
}

/** Does an expression hold a ternary `? :` at its own depth? (String/template contents included.) */
function containsTernary(text) {
  let depth = 0;
  let i = 0;
  let last = '';
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || text.startsWith('//', i) || text.startsWith('/*', i)) {
      const end = skipLiteral(text, i, false);
      if (end > i) { last = text[end - 1]; i = end; continue; }
    }
    if (c === '`') {
      const skipped = skipTemplate(text, i);
      // A nested template that starts with `?` is a query suffix (e.g. `?connection=…`).
      const chunk = text.slice(i + 1, Math.min(skipped.end - 1, text.indexOf('${', i) === -1 ? skipped.end - 1 : text.indexOf('${', i)));
      if (chunk.startsWith('?')) return true;
      i = skipped.end;
      last = '`';
      continue;
    }
    if (c === '/' && regexAllowedAfter(last)) {
      const end = skipLiteral(text, i, true);
      last = '/'; i = end; continue;
    }
    if (OPENERS[c] !== undefined) depth += 1;
    else if (Object.values(OPENERS).includes(c)) depth -= 1;
    else if (c === '?' && depth === 0 && !'.?'.includes(text[i + 1] ?? '')) return true;
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return false;
}

/**
 * Normalize one path expression — the second argument of an `api()` or
 * `request()` call — to a route with `:param` placeholders.
 * - `${…}` becomes `:param`; a `${helper(…)}` folds in the helper's template.
 * - everything from a query string on is cut (`${conn ? `?x=${id}` : ''}` too).
 * @param {string} expr - the raw argument text.
 * @param {{helpers?: Record<string,string>, locals?: Record<string,string>}} [context]
 * @returns {string|null} the normalized path, or null when it cannot be read statically.
 */
export function normalizePath(expr, { helpers = {}, locals = {} } = {}) {
  const text = String(expr ?? '').trim();
  if (text === '') return null;

  if (text.startsWith('`')) {
    let out = '';
    let i = 1; // past the opening backtick
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') break;
      if (c === '$' && text[i + 1] === '{') {
        const close = matchBracket(text, i + 1);
        if (close === -1) return null;
        const decision = resolveInterpolation(text.slice(i + 2, close), { helpers, locals });
        if (decision === null) return null;
        if (decision.kind === 'query') return out || null;
        if (decision.kind === 'path') out += decision.text;
        else out += ':param';
        i = close + 1;
        continue;
      }
      const chunkEnd = (() => {
        let j = i;
        while (j < text.length && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{') && text[j] !== '?') j += 1;
        return j;
      })();
      out += text.slice(i, chunkEnd);
      if (text[chunkEnd] === '?') return out; // a literal query starts here
      i = chunkEnd;
    }
    // The whole expression must be the template: `` `/a` + more `` is not readable.
    if (i !== text.length - 1) return null;
    return out === '' ? null : out;
  }

  if (text.startsWith("'") || text.startsWith('"')) {
    const end = skipLiteral(text, 0, false);
    // The whole expression must be the literal: `'/a' + id` is not readable.
    if (end !== text.length) return null;
    const content = text.slice(1, Math.max(end - 1, 0));
    const q = content.indexOf('?');
    const path = (q === -1 ? content : content.slice(0, q)).trim();
    return path === '' ? null : path;
  }

  const helperCall = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\((.*)\)$/.exec(text) ?? null;
  if (helperCall !== null && helpers[helperCall[1]] !== undefined) {
    return normalizePath(helpers[helperCall[1]], { helpers, locals });
  }
  if (locals[text] !== undefined) return normalizePath(locals[text], { helpers, locals });
  return null;
}

/** `method:` of an init object literal, or null when it is not a plain string. */
function extractMethodLiteral(initText) {
  const text = String(initText ?? '').trim();
  if (!text.startsWith('{')) return null;
  for (const part of splitTopLevel(text, 1, text.length - 1)) {
    const match = /^\**\s*method\s*:\s*(['"])(.*)\1\s*$/.exec(part.trim());
    if (match !== null) return match[2].toUpperCase();
  }
  return null;
}

/** Template-literal-valued `const`s at the top of a scope: `const project = \`/admin/projects/${id}\``. */
export function localTemplateConsts(bodyText) {
  const locals = {};
  for (const match of bodyText.matchAll(/\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*`/g)) {
    if (match.index === undefined) continue;
    const end = skipTemplate(bodyText, match.index + match[0].length - 1).end;
    locals[match[1]] = bodyText.slice(match.index + match[0].length - 1, end);
  }
  return locals;
}

/** Path helpers: `const pathFor = (project) => \`/admin/projects/${…}\`` (single-expression arrows). */
export function parsePathHelpers(source) {
  const helpers = {};
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(?[^=]*?\)?\s*=>\s*`/g)) {
    if (match.index === undefined) continue;
    const end = skipTemplate(source, match.index + match[0].length - 1).end;
    helpers[match[1]] = source.slice(match.index + match[0].length - 1, end);
  }
  return helpers;
}

/* ————————————————————————— the UI side ————————————————————————— */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Call sites whose path is a variable, and where the variable's values come
 * from. Each entry is verified against the code it points at; the test fails
 * if a dynamic write path appears that this table does not know, so no write
 * can hide behind a variable.
 */
export const DYNAMIC_PATH_SITES = [
  {
    file: 'app.jsx',
    argument: 'request.path',
    via: 'projectCreationRequest',
    note: 'ProjectModal submit: projectCreationRequest (workbench.js) picks /admin/projects for a super admin and /portal/projects for a developer.',
  },
];

/**
 * Every state-changing endpoint the admin UI can reach.
 * @param {{path: string, source: string}[]} files - admin-ui sources (test files are skipped here).
 * @param {{dynamicSites?: {file: string, argument: string, via: string}[]}} [options]
 * @returns {{writes: string[], unresolved: {file: string, line: number, detail: string}[]}}
 */
export function extractUiWrites(files, { dynamicSites = DYNAMIC_PATH_SITES } = {}) {
  const writes = new Set();
  const unresolved = [];
  const functionsByName = new Map();

  const scanned = files.filter(({ path }) => !/\.test\.[cm]?js$|\.test\.jsx$/.test(path));
  for (const { path, source } of scanned) collectNamedFunctions(source, functionsByName);

  for (const { path, source } of scanned) {
    const helpers = parsePathHelpers(source);
    for (const call of findCalls(source, 'api')) {
      const methodArg = call.args[0] ?? '';
      const method = /^(['"])([A-Za-z]+)\1$/.exec(methodArg)?.[2]?.toUpperCase();
      if (method === undefined) {
        if (/^[A-Za-z_$]/.test(methodArg) && methodArg !== '') {
          unresolved.push({
            file: path, line: lineAt(source, call.index),
            detail: `api(${methodArg}, …) — the method is not a literal; make it one so the write cannot hide.`,
          });
        }
        continue;
      }
      if (!WRITE_METHODS.has(method)) continue;
      const pathExpr = call.args[1] ?? '';
      const resolved = normalizePath(pathExpr, { helpers });
      if (resolved !== null) {
        writes.add(`${method} ${resolved}`);
        continue;
      }
      const site = dynamicSites.find((entry) => entry.file === path && entry.argument === pathExpr);
      const via = site === undefined ? null : functionsByName.get(site.via) ?? null;
      const paths = via === null ? [] : literalPropertyValues(via.bodyText, 'path');
      if (paths.length > 0) {
        for (const p of paths) writes.add(`${method} ${p}`);
      } else {
        unresolved.push({
          file: path, line: lineAt(source, call.index),
          detail: `api('${method}', ${pathExpr || '…'}, …) — the path could not be read statically. Inline it, or teach superagent-parity.mjs (DYNAMIC_PATH_SITES / parsePathHelpers) so this write is counted.`,
        });
      }
    }
  }
  return { writes: [...writes].sort(), unresolved };
}

/** Every string literal assigned to `key:` in an object literal, at any depth. */
function literalPropertyValues(text, key) {
  const values = [];
  const pattern = new RegExp(`[{,]\\s*\\**\\s*${key}\\s*:\\s*(['"])`, 'g');
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const end = skipLiteral(text, match.index + match[0].length - 1, false);
    values.push(text.slice(match.index + match[0].length, end - 1));
  }
  return values;
}

/* ————————————————————————— the superagent side ————————————————————————— */

/**
 * admin_project_local routes through the `/admin` host command by string:
 * `handleAdmin({ rawInput: 'project-local …' })`. What that subcommand reaches
 * on the portal is fixed here, with the wiring named so a refactor trips the
 * test's source assertions instead of silently widening this list.
 * makeCommandHandler (index.js) wires createLocalProjects with:
 *   authorize — GET /admin/projects (is this project ours?)
 *   gitToken  — POST /admin/projects/:id/git-token (clone's repo credential)
 * everything else the subcommands do is local disk, never the portal.
 */
export const ROUTED_THROUGH_HANDLE_ADMIN = {
  admin_project_local: {
    command: 'project-local',
    endpoints: ['GET /admin/projects', 'POST /admin/projects/:param/git-token'],
  },
};

/** The route factory admin_project_operations delegates to; parsed from project-operations.mjs. */
export const ROUTE_FACTORY = 'projectOperationRequest';

/**
 * Named function and arrow-const definitions of a source file, with their
 * parameter names, body text and the calls they make. Reachability is traced
 * through this map from each tool's execute body.
 */
function collectNamedFunctions(source, into = new Map()) {
  const decls = [];
  for (const match of source.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    if (match.index === undefined) continue;
    decls.push({ name: match[1], at: match.index, afterName: match.index + match[0].length - 1, kind: 'function' });
  }
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g)) {
    if (match.index === undefined) continue;
    decls.push({ name: match[1], at: match.index, afterName: match.index + match[0].length - 1, kind: 'arrow' });
  }
  // Bare-parameter arrows (`const pathFor = project => \`…\``) matter for path helpers.
  for (const decl of decls) {
    const closeParen = matchBracket(source, decl.afterName);
    if (closeParen === -1) continue;
    let i = closeParen + 1;
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (decl.kind === 'arrow' && source.slice(i, i + 2) !== '=>') continue;
    if (decl.kind === 'function' && source[i] !== '{') continue;
    const params = splitParams(source, decl.afterName, closeParen);
    if (source[i] === '{') {
      // A block body — function or arrow — runs to its matching brace.
      const close = matchBracket(source, i);
      if (close === -1) continue;
      into.set(decl.name, { name: decl.name, params, bodyStart: i, bodyEnd: close, bodyText: source.slice(i, close + 1) });
      continue;
    }
    const bodyEnd = expressionEnd(source, i);
    into.set(decl.name, { name: decl.name, params, bodyStart: i, bodyEnd, bodyText: source.slice(i, bodyEnd) });
  }
  return into;
}

/** Where a `=> expression` body ends: its own top-level `;`, string-aware. */
function expressionEnd(source, from) {
  let depth = 0;
  let i = from;
  let last = '';
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`' || source.startsWith('//', i) || source.startsWith('/*', i)) {
      const end = skipLiteral(source, i, false);
      if (end > i) { last = source[end - 1]; i = end; continue; }
    }
    if (c === '/' && regexAllowedAfter(last)) {
      const end = skipLiteral(source, i, true);
      last = '/'; i = end; continue;
    }
    if (OPENERS[c] !== undefined) depth += 1;
    else if (Object.values(OPENERS).includes(c)) depth -= 1;
    else if (c === ';' && depth === 0) return i;
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return source.length;
}

/** Parameter names of the parameter list whose `(` is at `open`. */
function splitParams(source, open, close) {
  return splitTopLevel(source, open + 1, close).map((part) => {
    const trimmed = part.trim().replace(/^\.\.\./, '');
    const name = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(trimmed)?.[1];
    return name ?? null;
  });
}

/** The admin_* tool registrations of index.js: name plus execute body. */
function findToolHandlers(indexSource) {
  const tools = [];
  for (const call of findCalls(indexSource, 'register', 0, indexSource.length, { property: true })) {
    const before = indexSource.slice(Math.max(0, call.index - 12), call.index);
    if (!/tools\s*\.\s*$/.test(before)) continue;
    let i = call.paren + 1;
    while (i < indexSource.length && /\s/.test(indexSource[i])) i += 1;
    if (indexSource[i] !== '{') continue;
    const objectEnd = matchBracket(indexSource, i);
    if (objectEnd === -1) continue;
    const objectText = indexSource.slice(i, objectEnd + 1);
    const name = /(?:^|[,{]\s*)name\s*:\s*(['"])(admin_[A-Za-z0-9_]+)\1/.exec(objectText)?.[2];
    if (name === undefined) continue;
    const exec = /async\s+execute\s*\(/.exec(objectText);
    if (exec === null || exec.index === undefined) continue;
    const parenOpen = objectText.indexOf('(', exec.index);
    const parenClose = matchBracket(objectText, parenOpen);
    let j = parenClose + 1;
    while (j < objectText.length && /\s/.test(objectText[j])) j += 1;
    const bodyEnd = matchBracket(objectText, j);
    tools.push({ name, bodyText: objectText.slice(j, bodyEnd + 1) });
  }
  return tools;
}

/** Parse one `request(config, path, init)` call, with call-site substitution for parameter paths. */
function parseRequestCall(call, { helpers, locals, params, siteArgs }) {
  const method = extractMethodLiteral(call.args[2] ?? '') ?? 'GET';
  const trimmed = (call.args[1] ?? '').trim();
  if (siteArgs !== null && params !== null) {
    const position = params.indexOf(trimmed);
    if (position >= 1) {
      const substituted = siteArgs[position] ?? '';
      const resolved = normalizePath(substituted, { helpers, locals });
      return resolved === null ? null : { method, path: resolved };
    }
  }
  const resolved = normalizePath(trimmed, { helpers, locals });
  return resolved === null ? null : { method, path: resolved };
}

/**
 * Every route `projectOperationRequest` can return, parsed from
 * project-operations.mjs: `method` literals and `path` expressions (template,
 * string, or a local const holding a template).
 * @returns {{routes: string[], unresolved: string[]}}
 */
export function projectOperationRoutes(source) {
  const fn = collectNamedFunctions(source).get(ROUTE_FACTORY);
  if (fn === undefined) return { routes: [], unresolved: [`${ROUTE_FACTORY} not found in project-operations.mjs`] };
  const locals = localTemplateConsts(fn.bodyText);
  const routes = new Set();
  const unresolved = [];
  for (const match of fn.bodyText.matchAll(/\breturn\s*\{/g)) {
    if (match.index === undefined) continue;
    const objectStart = match.index + match[0].length - 1; // the `{`
    const close = matchBracket(fn.bodyText, objectStart);
    if (close === -1) continue;
    const objectText = fn.bodyText.slice(objectStart, close + 1);
    const method = extractMethodLiteral(objectText) ?? 'GET';
    const pathPart = splitTopLevel(objectText, 1, objectText.length - 1)
      .map((part) => part.trim())
      .find((part) => /^(\*\*\s*)?path\s*:/.test(part));
    if (pathPart === undefined) continue;
    const pathExpr = pathPart.replace(/^(\*\*\s*)?path\s*:\s*/, '').replace(/,\s*$/, '');
    const resolved = normalizePath(pathExpr, { locals });
    if (resolved === null) unresolved.push(`projectOperationRoutes: return {method:'${method}', path:${pathExpr}} could not be read`);
    else routes.add(`${method} ${resolved}`);
  }
  return { routes: [...routes].sort(), unresolved };
}

/**
 * Every endpoint the superagent tools can reach: `request(…)` calls in the six
 * admin_* execute bodies, traced through the named helpers they call (a
 * name-based closure, so a helper is parsed once no matter how many paths
 * reach it), plus the projectOperationRequest routes and the one
 * string-routed host subcommand.
 *
 * A helper whose request path is one of its own parameters (downloadAttachment)
 * takes its path from the call sites — the literal templates the tools pass.
 * @param {{indexSource: string, projectOperationsSource: string}} sources
 * @returns {{endpoints: string[], tools: {name: string, endpoints: string[]}[], unresolved: {tool: string, detail: string}[]}}
 */
export function extractSuperagentEndpoints({ indexSource, projectOperationsSource }) {
  const functions = collectNamedFunctions(indexSource);
  const helpers = parsePathHelpers(indexSource);
  const factoryRoutes = projectOperationRoutes(projectOperationsSource);
  const tools = [];
  const unresolved = [...factoryRoutes.unresolved.map((detail) => ({ tool: 'admin_project_operations', detail }))];

  for (const tool of findToolHandlers(indexSource)) {
    const endpoints = new Set();
    // The closure: the tool body first, then every named helper it reaches.
    // A helper is visited once per distinct call-site arguments, so a helper
    // called with two different literal paths counts both, and the walk is
    // bounded by the call sites in the file, not by paths through the graph.
    const queue = [{ bodyText: tool.bodyText, siteArgs: null, params: null, name: null }];
    const visited = new Set();

    while (queue.length > 0) {
      const frame = queue.pop();
      const locals = localTemplateConsts(frame.bodyText);
      const delegates = localRouteDelegates(frame.bodyText);

      for (const call of findCalls(frame.bodyText, 'request')) {
        const pathExpr = (call.args[1] ?? '').trim();
        const delegate = /^([A-Za-z_$][A-Za-z0-9_$]*)\.path$/.exec(pathExpr)?.[1];
        if (delegate !== undefined && delegates.has(delegate)) {
          for (const route of factoryRoutes.routes) endpoints.add(route);
          continue;
        }
        const parsed = parseRequestCall(call, { helpers, locals, params: frame.params, siteArgs: frame.siteArgs });
        if (parsed === null) {
          unresolved.push({
            tool: tool.name,
            detail: `request(…, ${pathExpr || '…'}, …) in ${frame.name ?? 'the tool body'} could not be read statically. Inline the path, or teach superagent-parity.mjs so this endpoint is counted.`,
          });
          continue;
        }
        endpoints.add(`${parsed.method} ${parsed.path}`);
      }

      // String-routed host subcommands: counted only through the table.
      for (const name of localHandleAdminCommands(frame.bodyText)) {
        const routed = frame.name === null ? ROUTED_THROUGH_HANDLE_ADMIN[tool.name] : undefined;
        if (routed !== undefined && routed.command === name) {
          for (const endpoint of routed.endpoints) endpoints.add(endpoint);
        } else {
          unresolved.push({
            tool: tool.name,
            detail: `handleAdmin({rawInput: '${name} …'}) routes by string with no entry in ROUTED_THROUGH_HANDLE_ADMIN. Name what it reaches there.`,
          });
        }
      }

      for (const call of callsOfHelpers(frame.bodyText, functions)) {
        if (call.name === 'handleAdmin') continue; // string-routed above, never traced
        const key = `${call.name}@${call.args.join('¦')}`;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ bodyText: call.fn.bodyText, siteArgs: call.args, params: call.fn.params, name: call.name });
      }
    }

    tools.push({ name: tool.name, endpoints: [...endpoints].sort() });
  }

  const endpoints = new Set();
  for (const tool of tools) for (const endpoint of tool.endpoints) endpoints.add(endpoint);
  return { endpoints: [...endpoints].sort(), tools, unresolved };
}

/** `const X = someFactory(…)` inside a body: X stands for that factory's routes. */
function localRouteDelegates(bodyText) {
  const delegates = new Set();
  const pattern = new RegExp(`\\bconst\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*${ROUTE_FACTORY}\\s*\\(`, 'g');
  for (const match of bodyText.matchAll(pattern)) if (match[1] !== undefined) delegates.add(match[1]);
  return delegates;
}

/** The first word of every `handleAdmin({rawInput: \`…\`})` call in a body. */
function localHandleAdminCommands(bodyText) {
  const commands = [];
  for (const call of findCalls(bodyText, 'handleAdmin')) {
    const first = call.args[0] ?? '';
    const templ = /\{\s*rawInput\s*:\s*`([^`]*)`/.exec(first)?.[1] ?? /^`([^`]*)`/.exec(first)?.[1] ?? '';
    const command = templ.trim().split(/\s+/)[0] ?? '';
    if (command !== '') commands.push(command);
  }
  return commands;
}

/** Helper calls in a body whose callee is a known named function, with their call-site args. */
function callsOfHelpers(bodyText, functions) {
  const out = [];
  let i = 0;
  let last = '';
  while (i < bodyText.length) {
    const c = bodyText[i];
    if (c === "'" || c === '"' || c === '`' || bodyText.startsWith('//', i) || bodyText.startsWith('/*', i)) {
      const end = skipLiteral(bodyText, i, false);
      if (end > i) { last = bodyText[end - 1]; i = end; continue; }
    }
    if (c === '/' && regexAllowedAfter(last)) {
      const end = skipLiteral(bodyText, i, true);
      last = '/'; i = end; continue;
    }
    if (isIdentStart(c) && !isIdentChar(bodyText[i - 1])) {
      let j = i + 1;
      while (j < bodyText.length && isIdentChar(bodyText[j])) j += 1;
      const word = bodyText.slice(i, j);
      let k = j;
      while (k < bodyText.length && /\s/.test(bodyText[k])) k += 1;
      if (functions.has(word) && bodyText[k] === '(' && !memberAccessBefore(bodyText, i)) {
        const close = matchBracket(bodyText, k);
        if (close !== -1) {
          out.push({ name: word, fn: functions.get(word), args: splitTopLevel(bodyText, k + 1, close).map((t) => t.trim()) });
          i = close + 1;
          last = ')';
          continue;
        }
      }
      i = j;
      last = word.slice(-1);
      continue;
    }
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return out;
}

/* ————————————————————————— the comparison ————————————————————————— */

/**
 * Compare today's gaps with the baseline. The baseline only shrinks: an entry
 * that is no longer a gap fails, and a gap that is not an entry fails.
 * @param {string[]} gaps - UI writes with no superagent equivalent, sorted.
 * @param {{endpoint: string, area: string}[]} baseline - the seeded gaps.
 * @returns {{ok: boolean, problems: {kind: string, endpoint?: string, index?: number, detail: string}[]}}
 */
export function checkBaseline(gaps, baseline) {
  const problems = [];
  if (!Array.isArray(baseline)) {
    return { ok: false, problems: [{ kind: 'malformed', detail: 'superagent-parity.baseline.json must be an array of {endpoint, area} objects, sorted by endpoint.' }] };
  }
  baseline.forEach((entry, index) => {
    const shaped = entry !== null && typeof entry === 'object'
      && typeof entry.endpoint === 'string' && entry.endpoint.trim() !== ''
      && typeof entry.area === 'string' && entry.area.trim() !== ''
      && Object.keys(entry).every((key) => key === 'endpoint' || key === 'area');
    if (!shaped) {
      problems.push({ kind: 'malformed', index, detail: `baseline entry #${index} is not exactly {endpoint: string, area: string}: ${JSON.stringify(entry)}` });
    }
  });
  const endpoints = baseline.map((entry) => entry?.endpoint).filter((value) => typeof value === 'string');
  const gapSet = new Set(gaps);
  for (const endpoint of endpoints) {
    if (!gapSet.has(endpoint)) {
      problems.push({
        kind: 'stale', endpoint,
        detail: `"${endpoint}" is no longer a gap: the superagent now reaches it, or the UI write is gone. Remove it from superagent-parity.baseline.json — the baseline only shrinks.`,
      });
    }
  }
  for (const endpoint of endpoints) {
    if (endpoints.indexOf(endpoint) !== endpoints.lastIndexOf(endpoint)) {
      problems.push({ kind: 'duplicate', endpoint, detail: `"${endpoint}" appears twice in superagent-parity.baseline.json; keep one entry.` });
    }
  }
  const sorted = [...endpoints].every((endpoint, i) => i === 0 || endpoints[i - 1] <= endpoint);
  if (!sorted) {
    problems.push({ kind: 'unsorted', detail: 'superagent-parity.baseline.json is not sorted by endpoint; sort it so the file reads as a list, not a history.' });
  }
  for (const endpoint of gaps) {
    if (!endpoints.includes(endpoint)) {
      problems.push({
        kind: 'missing', endpoint,
        detail: `"${endpoint}" is a UI write with no superagent equivalent and no baseline entry. Add an admin tool action that calls it (docs/product/RULES.md rule 5), or add it to superagent-parity.baseline.json with an area if it is a known gap.`,
      });
    }
  }
  return { ok: problems.length === 0, problems };
}
