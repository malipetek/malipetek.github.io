/**
 * Preflight for the Action cards bundle.
 *
 * Reproduces the checks the DSH loaders themselves make, so a packaging mistake
 * is caught here rather than in the app's log after a restart: the Client half
 * registers a factory whose id must equal the package name, `exports["./client"]`
 * must resolve, the bundle patch must insert the package, and the Host half must
 * import with nothing but node builtins (a plugin cannot depend on a package the
 * application does not already provide).
 *
 *   node dev-preflight.mjs
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Applying the plugin has side effects — it writes its store and its wiring
// report — so point them at a scratch directory before the Host half is
// imported. The module reads this at import time.
const scratch = mkdtempSync(join(tmpdir(), 'dsh-action-cards-preflight-'));
process.env.DSH_ACTION_CARDS_DIR = scratch;

const problems = [];

/**
 * Record and report one check.
 * @param label - what is being checked.
 * @param condition - the result.
 * @param detail - optional value to show.
 */
function ok(label, condition, detail) {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!condition) problems.push(label);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

ok('dsh.bundle.patch is declared', typeof pkg.dsh?.bundle?.patch === 'string', pkg.dsh?.bundle?.patch);
ok('the patch file exists', existsSync(pkg.dsh.bundle.patch));
const patch = readFileSync(pkg.dsh.bundle.patch, 'utf8');
ok('the patch inserts this package', patch.includes(pkg.name));
ok('dsh.client.platform is a string', typeof pkg.dsh?.client?.platform === 'string', pkg.dsh?.client?.platform);
ok('dsh.client.immediately is a boolean', typeof pkg.dsh?.client?.immediately === 'boolean');
const inject = pkg.dsh?.client?.inject;
ok('dsh.client.inject is a list of package names', Array.isArray(inject) && inject.every((value) => typeof value === 'string'), JSON.stringify(inject));

const clientExport = pkg.exports?.['./client'];
ok('exports["./client"] is declared', typeof clientExport === 'string', clientExport);
ok('the client bundle exists', typeof clientExport === 'string' && existsSync(clientExport));
ok('main is declared and exists', typeof pkg.main === 'string' && existsSync(pkg.main), pkg.main);

// The browser loader registers a lazy factory whose id must equal the package name.
const source = readFileSync(clientExport, 'utf8');
let registered = null;
globalThis.window = { __ModuleLoader__: { load: (value) => { registered = value; } } };
// eslint-disable-next-line no-new-func
new Function('window', source)(globalThis.window);
ok('the bundle registers itself on window', registered !== null);
ok('the bundle id equals the package name', registered?.id === pkg.name, `${registered?.id} vs ${pkg.name}`);
ok('the bundle exposes a factory', typeof registered?.factory === 'function');
ok('the factory returns a Cordis plugin', typeof registered?.factory((name) => (name === 'react' ? {} : null))?.apply === 'function');

const hostSource = readFileSync('index.js', 'utf8');
ok('the host half imports only node builtins', !/from\s+['"](?!node:)/.test(hostSource));
ok('the client bundle requires only react', !/require\(\s*['"](?!react['"])/.test(source));

const host = await import('./index.js');
ok('the host half exports a name', typeof host.name === 'string', host.name);
ok('the host half declares its injects', Array.isArray(host.inject), JSON.stringify(host.inject));
ok('the host half exports apply', typeof host.apply === 'function');

// The store path the Client falls back to must name the same directory the Host
// defaults to, or the Sidebar list would read a file nobody writes.
const clientStoreLiteral = /DEFAULT_STORE_PATH = '([^']+)'/.exec(source)?.[1];
ok(
  'the store-path literal names action-cards/actions.json',
  typeof clientStoreLiteral === 'string' && clientStoreLiteral.endsWith('/.dsh/action-cards/actions.json'),
  clientStoreLiteral,
);

/* ------------------------------------------------------------------ *
 * The tool schema subset
 * ------------------------------------------------------------------ */

/**
 * The keyword subset the Harness enforces, from
 * `@deepseek-ai/dsh-tools` → `lib/types/json-schema.js`.
 *
 * `CONSTRAINT_KEYWORDS` is `type/oneOf/properties/required/additionalProperties/
 * items/enum/const`; `ANNOTATION_KEYWORDS` is `description/title/default/examples`.
 * Anything else is a violation: `register()` rejects an offending **output**
 * schema outright, and although it does not assert on `parameters`, an
 * out-of-subset keyword there is neither validated nor rendered into the PTC
 * type — it just goes to the provider unenforced.
 *
 * Kept as a list rather than imported, because that module pulls in
 * `@deepseek-ai/dsh-llm`, which is not resolvable outside the application.
 */
const CONSTRAINT_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);

/**
 * Walk a schema and collect keywords outside the subset.
 * @param schema - the schema to check.
 * @param path - the position, for the message.
 * @param out - accumulator.
 * @returns the offending `path.keyword` strings.
 */
function outOfSubset(schema, path = 'schema', out = []) {
  if (schema === null || typeof schema !== 'object') return out;
  for (const [key, value] of Object.entries(schema)) {
    if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) out.push(`${path}.${key}`);
    if (key === 'properties' && value !== null && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) outOfSubset(child, `${path}.properties.${name}`, out);
    }
    if (key === 'items') outOfSubset(value, `${path}.items`, out);
    if (key === 'oneOf' && Array.isArray(value)) value.forEach((branch, index) => outOfSubset(branch, `${path}.oneOf[${index}]`, out));
  }
  return out;
}

// The tool definition is built inside `apply`, so capture it the way the
// integration driver does and inspect the real schemas it hands the registry.
const captured = {};
const stub = new Proxy({}, {
  get: (_target, key) => {
    if (key === 'tools') return { register: (definition) => { captured.tool = definition; return () => {}; } };
    if (key === 'commands') return { register: (definition) => { captured.command = definition; return () => {}; } };
    if (key === 'effect') return (body) => body();
    if (key === 'get') return () => undefined;
    return undefined;
  },
  has: () => true,
});
host.apply(stub);

ok('the plugin registered a tool', captured.tool !== undefined, captured.tool?.name);
ok('the plugin registered a command', captured.command !== undefined, captured.command?.name);

const parametersOffenders = outOfSubset(captured.tool?.parameters, 'parameters');
ok('the tool parameters stay inside the schema subset', parametersOffenders.length === 0, parametersOffenders.join(', ') || 'clean');
const outputOffenders = outOfSubset(captured.tool?.output?.schema, 'output.schema');
ok('the tool output schema stays inside the schema subset', outputOffenders.length === 0, outputOffenders.join(', ') || 'clean');

const stepBounds = JSON.stringify(captured.tool?.parameters?.properties?.steps?.description ?? '');
ok('the step bound is stated in prose, where the model can read it', stepBounds.includes('8'), captured.tool?.parameters?.properties?.steps?.description);

rmSync(scratch, { recursive: true, force: true });
console.log(problems.length === 0 ? '\npreflight: all checks passed' : `\npreflight FAILED: ${problems.join('; ')}`);
process.exit(problems.length === 0 ? 0 : 1);
