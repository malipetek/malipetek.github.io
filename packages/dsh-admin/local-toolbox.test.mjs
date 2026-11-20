import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createToolbox, parseJsonc } from './local-toolbox.mjs';

/**
 * A throwaway home directory, never the real one: these tests read and write
 * only paths under it.
 */
async function machine(t) {
  const home = await mkdtemp(join(tmpdir(), 'local-toolbox-test-'));
  t.after(async () => {
    assert.ok(home.startsWith(join(tmpdir(), 'local-toolbox-test-')), `refusing to remove ${home}`);
    await rm(home, { recursive: true, force: true });
  });
  return { home, toolbox: createToolbox({ home }) };
}

async function writeAt(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** One machine with something in every source, matching the real formats. */
async function populated(t) {
  const fixture = await machine(t);
  const { home } = fixture;
  await writeFile(
    join(home, '.claude.json'),
    JSON.stringify(
      {
        oauthAccount: { emailAddress: 'admin@example.test' },
        projects: { '/Users/admin/project': { allowedTools: [] } },
        mcpServers: {
          solidcraft: { type: 'stdio', command: 'solidcraft-cli', args: ['mcp'], env: { SOLIDCRAFT_TOKEN: 'env-secret-6248' } },
          panel: { type: 'http', url: 'https://panel.example.test/mcp', headers: { Authorization: 'Bearer header-secret-9911' } },
        },
        _ptechDisabledMcpServers: { oldone: { type: 'stdio', command: 'old-mcp' } },
      },
      null,
      2,
    ),
  );
  await writeAt(
    join(home, '.claude/skills/brainstorming/SKILL.md'),
    '---\nname: brainstorming\ndescription: "Quoted: description with a colon."\n---\n\n# Brainstorming\n',
  );
  await writeAt(join(home, '.claude/skills/no-front/SKILL.md'), '# No frontmatter here\n');
  await writeAt(
    join(home, '.claude/plugins/marketplace/one/skills/plugin-skill/SKILL.md'),
    '---\nname: plugin-skill\ndescription: >\n  A plugin skill\n  for testing.\n---\n\n# Plugin\n',
  );
  await writeAt(
    join(home, '.config/opencode/opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          'chrome-devtools': { type: 'local', command: ['pnpm', 'dlx', 'chrome-devtools-mcp@latest'], enabled: true, environment: { CHROME_TOKEN: 'opencode-env-secret' } },
          'panel-remote': { type: 'remote', url: 'https://panel.example.test/mcp', headers: { Authorization: 'Bearer opencode-header-secret' } },
        },
        provider: { keep: true },
      },
      null,
      2,
    ),
  );
  await mkdir(join(home, '.dsh/plugins/plugin-dir'), { recursive: true });
  await mkdir(join(home, 'repo/my-plugin'), { recursive: true });
  await symlink(join(home, 'repo/my-plugin'), join(home, '.dsh/plugins/plugin-link'));
  return fixture;
}

test('list reads Claude, OpenCode and Harness sources and keeps every secret out', async (t) => {
  const { home, toolbox } = await populated(t);
  const listed = await toolbox.list();

  assert.deepEqual(listed.claude.mcp, [
    {
      name: 'oldone',
      type: 'stdio',
      command: 'old-mcp',
      disabled: true,
      scope: 'user',
    },
    {
      name: 'panel',
      type: 'http',
      url: 'https://panel.example.test/mcp',
      headerKeys: ['Authorization'],
      scope: 'user',
    },
    {
      name: 'solidcraft',
      type: 'stdio',
      command: 'solidcraft-cli',
      args: ['mcp'],
      envKeys: ['SOLIDCRAFT_TOKEN'],
      scope: 'user',
    },
  ]);

  assert.deepEqual(listed.claude.skills, [
    { name: 'brainstorming', description: 'Quoted: description with a colon.', path: join(home, '.claude/skills/brainstorming/SKILL.md'), source: 'user' },
    { name: 'no-front', description: '', path: join(home, '.claude/skills/no-front/SKILL.md'), source: 'user' },
    { name: 'plugin-skill', description: 'A plugin skill for testing.', path: join(home, '.claude/plugins/marketplace/one/skills/plugin-skill/SKILL.md'), source: 'plugin' },
  ]);

  assert.equal(listed.opencode.configPath, join(home, '.config/opencode/opencode.json'));
  assert.deepEqual(listed.opencode.mcp, [
    {
      name: 'chrome-devtools',
      type: 'local',
      enabled: true,
      command: 'pnpm dlx chrome-devtools-mcp@latest',
      envKeys: ['CHROME_TOKEN'],
    },
    {
      name: 'panel-remote',
      type: 'remote',
      enabled: true,
      url: 'https://panel.example.test/mcp',
      headerKeys: ['Authorization'],
    },
  ]);

  assert.deepEqual(listed.harness.plugins, [
    { name: 'plugin-dir', path: join(home, '.dsh/plugins/plugin-dir'), linked: false },
    { name: 'plugin-link', path: join(home, '.dsh/plugins/plugin-link'), linked: true },
  ]);
  assert.deepEqual(listed.warnings, []);

  const serialized = JSON.stringify(listed);
  for (const secret of ['env-secret-6248', 'header-secret-9911', 'opencode-env-secret', 'opencode-header-secret']) {
    assert.equal(serialized.includes(secret), false, `list leaked ${secret}`);
  }
});

test('Claude add, disable, enable and remove round-trip without touching other keys', async (t) => {
  const { home, toolbox } = await populated(t);
  const configPath = join(home, '.claude.json');
  const before = await readJson(configPath);

  const added = await toolbox.addMcp({ target: 'claude', name: 'new-mcp', command: 'npx', args: ['-y', 'some-mcp'], env: { API_KEY: 'server-env-secret' } });
  assert.equal(added.ok, true);
  assert.equal(added.changed, true);
  assert.equal(added.path, configPath);
  assert.equal(typeof added.backup, 'string');

  let config = await readJson(configPath);
  assert.deepEqual(config.mcpServers['new-mcp'], { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'], env: { API_KEY: 'server-env-secret' } });
  assert.deepEqual(config.oauthAccount, before.oauthAccount);
  assert.deepEqual(config.projects, before.projects);
  assert.equal(JSON.stringify(added.list).includes('server-env-secret'), false);
  assert.deepEqual(added.list.claude.mcp.find((server) => server.name === 'new-mcp').envKeys, ['API_KEY']);

  const remote = await toolbox.addMcp({ target: 'claude', name: 'remote-one', url: 'https://mcp.example.test/sse' });
  assert.equal(remote.changed, true);
  assert.deepEqual((await readJson(configPath)).mcpServers['remote-one'], { type: 'http', url: 'https://mcp.example.test/sse' });

  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'new-mcp', command: 'x' }), /already exists/);
  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'bad name', command: 'x' }), /server name/);
  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'bad', command: 'x', url: 'https://example.test' }), /either a command or a URL/);

  const off = await toolbox.toggleMcp({ target: 'claude', name: 'new-mcp', enabled: false });
  assert.equal(off.changed, true);
  config = await readJson(configPath);
  assert.equal(Object.hasOwn(config.mcpServers, 'new-mcp'), false);
  assert.deepEqual(config._ptechDisabledMcpServers['new-mcp'], { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'], env: { API_KEY: 'server-env-secret' } });
  assert.deepEqual(config.mcpServers.solidcraft, before.mcpServers.solidcraft);
  assert.deepEqual(off.list.claude.mcp.find((server) => server.name === 'new-mcp'), {
    name: 'new-mcp',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'some-mcp'],
    envKeys: ['API_KEY'],
    disabled: true,
    scope: 'user',
  });

  const again = await toolbox.toggleMcp({ target: 'claude', name: 'new-mcp', enabled: false });
  assert.equal(again.changed, false);
  assert.equal(again.backup, null);

  const on = await toolbox.toggleMcp({ target: 'claude', name: 'new-mcp', enabled: true });
  assert.equal(on.changed, true);
  config = await readJson(configPath);
  assert.deepEqual(config.mcpServers['new-mcp'], { type: 'stdio', command: 'npx', args: ['-y', 'some-mcp'], env: { API_KEY: 'server-env-secret' } });
  assert.equal(Object.hasOwn(config._ptechDisabledMcpServers, 'new-mcp'), false);

  // A disabled HTTP entry keeps its headers while parked, and comes back intact.
  await toolbox.toggleMcp({ target: 'claude', name: 'panel', enabled: false });
  assert.equal((await readJson(configPath))._ptechDisabledMcpServers.panel.headers.Authorization, 'Bearer header-secret-9911');
  await toolbox.toggleMcp({ target: 'claude', name: 'panel', enabled: true });

  const removed = await toolbox.removeMcp({ target: 'claude', name: 'new-mcp' });
  assert.equal(removed.removed, true);
  config = await readJson(configPath);
  assert.equal(Object.hasOwn(config.mcpServers, 'new-mcp'), false);
  assert.equal(Object.hasOwn(config._ptechDisabledMcpServers, 'new-mcp'), false);
  assert.deepEqual(config.oauthAccount, before.oauthAccount);
  assert.deepEqual(config.projects, before.projects);
  assert.deepEqual(config.mcpServers.solidcraft, before.mcpServers.solidcraft);
  assert.equal(JSON.stringify(removed.list).includes('server-env-secret'), false);

  await assert.rejects(toolbox.removeMcp({ target: 'claude', name: 'not-there' }), /no MCP server named/);
  await assert.rejects(toolbox.toggleMcp({ target: 'claude', name: 'not-there', enabled: false }), /no MCP server named/);
  await assert.rejects(toolbox.toggleMcp({ target: 'claude', name: 'panel', enabled: 'no' }), /true or false/);
});

test('OpenCode edits keep commands as arrays, other keys, and the jsonc dialect', async (t) => {
  const { home, toolbox } = await machine(t);
  const jsoncPath = join(home, '.config/opencode/opencode.jsonc');
  await writeAt(
    jsoncPath,
    `{
      "$schema": "https://opencode.ai/config.json",
      // a line comment with a "quote and a } brace
      "mcp": {
        /* a block comment: "}" */
        "local-one": { "type": "local", "command": ["echo", "a//b"], "enabled": false, "environment": { "SECRET": "hunter2" } },
        "remote-one": { "type": "remote", "url": "https://panel.example.test/mcp", "headers": { "Authorization": "Bearer abc" } },
      },
      "provider": { "keep": true },
    }
`,
  );

  const listed = await toolbox.list();
  assert.equal(listed.opencode.configPath, jsoncPath);
  assert.deepEqual(listed.opencode.mcp, [
    { name: 'local-one', type: 'local', enabled: false, command: 'echo a//b', envKeys: ['SECRET'] },
    { name: 'remote-one', type: 'remote', enabled: true, url: 'https://panel.example.test/mcp', headerKeys: ['Authorization'] },
  ]);
  assert.deepEqual(listed.warnings, []);

  const added = await toolbox.addMcp({ target: 'opencode', name: 'added-one', command: 'npx', args: ['-y', 'mcp-server'], env: { ADDED_TOKEN: 'opencode-add-secret' } });
  assert.equal(added.path, jsoncPath);
  let config = await readJson(jsoncPath);
  assert.deepEqual(config.mcp['added-one'], { type: 'local', command: ['npx', '-y', 'mcp-server'], environment: { ADDED_TOKEN: 'opencode-add-secret' }, enabled: true });
  assert.deepEqual(config.provider, { keep: true });
  assert.deepEqual(config.mcp['local-one'].command, ['echo', 'a//b']);
  assert.equal(JSON.stringify(added.list).includes('opencode-add-secret'), false);

  await assert.rejects(toolbox.addMcp({ target: 'opencode', name: 'local-one', command: 'x' }), /already exists/);

  const off = await toolbox.toggleMcp({ target: 'opencode', name: 'added-one', enabled: false });
  assert.equal(off.changed, true);
  config = await readJson(jsoncPath);
  assert.equal(config.mcp['added-one'].enabled, false);
  assert.deepEqual(config.mcp['added-one'].command, ['npx', '-y', 'mcp-server']);

  const stillOff = await toolbox.toggleMcp({ target: 'opencode', name: 'added-one', enabled: false });
  assert.equal(stillOff.changed, false);

  await toolbox.toggleMcp({ target: 'opencode', name: 'added-one', enabled: true });
  assert.equal((await readJson(jsoncPath)).mcp['added-one'].enabled, true);
  // A remote entry with no `enabled` reads as enabled, and toggling off adds it.
  await toolbox.toggleMcp({ target: 'opencode', name: 'remote-one', enabled: false });
  assert.equal((await readJson(jsoncPath)).mcp['remote-one'].enabled, false);
  assert.equal((await toolbox.list()).opencode.mcp.find((server) => server.name === 'remote-one').enabled, false);

  const removed = await toolbox.removeMcp({ target: 'opencode', name: 'added-one' });
  assert.equal(removed.removed, true);
  assert.equal(Object.hasOwn((await readJson(jsoncPath)).mcp, 'added-one'), false);
  await assert.rejects(toolbox.removeMcp({ target: 'opencode', name: 'not-there' }), /no MCP server named/);
  await assert.rejects(toolbox.addMcp({ target: 'elsecode', name: 'x', command: 'y' }), /target must be/);
});

test('backups are timestamped, keep the last three and leave no temp files', async (t) => {
  const { home, toolbox } = await machine(t);
  const configPath = join(home, '.claude.json');
  await writeFile(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
  for (const name of ['one', 'two', 'three', 'four', 'five']) await toolbox.addMcp({ target: 'claude', name, command: 'echo' });

  const files = await readdir(home);
  const backups = files.filter((file) => /^\.claude\.json\.bak-ptech-/.test(file)).sort();
  assert.equal(backups.length, 3, `expected three backups, got ${backups.join(', ')}`);
  assert.equal(files.some((file) => file.includes('.tmp-ptech-')), false, 'a temp file was left behind');
  for (const backup of backups) assert.ok((await readJson(join(home, backup))).mcpServers, `${backup} is not a JSON config`);
  const config = await readJson(configPath);
  assert.deepEqual(Object.keys(config.mcpServers).sort(), ['five', 'four', 'one', 'three', 'two']);
});

test('missing files list empty, and a first write creates the file without a backup', async (t) => {
  const { home, toolbox } = await machine(t);
  assert.deepEqual(await toolbox.list(), {
    claude: { mcp: [], skills: [] },
    opencode: { mcp: [], configPath: null },
    harness: { plugins: [] },
    warnings: [],
  });

  const created = await toolbox.addMcp({ target: 'claude', name: 'first', command: 'echo' });
  assert.equal(created.backup, null);
  assert.deepEqual(await readJson(join(home, '.claude.json')), { mcpServers: { first: { type: 'stdio', command: 'echo', args: [] } } });
});

test('unreadable files become warnings, and writes refuse to overwrite corrupt JSON', async (t) => {
  const { home, toolbox } = await machine(t);
  const claudePath = join(home, '.claude.json');
  const opencodePath = join(home, '.config/opencode/opencode.json');
  await writeAt(claudePath, '{ this is not json');
  await writeAt(opencodePath, '{ // open\n  "mcp": {');
  await writeFile(join(home, '.claude.json.keep'), 'sentinel');

  const listed = await toolbox.list();
  assert.deepEqual(listed.claude, { mcp: [], skills: [] });
  assert.deepEqual(listed.opencode, { mcp: [], configPath: opencodePath });
  assert.equal(listed.warnings.length, 2);
  assert.match(listed.warnings[0], /not valid JSON/);
  assert.match(listed.warnings[1], /could not be parsed/);

  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'x', command: 'echo' }), /refusing to rewrite/);
  await assert.rejects(toolbox.addMcp({ target: 'opencode', name: 'x', command: 'echo' }), /refusing to rewrite/);
  assert.equal(await readFile(claudePath, 'utf8'), '{ this is not json');
  assert.equal(await readFile(opencodePath, 'utf8'), '{ // open\n  "mcp": {');
});

test('jsonc parsing leaves strings and URLs alone while removing comments and trailing commas', () => {
  const value = parseJsonc(`{
    // comment with a "quote and a } brace
    "url": "https://a.example.test//path",
    /* block comment: } */
    "n": 1,
    "nested": { "a": [1, 2,], },
  }`);
  assert.deepEqual(value, { url: 'https://a.example.test//path', n: 1, nested: { a: [1, 2] } });
});

test('connection arguments are validated before anything is written', async (t) => {
  const { home, toolbox } = await machine(t);
  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'x', url: 'ftp://example.test' }), /http or https/);
  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'x', command: 'echo', env: { 'bad key': 'v' } }), /not a valid environment variable name/);
  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'x', args: ['a'] }), /Give a command or a URL/);
  await assert.rejects(toolbox.addMcp({ target: 'claude', name: 'x'.repeat(65), command: 'echo' }), /server name/);
  assert.equal(await readdir(home).then((files) => files.length), 0, 'a rejected add wrote something');
});
