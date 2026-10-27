// node --test fleet/executors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT, DSH_FAMILY, EXECUTORS, SYSTEM_ORDER, briefInput, claudeResult, dshAgentOverlay, fallbackChain, findSessionLog, isQuotaError, parseDshEvents, stepsOf } from './executors.mjs';

const SAMPLE = `{"type":"session","sessionId":"session-db44e5d2-8897-4d5e-9a9f-b96070283d22","cwd":"/private/tmp/dshjson"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"thinking","text":""}
{"type":"text","text":"ok"}
{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":4729,"outputTokens":2,"cacheReadTokens":5376,"cacheWriteTokens":0,"totalTokens":10107}}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}
{"type":"final","text":"ok"}
`;

test('parseDshEvents: the real sample', () => {
  assert.deepEqual(parseDshEvents(SAMPLE), {
    sessionId: 'session-db44e5d2-8897-4d5e-9a9f-b96070283d22',
    text: 'ok',
    completed: true,
    usage: { inputTokens: 4729, outputTokens: 2, totalTokens: 10107 },
    turns: 1,
  });
});

test('parseDshEvents: an interrupted turn with no final event', () => {
  const out = parseDshEvents(
    [
      '{"type":"session","sessionId":"session-x"}',
      '{"type":"status","phase":"turn_start","turn":1}',
      '{"type":"text","text":"half "}',
      'some stray log line',
      '{"type":"text","text":"done"}',
      '{"type":"status","phase":"step_end","usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}',
      '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"interrupted"}}',
      '{"broken json',
    ].join('\n'),
  );
  assert.equal(out.sessionId, 'session-x');
  assert.equal(out.text, 'half done');
  assert.equal(out.completed, false);
  assert.equal(out.turns, 1);
  assert.deepEqual(out.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test('parseDshEvents: non-JSON output falls back to the raw text', () => {
  const out = parseDshEvents('  Plain answer from an old dsh.\nSecond line.\n');
  assert.equal(out.sessionId, null);
  assert.equal(out.text, 'Plain answer from an old dsh.\nSecond line.');
  assert.equal(out.completed, false);
  assert.equal(out.turns, 0);
  assert.equal(parseDshEvents('').text, '');
});

test('parseDshEvents: several turns sum usage and count turns', () => {
  const lines = ['{"type":"session","sessionId":"session-multi"}'];
  for (let t = 1; t <= 3; t++) {
    lines.push(`{"type":"status","phase":"turn_start","turn":${t}}`);
    for (let s = 1; s <= 2; s++) {
      lines.push(`{"type":"status","phase":"step_end","turn":${t},"step":${s},"usage":{"inputTokens":100,"outputTokens":10,"totalTokens":110}}`);
    }
    lines.push(`{"type":"text","text":"turn ${t}. "}`);
    lines.push(`{"type":"status","phase":"turn_end","turn":${t},"reason":{"kind":"${t === 3 ? 'completed' : 'tool_use'}"}}`);
  }
  lines.push('{"type":"final","text":"the final answer"}');
  const out = parseDshEvents(lines.join('\n'));
  assert.equal(out.turns, 3);
  assert.equal(out.completed, true);
  assert.equal(out.text, 'the final answer');
  assert.deepEqual(out.usage, { inputTokens: 600, outputTokens: 60, totalTokens: 660 });
});

test('dshAgentOverlay: claude, defaults', () => {
  const yaml = dshAgentOverlay('claude', {});
  assert.match(yaml, /^- id: external-agents\n/);
  assert.match(yaml, /- id: claude\n {8}label: "Claude Code"\n {8}command: "claude-agent-acp"\n {8}args: \[\]/);
  assert.match(yaml, /- id: opencode\n {8}label: "opencode"\n {8}command: "opencode"\n {8}args: \["acp"\]/);
  assert.match(yaml, /- id: agent-default-model\n {2}name: "@deepseek-ai\/dsh-agent-default-model"\n {2}config:\n {4}provider: acp-claude\n {4}model: "opus"\n/);
  // The LLM title would ask the external agent mid-turn and steal the turn's answer.
  assert.match(yaml, /- id: session-title-llm\n {2}disabled: true\n$/);
  assert.match(yaml, /discover: false\n {4}expose: explicit\n {4}envMode: minimal/);
});

test('dshAgentOverlay: opencode with a configured command defaults to the free DeepSeek', () => {
  const yaml = dshAgentOverlay('opencode', { agentCommand: '/opt/bin/opencode' });
  assert.match(yaml, /command: "\/opt\/bin\/opencode"/);
  assert.match(yaml, /command: "claude-agent-acp"/); // the other agent keeps its default
  assert.match(yaml, /provider: acp-opencode\n {4}model: "opencode\/deepseek-v4.1-flash-free"\n/);
  assert.match(dshAgentOverlay('opencode', { model: 'gpt-5' }), /provider: acp-opencode\n {4}model: "gpt-5"\n/);
  assert.throws(() => dshAgentOverlay('nope'));
});

test('dshAgentOverlay: devin runs SWE-2 over `devin acp`', () => {
  const yaml = dshAgentOverlay('devin', {});
  assert.match(yaml, /- id: devin\n {8}label: "Devin"\n {8}command: "devin"\n {8}args: \["acp"\]/);
  assert.match(yaml, /provider: acp-devin\n {4}model: "swe-2-high"\n/);
  assert.ok(EXECUTORS['dsh-devin']);
  assert.ok(DSH_FAMILY.includes('dsh-devin'));
});

test('isQuotaError: limits read as limits, task failures do not', () => {
  assert.ok(isQuotaError("You've hit your monthly spend limit · raise it at https://claude.ai/settings/usage"));
  assert.ok(isQuotaError('Error: 429 Too Many Requests'));
  assert.ok(isQuotaError('rate_limit_error: usage limit reached, resets at 11pm'));
  assert.ok(isQuotaError('Insufficient balance on your account'));
  assert.ok(!isQuotaError('npm test failed: 3 assertions'));
  assert.ok(!isQuotaError(''));
});

test('fallbackChain: system work tries the claimed executor, then Harness first', () => {
  const all = ['claude', 'opencode', 'dsh', 'devin', 'dsh-claude', 'dsh-opencode', 'dsh-devin'];
  assert.deepEqual(fallbackChain('dsh-claude', all, 'system'), ['dsh-claude', 'dsh', 'dsh-devin', 'dsh-opencode', 'devin', 'claude', 'opencode']);
  assert.deepEqual(fallbackChain('opencode', ['opencode', 'dsh', 'dsh-opencode'], 'system'), ['opencode', 'dsh', 'dsh-opencode']);
  assert.deepEqual(fallbackChain('claude', all, 'client'), ['claude']);
  // A quota on one form of an account covers the other.
  assert.equal(ACCOUNT['dsh-claude'], ACCOUNT.claude);
  assert.equal(ACCOUNT['dsh-devin'], ACCOUNT.devin);
  assert.deepEqual(SYSTEM_ORDER.filter((e) => !EXECUTORS[e]), []);
});

test('findSessionLog scans the encoded dirs', () => {
  const home = mkdtempSync(join(tmpdir(), 'dshhome-'));
  try {
    const dir = '--Users-x-.cache-worktrees-app-task-7-run12--';
    mkdirSync(join(home, 'sessions', 'other'), { recursive: true });
    mkdirSync(join(home, 'sessions', dir, 'session-abc'), { recursive: true });
    writeFileSync(join(home, 'sessions', dir, 'session-abc', 'session.v4.jsonl.zstd'), 'x');
    assert.deepEqual(findSessionLog('session-abc', home), {
      file: join(home, 'sessions', dir, 'session-abc', 'session.v4.jsonl.zstd'),
      dir,
    });
    assert.equal(findSessionLog('session-missing', home), null);
    assert.equal(findSessionLog('../etc', home), null);
    assert.equal(findSessionLog('session-abc', join(home, 'nope')), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('dsh executors end to end with a fake dsh', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fakedsh-'));
  try {
    const bin = join(tmp, 'dsh');
    // Records its argv and stdin, then prints the real sample.
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${tmp}/argv"\ncat > "${tmp}/stdin"\ncat <<'EOF'\n${SAMPLE}EOF\necho "diag" >&2\n`,
    );
    chmodSync(bin, 0o755);

    const plain = await EXECUTORS.dsh({ prompt: 'do it', cwd: tmp, system: 'SYS', config: { bin }, signal: new AbortController().signal });
    assert.equal(plain.ok, true);
    assert.equal(plain.text, 'ok');
    assert.equal(plain.sessionId, 'session-db44e5d2-8897-4d5e-9a9f-b96070283d22');
    assert.equal(plain.turns, 1);
    assert.deepEqual(readFileSync(join(tmp, 'argv'), 'utf8').trim().split('\n'), ['--profile', 'headless', '--json', '-']);
    assert.equal(readFileSync(join(tmp, 'stdin'), 'utf8'), 'SYS\n\ndo it');

    const overlayDir = join(tmp, 'cfg');
    const viaClaude = await EXECUTORS['dsh-claude']({
      prompt: 'p',
      cwd: tmp,
      system: 's',
      config: { bin, profile: 'work', model: 'sonnet', overlayDir },
      signal: new AbortController().signal,
    });
    assert.equal(viaClaude.ok, true);
    assert.equal(viaClaude.model, 'sonnet');
    const overlay = join(overlayDir, 'dsh-agent-claude.patch.yml');
    assert.deepEqual(readFileSync(join(tmp, 'argv'), 'utf8').trim().split('\n'), ['--profile', 'work', '--patch', overlay, '--json', '-']);
    assert.match(readFileSync(overlay, 'utf8'), /provider: acp-claude\n {4}model: "sonnet"/);

    await EXECUTORS['dsh-opencode']({ prompt: 'p', cwd: tmp, system: 's', config: { bin, overlayDir }, signal: new AbortController().signal });
    assert.match(readFileSync(join(overlayDir, 'dsh-agent-opencode.patch.yml'), 'utf8'), /provider: acp-opencode\n {4}model: "opencode\/deepseek-v4.1-flash-free"\n/);

    // A failing dsh with no stdout: stderr is the text, ok is false.
    writeFileSync(bin, '#!/bin/sh\ncat >/dev/null\necho "no provider key" >&2\nexit 3\n');
    const failed = await EXECUTORS.dsh({ prompt: 'p', cwd: tmp, system: 's', config: { bin }, signal: new AbortController().signal });
    assert.equal(failed.ok, false);
    assert.equal(failed.text, 'no provider key');
    assert.equal(failed.sessionId, null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Event lines as the agents really print them (trimmed), for the live step log.
test('stepsOf dsh: tool calls, failed results, text and an errored turn', () => {
  const lines = [
    '{"type":"tool_call","callId":"c1","tool":"bash","input":{"command":"ls","description":"List files"}}',
    '{"type":"tool_result","callId":"c1","status":"completed","result":"err.txt\\n"}',
    '{"type":"tool_result","callId":"c2","status":"failed","result":"permission denied"}',
    '{"type":"text","text":"done"}',
    '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","message":"NO_ADAPTER"}}',
    '{"type":"status","phase":"step_end"}',
    'not json',
  ];
  assert.deepEqual(lines.flatMap((l) => stepsOf('dsh', l)), [
    { kind: 'tool', text: 'bash ls' },
    { kind: 'error', text: 'failed: permission denied' },
    { kind: 'text', text: 'done' },
    { kind: 'error', text: 'NO_ADAPTER' },
  ]);
});

test('stepsOf claude: stream-json assistant blocks, tool errors, a failed result', () => {
  const lines = [
    '{"type":"system","subtype":"init","session_id":"x"}',
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""},{"type":"tool_use","name":"Bash","input":{"command":"ls","description":"List"}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","content":"err.txt","is_error":false}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","content":"No such file","is_error":true}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}',
    '{"type":"result","subtype":"error_max_budget_usd","is_error":true}',
  ];
  assert.deepEqual(lines.flatMap((l) => stepsOf('claude', l)), [
    { kind: 'tool', text: 'Bash ls' },
    { kind: 'error', text: 'No such file' },
    { kind: 'text', text: 'done' },
    { kind: 'error', text: 'error_max_budget_usd' },
  ]);
});

test('stepsOf opencode: tool_use and text parts', () => {
  const lines = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"tool_use","part":{"type":"tool","tool":"shell","state":{"status":"completed","input":{"command":"ls"}}}}',
    '{"type":"tool_use","part":{"type":"tool","tool":"edit","state":{"status":"error","input":{"filePath":"a.txt"},"error":"not found"}}}',
    '{"type":"text","part":{"type":"text","text":"Done."}}',
  ];
  assert.deepEqual(lines.flatMap((l) => stepsOf('opencode', l)), [
    { kind: 'tool', text: 'shell ls' },
    { kind: 'error', text: 'edit a.txt: not found' },
    { kind: 'text', text: 'Done.' },
  ]);
});

test('briefInput: the telling field, one short line', () => {
  assert.equal(briefInput({ command: 'npm   test\n -- --watch' }), 'npm test -- --watch');
  assert.equal(briefInput({ file_path: '/a/b.js', content: 'x'.repeat(999) }), '/a/b.js');
  assert.equal(briefInput({ foo: 1 }), '{"foo":1}');
  assert.equal(briefInput(null), '');
  assert.equal(briefInput('x'.repeat(300)).length, 200);
});

test('claudeResult: the last result event of a stream, or a whole JSON object', () => {
  const stream = '{"type":"system","subtype":"init"}\n{"type":"assistant","message":{"content":[]}}\n{"type":"result","result":"done","total_cost_usd":0.0034,"num_turns":2,"is_error":false}\n';
  assert.deepEqual(claudeResult(stream), { type: 'result', result: 'done', total_cost_usd: 0.0034, num_turns: 2, is_error: false });
  assert.equal(claudeResult('{"result":"plain json","is_error":false}').result, 'plain json');
  assert.deepEqual(claudeResult('Error: not logged in'), {});
});
