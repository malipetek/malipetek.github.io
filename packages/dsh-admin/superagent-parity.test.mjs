import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizePath,
  parsePathHelpers,
  extractUiWrites,
  extractSuperagentEndpoints,
  projectOperationRoutes,
  checkBaseline,
} from './superagent-parity.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/* ————————————————————— the parser, on small strings ————————————————————— */

test('normalizePath turns template expressions into :param', () => {
  assert.equal(normalizePath('`/admin/tickets/${t.id}/land`'), '/admin/tickets/:param/land');
  assert.equal(normalizePath('`/admin/clients/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}`'), '/admin/clients/:param/projects/:param');
});

test('normalizePath strips query strings, literal and interpolated', () => {
  assert.equal(normalizePath("'/admin/seo/guide-cycle?force=1'"), '/admin/seo/guide-cycle');
  assert.equal(normalizePath('`/admin/tickets?projectId=${encodeURIComponent(args.projectId)}`'), '/admin/tickets');
  // The nested-template ternary in projectCloudflare: everything from the `?` on is cut.
  assert.equal(
    normalizePath("`/admin/projects/${encodeURIComponent(projectId)}/cloudflare${connectionId ? `?connection=${encodeURIComponent(connectionId)}` : ''}`"),
    '/admin/projects/:param/cloudflare',
  );
});

test('normalizePath folds path helpers and local const templates', () => {
  const helpers = parsePathHelpers("const pathFor = (project) => `/admin/projects/${encodeURIComponent(project.id)}`;");
  assert.deepEqual(Object.keys(helpers), ['pathFor']);
  assert.equal(normalizePath('pathFor(project)', { helpers }), '/admin/projects/:param');
  assert.equal(normalizePath('`${pathFor(project)}/solutions`', { helpers }), '/admin/projects/:param/solutions');
  const locals = { project: '`/admin/projects/${encodeURIComponent(args.projectId)}`' };
  assert.equal(normalizePath('`${project}/recipients`', { locals }), '/admin/projects/:param/recipients');
  assert.equal(normalizePath('project', { locals }), '/admin/projects/:param');
});

test('normalizePath reads nothing out of a variable path', () => {
  assert.equal(normalizePath('request.path'), null);
  assert.equal(normalizePath('path'), null);
  assert.equal(normalizePath("'/admin/x' + id"), null);
});

test('normalizePath is not fooled by quotes, braces or slashes inside expressions', () => {
  // An apostrophe, a `//` and a brace all live inside the interpolation.
  assert.equal(normalizePath('`/x/${ list("// it\'s }") }/y`'), '/x/:param/y');
  assert.equal(normalizePath("'/admin/quoted'"), '/admin/quoted');
});

test('extractUiWrites counts every write, skips reads and test files', () => {
  const files = [
    { path: 'page.jsx', source: [
      "const pathFor = (project) => `/admin/projects/${encodeURIComponent(project.id)}`;",
      "await api('GET', '/admin/health');",
      "void act(() => api('POST', `/admin/tickets/${t.id}/land`, {}));",
      "api('PATCH', `${pathFor(project)}/solutions`, { solutions });",
      "api ( 'PUT' , '/admin/spaced' );",
    ].join('\n') },
    { path: 'page.test.jsx', source: "api('POST', '/admin/from-a-test', {});" },
  ];
  assert.deepEqual(extractUiWrites(files), {
    writes: ['PATCH /admin/projects/:param/solutions', 'POST /admin/tickets/:param/land', 'PUT /admin/spaced'],
    unresolved: [],
  });
});

test('extractUiWrites resolves a variable path through its documented source', () => {
  const files = [
    { path: 'app.jsx', source: "const result = await api('POST', request.path, request.body);" },
    { path: 'workbench.js', source: [
      'export function projectCreationRequest(input, access) {',
      "  if (access?.superAdmin) return { path: '/admin/projects', body: {} };",
      "  return { path: '/portal/projects', body: {} };",
      '}',
    ].join('\n') },
  ];
  const dynamicSites = [{ file: 'app.jsx', argument: 'request.path', via: 'projectCreationRequest' }];
  assert.deepEqual(extractUiWrites(files, { dynamicSites }), {
    writes: ['POST /admin/projects', 'POST /portal/projects'],
    unresolved: [],
  });
});

test('extractUiWrites fails loudly when a write hides behind an unknown variable', () => {
  const out = extractUiWrites([{ path: 'page.jsx', source: "api('POST', opaque, {});" }]);
  assert.equal(out.writes.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.match(out.unresolved[0].detail, /could not be read statically/);
});

test('extractSuperagentEndpoints traces helpers, parameters, delegates and string routes', () => {
  const miniIndex = `
    async function request(config, path, init = {}) { return fetch(path, init); }
    const setStatus = (config, ticketId, status) =>
      request(config, \`/admin/tickets/\${encodeURIComponent(ticketId)}\`, { method: 'PATCH', body: { status } });
    async function saveFile(config, path, opts) { return request(config, path, opts); }
    ctx.tools.register({
      name: 'admin_tickets',
      async execute(args) {
        const config = await loadConfig();
        await setStatus(config, args.ticketId, 'approved');
        const saved = await saveFile(config, \`/admin/tickets/\${args.ticketId}/files/\${args.fileId}\`, { raw: true });
        return { message: 'ok' };
      },
    });
    ctx.tools.register({
      name: 'admin_project_local',
      async execute(args) {
        const result = await handleAdmin({ rawInput: \`project-local \${args.action} \${JSON.stringify(args)}\` });
        return result;
      },
    });
    ctx.tools.register({
      name: 'admin_project_operations',
      async execute({ operation, ...args }) {
        const route = projectOperationRequest(operation, args);
        const config = await loadConfig();
        const result = await request(config, route.path, { method: route.method, ...(route.body === undefined ? {} : { body: route.body }) });
        return result;
      },
    });
  `;
  const miniOperations = `
    export function projectOperationRequest(operation, args = {}) {
      const project = \`/admin/projects/\${encodeURIComponent(args.projectId)}\`;
      switch (operation) {
        case 'project.read': return { method: 'GET', path: project };
        case 'project.update': return { method: 'PATCH', path: project, body: {} };
        case 'mentions.send': return { method: 'POST', path: \`\${project}/mentions\`, body: {} };
      }
    }
  `;
  const out = extractSuperagentEndpoints({ indexSource: miniIndex, projectOperationsSource: miniOperations });
  assert.deepEqual(out.unresolved, []);
  assert.deepEqual(new Set(out.endpoints), new Set([
    'PATCH /admin/tickets/:param',
    'GET /admin/tickets/:param/files/:param',
    'GET /admin/projects',                                  // admin_project_local's authorize
    'POST /admin/projects/:param/git-token',                // admin_project_local's clone
    'GET /admin/projects/:param',                           // projectOperationRequest routes
    'PATCH /admin/projects/:param',
    'POST /admin/projects/:param/mentions',
  ]));
});

test('projectOperationRoutes reads every return, methods included', () => {
  const source = `
    const operations = ['project.read'];
    export function projectOperationRequest(operation,args={}) {
      if (!operations.includes(operation)) throw new Error('super_admin_decision_required');
      const project=\`/admin/projects/\${encodeURIComponent(args.projectId)}\`;
      switch(operation) {
        case 'project.read': return {method:'GET',path:project};
        case 'work.queue':
          if (typeof args.title !== 'string') throw new Error('work_title_and_brief_required');
          return {method:'POST',path:'/admin/work',body:{projectId:args.projectId,approve:true}};
      }
    }
  `;
  assert.deepEqual(projectOperationRoutes(source), {
    routes: ['GET /admin/projects/:param', 'POST /admin/work'],
    unresolved: [],
  });
});

/* ————————————————————— the baseline comparison ————————————————————— */

test('a gap with no baseline entry fails, saying what to do', () => {
  const { ok, problems } = checkBaseline(['POST /admin/tickets/:param/land'], []);
  assert.equal(ok, false);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'missing');
  assert.equal(problems[0].endpoint, 'POST /admin/tickets/:param/land');
  assert.match(problems[0].detail, /no superagent equivalent and no baseline entry/);
});

test('a baseline entry that stopped being a gap fails, so the baseline only shrinks', () => {
  const { ok, problems } = checkBaseline([], [{ endpoint: 'POST /admin/tickets/:param/land', area: 'tickets' }]);
  assert.equal(ok, false);
  assert.equal(problems[0].kind, 'stale');
  assert.match(problems[0].detail, /no longer a gap/);
});

test('the baseline must stay shaped, unique and sorted', () => {
  assert.equal(checkBaseline(['POST /x'], [{ endpoint: 'POST /x' }]).problems[0].kind, 'malformed');
  assert.equal(checkBaseline(['POST /x'], [{ endpoint: 'POST /x', area: 'a', note: 'why' }]).problems[0].kind, 'malformed');
  const dupes = checkBaseline(['POST /x'], [
    { endpoint: 'POST /x', area: 'a' }, { endpoint: 'POST /x', area: 'b' },
  ]);
  assert.ok(dupes.problems.some((p) => p.kind === 'duplicate'));
  const unsorted = checkBaseline(['POST /x', 'GET /a'], [
    { endpoint: 'POST /x', area: 'a' }, { endpoint: 'GET /a', area: 'b' },
  ]);
  assert.ok(unsorted.problems.some((p) => p.kind === 'unsorted'));
});

test('a seeded, matching baseline passes', () => {
  const baseline = [
    { endpoint: 'GET /a', area: 'one' },
    { endpoint: 'POST /x', area: 'two' },
  ];
  assert.deepEqual(checkBaseline(['GET /a', 'POST /x'], baseline), { ok: true, problems: [] });
});

/* ————————————————————— the real check, on the real sources ————————————————————— */

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const uiFiles = listFiles(join(here, '..', 'admin-ui', 'src'))
  .map((full) => ({ path: basename(full), source: readFileSync(full, 'utf8') }));
const indexSource = readFileSync(join(here, 'index.js'), 'utf8');
const projectOperationsSource = readFileSync(join(here, 'project-operations.mjs'), 'utf8');
const baseline = JSON.parse(readFileSync(join(here, 'superagent-parity.baseline.json'), 'utf8'));

test('the six admin tools are all the extractor sees', () => {
  const { tools } = extractSuperagentEndpoints({ indexSource, projectOperationsSource });
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['admin_directory', 'admin_fleet', 'admin_project_local', 'admin_project_operations', 'admin_tickets', 'admin_work'],
  );
});

test('the admin_project_local route table still matches its wiring in index.js', () => {
  // ROUTED_THROUGH_HANDLE_ADMIN names what the project-local subcommand
  // reaches; if this wiring moves, the table must move with it.
  assert.match(indexSource, /createLocalProjects\(\{/);
  assert.match(indexSource, /gitToken:\s*async\s*\(projectId\)\s*=>\s*request\(await loadConfig\(\), `\/admin\/projects\/\$\{encodeURIComponent\(projectId\)\}\/git-token`/);
  assert.match(indexSource, /case 'project-local':/);
});

test('every admin UI write has a superagent action or a baseline entry (rule 5)', () => {
  const ui = extractUiWrites(uiFiles);
  const superagent = extractSuperagentEndpoints({ indexSource, projectOperationsSource });
  // Parity is endpoint-level: a UI write is covered when a superagent action
  // reaches the same method and path, whatever the body differs in.
  const gaps = ui.writes.filter((write) => !superagent.endpoints.includes(write));
  const verdict = checkBaseline(gaps, baseline);

  const problems = [
    ...ui.unresolved.map((u) => `${u.file}:${u.line} — ${u.detail}`),
    ...superagent.unresolved.map((u) => `[${u.tool}] ${u.detail}`),
    ...verdict.problems.map((problem) => problem.detail),
  ];
  assert.deepEqual(problems, [], [
    'Superagent parity (docs/product/RULES.md rule 5) is out of date:',
    ...problems.map((line) => `  ${line}`),
  ].join('\n'));
});
