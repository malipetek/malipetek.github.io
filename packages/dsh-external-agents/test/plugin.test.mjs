/**
 * Plugin-surface tests: what `apply()` actually registers with the Harness,
 * driven through a stand-in context. These run against the mock agent, so they
 * need no real agent:
 *
 *   node --test test/plugin.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { apply, sessionWorkspace } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const mock = join(here, 'mock-agent.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'dsh-external-agents-plugin-'));

// Keep this run's diagnostics out of the log a real problem would be debugged from.
process.env.DSH_EXTERNAL_AGENTS_LOG = join(scratch, 'diagnostics.log');

/**
 * A stand-in for the Host plugin context that records what a plugin registers.
 * @returns the fake context and the registration log.
 */
function fakeContext() {
  const registered = { tools: [], commands: [], adapters: [], effects: 0 };
  const child = (services) => ({
    effect(fn) {
      registered.effects += 1;
      return fn();
    },
    ...(services.includes('tools') ? {
      tools: {
        register(definition) {
          registered.tools.push(definition);
          return () => undefined;
        },
      },
    } : {}),
    ...(services.includes('commands') ? {
      commands: {
        register(definition) {
          registered.commands.push(definition);
          return () => undefined;
        },
      },
    } : {}),
    ...(services.includes('llm') ? {
      llm: {
        registerAdapter(providers, adapter) {
          registered.adapters.push({ providers, adapter });
          return () => undefined;
        },
      },
    } : {}),
    ...(services.includes('agents') ? {
      agents: { currentInitiator: () => undefined },
    } : {}),
  });
  const ctx = {
    logger: { debug() {}, info() {}, warn() {} },
    inject(services, fn) {
      fn(child(services));
    },
    effect(fn) {
      registered.effects += 1;
      return fn();
    },
  };
  return { ctx, registered };
}

/** The config row this plugin would receive from a bundle patch. */
const config = {
  agents: [{ id: 'mock', label: 'Mock Agent', command: process.execPath, args: [mock], cwd: scratch }],
  envMode: 'minimal',
  // Keep the durable session store inside the test's own scratch directory
  // rather than writing to the real ~/.dsh.
  sessionStoreDir: scratch,
};

test('apply registers one tool and one command, and disposes cleanly', () => {
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, config);
  assert.equal(registered.tools.length, 1);
  assert.equal(registered.tools[0].name, 'external_agents');
  assert.equal(registered.commands.length, 1);
  assert.equal(registered.commands[0].name, 'external-agents');
  assert.deepEqual(registered.tools[0].parameters.required, ['action']);
  assert.equal(typeof dispose, 'function');
  dispose();
});

test('the tool lists, asks, and closes an agent', async () => {
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, config);
  const tool = registered.tools[0];
  try {
    const listed = await tool.execute({ action: 'list' });
    assert.match(listed, /mock/);
    assert.match(listed, /Mock Agent/);
    assert.match(listed, /command not found|idle|ready/, 'list reports a state');

    const answer = await tool.execute({ action: 'ask', agent: 'mock', prompt: 'hello there' });
    assert.match(answer, /Mock Agent \(mock\) — completed/);
    // Each streamed chunk is its own transcript line, so the assistant text is
    // rendered in the order it arrived rather than concatenated.
    assert.match(answer, /Hello /);
    assert.match(answer, /world \[allow-once\]/);
    assert.match(answer, /· considering/, 'thought chunks are shown');
    assert.match(answer, /→ Write file \(completed\)/);
    assert.match(answer, /permissions: 1 allowed, 0 denied/);

    const closed = await tool.execute({ action: 'close', agent: 'mock' });
    assert.match(closed, /Stopped: mock/);
  } finally {
    dispose();
  }
});

test('the tool refuses an unknown action and a missing prompt', async () => {
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, config);
  const tool = registered.tools[0];
  try {
    assert.match(await tool.execute({ action: 'explode' }), /Unknown action/);
    assert.match(await tool.execute({ action: 'ask', agent: 'mock' }), /needs a prompt/);
    assert.match(await tool.execute({ action: 'ask', agent: 'nobody', prompt: 'hi' }), /no external agent matches/);
    const failed = await tool.execute({ action: 'ask', agent: 'mock', prompt: 'TIME_OUT please', timeoutMs: 300 });
    assert.match(failed, /External agent failed: session\/prompt timed out/, 'a timeout is reported as text');
  } finally {
    dispose();
  }
});

test('the command speaks the same vocabulary', async () => {
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, config);
  const command = registered.commands[0];
  try {
    const listed = await command.handler({ rawInput: 'list' });
    assert.equal(listed.kind, 'success');

    const asked = await command.handler({ rawInput: 'ask mock say hi' });
    assert.equal(asked.kind, 'success');
    assert.match(asked.text, /Hello /);
    assert.match(asked.text, /world \[allow-once\]/);

    const bad = await command.handler({ rawInput: 'nonsense' });
    assert.equal(bad.kind, 'error');

    const usage = await command.handler({ rawInput: 'ask' });
    assert.equal(usage.kind, 'error');
    assert.match(usage.text, /Usage:/);
  } finally {
    dispose();
  }
});

test('the command exposes and changes the agent\u2019s own selectors', async () => {
  // Session mode and reasoning level travel over ACP but appear nowhere in the
  // harness's UI, so without this they sit at the agent's default forever.
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, config);
  const command = registered.commands[0];
  try {
    const listed = await command.handler({ rawInput: 'options mock' });
    assert.equal(listed.kind, 'success');
    assert.match(listed.text, /mode/);
    assert.match(listed.text, /thought_level/);
    assert.match(listed.text, /Code/, 'the current value is named, not just its id');

    const setMode = await command.handler({ rawInput: 'set mock mode ask' });
    assert.equal(setMode.kind, 'success');
    assert.match(setMode.text, /mode = ask/);

    // `thought` is the friendly alias for the ACP id `thought_level`.
    const setThinking = await command.handler({ rawInput: 'set mock thought high' });
    assert.equal(setThinking.kind, 'success');
    assert.match(setThinking.text, /thought_level = high/);

    const refused = await command.handler({ rawInput: 'set mock mode nonsense' });
    assert.equal(refused.kind, 'error');
    assert.match(refused.text, /does not offer/);

    const usage = await command.handler({ rawInput: 'options' });
    assert.equal(usage.kind, 'error');
    assert.match(usage.text, /Usage:/);
  } finally {
    dispose();
  }
});

test('the picker filters reach the adapter through apply', () => {
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, {
    agents: [{
      id: 'mock',
      label: 'Mock Agent',
      command: process.execPath,
      args: [mock],
      cwd: scratch,
      models: ['adaptive', { id: 'swe-2-high', name: 'SWE-2' }],
      modelInclude: ['claude-*'],
      modelExclude: ['fusion-*', 'MODEL_*'],
    }],
  });
  try {
    const adapter = registered.adapters[0].adapter;
    assert.deepEqual(adapter.models, ['adaptive', { id: 'swe-2-high', name: 'SWE-2' }]);
    assert.deepEqual(adapter.modelInclude, ['claude-*']);
    assert.deepEqual(adapter.modelExclude, ['fusion-*', 'MODEL_*']);
  } finally {
    dispose();
  }
});

test('the catch-up budget is configurable, per agent or profile-wide', () => {
  // It used to be a hardcoded 12k that no config could reach, so a 342-turn
  // conversation was handed over as a sliver of its tail.
  const perAgent = fakeContext();
  const d1 = apply(perAgent.ctx, {
    agents: [{ id: 'mock', command: process.execPath, args: [mock], cwd: scratch, primeMaxChars: 777 }],
    sessionStoreDir: scratch,
  });
  try {
    assert.equal(perAgent.registered.adapters[0].adapter.primeMaxChars, 777);
  } finally {
    d1();
  }

  const perProfile = fakeContext();
  const d2 = apply(perProfile.ctx, {
    agents: [{ id: 'mock', command: process.execPath, args: [mock], cwd: scratch }],
    sessionStoreDir: scratch,
    primeMaxChars: 5000,
  });
  try {
    assert.equal(perProfile.registered.adapters[0].adapter.primeMaxChars, 5000);
  } finally {
    d2();
  }

  const byDefault = fakeContext();
  const d3 = apply(byDefault.ctx, {
    agents: [{ id: 'mock', command: process.execPath, args: [mock], cwd: scratch }],
    sessionStoreDir: scratch,
  });
  try {
    assert.equal(byDefault.registered.adapters[0].adapter.primeMaxChars, 48_000);
  } finally {
    d3();
  }
});

test('apply registers one model provider per agent, which is what populates the picker', () => {
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, config);
  try {
    assert.equal(registered.adapters.length, 1, 'one adapter route per configured agent');
    assert.deepEqual(registered.adapters[0].providers, ['acp-mock']);
    const adapter = registered.adapters[0].adapter;
    assert.equal(adapter.providerInfo('acp-mock').name, 'Mock Agent', 'the picker groups under the agent label');
    assert.equal(adapter.providerInfo('acp-mock').id, 'acp-mock');
  } finally {
    dispose();
  }
});

test('apply registers nothing with llm when no agent is configured', () => {
  const { ctx, registered } = fakeContext();
  const dispose = apply(ctx, { discover: false });
  try {
    assert.equal(registered.adapters.length, 0);
    assert.equal(registered.tools.length, 1, 'the delegation tool is still there');
  } finally {
    dispose();
  }
});

test('a discovered agent stays out of the picker unless asked for', () => {
  const { ctx, registered } = fakeContext();
  // Discovery finds whatever is installed on this machine; whatever it finds
  // must not be started merely because the model picker was opened.
  const dispose = apply(ctx, { discover: true });
  try {
    assert.equal(registered.adapters.length, 0, 'no provider is registered for a discovered agent by default');
  } finally {
    dispose();
  }
});

test('the workspace comes from the session, never from the harness process', () => {
  // The desktop harness is launched from ~/.dsh/profiles/desktop, so falling
  // back to process.cwd() silently pointed every external agent at the profile
  // directory instead of the user's project — which reads as "the agent is
  // broken" for reasons that have nothing to do with permissions.
  // `header` is the one that matters: `ctx.sessions.create(id, { meta: { cwd } })`
  // takes `meta` as INPUT, and the store keeps it as the session header — so
  // `session.header.cwd` is what a live Session exposes. Three other spellings
  // were tried first, and each one silently resolved to the fallback.
  assert.equal(
    sessionWorkspace({ session: { header: { cwd: '/Users/someone/Projects/Leziz' } } }, '/fallback'),
    '/Users/someone/Projects/Leziz',
    'session.header.cwd is the real one',
  );
  assert.equal(sessionWorkspace({ session: { meta: { cwd: '/workspace/project' } } }, '/fallback'), '/workspace/project');
  assert.equal(sessionWorkspace({ session: { cwd: '/legacy' } }, '/fallback'), '/legacy');
  assert.equal(sessionWorkspace({ session: { metadata: { cwd: '/older' } } }, '/fallback'), '/older');
  assert.equal(sessionWorkspace(null, '/fallback'), '/fallback', 'no session means the configured default');
  assert.equal(sessionWorkspace(undefined, '/fallback'), '/fallback');
  assert.equal(sessionWorkspace({}, '/fallback'), '/fallback');
  // A session that declares nothing must stay distinguishable from one that
  // does, which is what lets `list` report a fallback instead of hiding it.
  assert.equal(sessionWorkspace({ session: { header: {} } }, undefined), undefined);
});

test('a profile with no tools or commands still applies', () => {
  const { ctx, registered } = fakeContext();
  ctx.inject = () => undefined;
  const dispose = apply(ctx, { discover: false });
  assert.equal(registered.tools.length, 0);
  dispose();
});
