/**
 * The DSH side of the delegation bridge.
 *
 * An external agent (Claude Code on a subscription) cannot call `ctx.subagents`
 * itself — it is a separate process. So the plugin serves one tool, `delegate`,
 * over HTTP, and a stdio shim (`mcp-forward.mjs`) exposes it to the agent as MCP.
 *
 * Exactly one tool, on purpose. Delegation is a public service with its own
 * admission, depth and capacity rules; the general tool registry is not, and
 * invoking a tool's `execute` directly would skip `tools/pre-execute` and
 * `ctx.tools.guard` — the permission gate. A bridge that quietly bypasses
 * approvals is not worth having.
 *
 * Authorization is per **session**: each ACP session gets its own bearer token,
 * so a call is attributed to the harness session that spawned that session's shim
 * — and therefore to the right live parent agent.
 */

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  DEFAULT_CONTEXT_DIR, DEFAULT_ROUTES, QuotaLedger, REPORT_CONTRACT, TIER_HELP,
  candidateRoutes, classifyFailure, contextBlock, findProject, listProjects,
  parseReport, readWork, recordWork, rememberFact, retryAfterMs, splitRoute,
} from './superagent.mjs';

/** One ledger per context directory, shared by every bridge in the process. */
const ledgers = new Map();
function ledgerFor(contextDir) {
  if (!ledgers.has(contextDir)) ledgers.set(contextDir, new QuotaLedger({ file: join(contextDir, 'quota.json') }));
  return ledgers.get(contextDir);
}

/** The delegation tool. One call can carry several tasks; they run in parallel. */
export const DELEGATE_TOOL = {
  name: 'delegate',
  description:
    'Run work on DeepSeek Harness workers and return their answers. Put independent pieces of work in '
    + '`tasks` in ONE call: they run in parallel (this is how to parallelize; do not nest delegations, '
    + 'and do not call delegate once per task in sequence). Each worker runs in a fresh child session '
    + 'with the harness tools and the project\'s shared context; it cannot see this conversation, so each '
    + 'task must stand on its own. Prefer this over any subagent, swarm or workflow tool your own client '
    + 'provides: those run outside the harness and cannot see its models, tools or project context. '
    + 'Pick a `tier`, not a model: the harness chooses the model, skips routes '
    + 'that are out of quota and falls back automatically. Workers cannot delegate further. Each answer '
    + 'ends with a STATUS (done, blocked or failed).',
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        description: 'Independent tasks, run in parallel. Prefer this over `task`.',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The complete, self-contained task.' },
            label: { type: 'string', description: 'Short name, shown in the harness.' },
            tier: { type: 'string', enum: Object.keys(TIER_HELP), description: tierHelp() },
            cwd: { type: 'string', description: 'Working directory (default: yours).' },
            provider: { type: 'string', description: 'Only when the user named a model: route id, e.g. "acp-devin".' },
            model: { type: 'string', description: 'Only with `provider`: model id on that route.' },
          },
          required: ['task'],
        },
      },
      task: { type: 'string', description: 'A single task (same as `tasks` with one item).' },
      label: { type: 'string' },
      tier: { type: 'string', enum: Object.keys(TIER_HELP), description: tierHelp() },
      cwd: { type: 'string' },
      provider: { type: 'string', description: 'Only when the user named a model.' },
      model: { type: 'string' },
    },
  },
};

/** Read the shared project context. */
export const CONTEXT_TOOL = {
  name: 'project_context',
  description:
    'Read the shared, settled facts about a project (path, deploy target, build/test commands, '
    + 'conventions, decisions) from the harness context store. Call this BEFORE asking the user '
    + 'anything about how a project is built, deployed or configured. Without `project` it uses '
    + 'your working directory; `list: true` lists every known project. Also shows recent work '
    + 'and routes currently out of quota.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Project name, slug or path.' },
      list: { type: 'boolean' },
    },
  },
};

/** Write one durable fact into the shared project context. */
export const REMEMBER_TOOL = {
  name: 'remember',
  description:
    'Record one durable fact about a project in the shared context store so no agent has to ask '
    + 'again (e.g. "deploys with `pnpm deploy` to Cloudflare Pages project admin-ui"). Only settled '
    + 'facts, not progress notes.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Project name, slug or path.' },
      fact: { type: 'string' },
    },
    required: ['project', 'fact'],
  },
};

function tierHelp() {
  return `Worker tier (default fast). ${Object.entries(TIER_HELP).map(([k, v]) => `${k}: ${v}`).join('; ')}.`;
}

/** Render an activation result, whatever shape it arrives in. */
export function resultText(result) {
  if (typeof result === 'string') return result;
  if (result === null || typeof result !== 'object') return String(result ?? '');
  if (typeof result.text === 'string') return result.text;
  // A managed activation resolves to `{ output, stopReason }`.
  const content = result.output ?? result.content ?? result.message?.content;
  if (Array.isArray(content)) {
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    if (text.length > 0) return text;
  }
  // Say what happened rather than handing the agent a bare blob.
  if (typeof result.stopReason === 'string' && result.stopReason !== 'completed' && result.stopReason !== 'end_turn') {
    return `the worker stopped with "${result.stopReason}" and returned no text: ${JSON.stringify(result).slice(0, 1500)}`;
  }
  return JSON.stringify(result).slice(0, 4000);
}

/**
 * Serve the delegation endpoint.
 *
 * @param options.subagents - the live `ctx.subagents` service.
 * @param options.bind - `(sessionKey, agent)` remembers the live parent agent.
 * @param options.authorize - `(sessionKey)` mints a token for that session.
 * @param options.provider - subagent provider name (default `spawn`).
 * @param options.agentOptions - worker route, e.g. `{ provider: 'opencode-go', model: '…' }`.
 * @param options.log - diagnostics sink.
 * @returns `{ url, tokenFor, close }`.
 */
export function createDelegateEndpoint(options) {
  const provider = options.provider ?? 'spawn';
  /** How long a delegation may block before the caller is told it is still running. */
  // An hour, not minutes: a real worker on a real task ran 48 minutes on one
  // call. A shorter default would abandon work that was about to pay off. `0`
  // keeps waiting indefinitely.
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 3_600_000;
  /** How often a running delegation reports that it is alive. */
  const progressEveryMs = Number.isFinite(options.progressEveryMs) ? options.progressEveryMs : 30_000;
  // Resolved per call, never captured: at plugin-load time the subagent service
  // may not be mounted yet, and a load-time lookup silently disables the bridge.
  const service = () => (typeof options.getSubagents === 'function'
    ? options.getSubagents()
    : options.subagents);
  const log = typeof options.log === 'function' ? options.log : () => {};
  /** token → sessionKey */
  const sessions = new Map();
  /** sessionKey → live parent agent */
  const parents = new Map();
  /** Superagent settings. */
  const contextDir = typeof options.contextDir === 'string' && options.contextDir.length > 0 ? options.contextDir : DEFAULT_CONTEXT_DIR;
  const routes = { ...DEFAULT_ROUTES, ...(options.routes !== null && typeof options.routes === 'object' ? options.routes : {}) };
  const defaultTier = typeof options.defaultTier === 'string' && routes[options.defaultTier] !== undefined ? options.defaultTier : 'fast';
  // The profile's configured worker route stays the first choice of the default tier.
  if (typeof options.agentOptions?.provider === 'string') {
    const configured = `${options.agentOptions.provider}${options.agentOptions.model ? `/${options.agentOptions.model}` : ''}`;
    routes[defaultTier] = [configured, ...routes[defaultTier].filter((route) => route !== configured)];
  }
  // 1 = a worker cannot delegate again. Nested delegation (an Opus worker that
  // spawns a Flash worker that does the work) only multiplies tokens.
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth > 0 ? options.maxDepth : 1;
  const maxParallel = Number.isInteger(options.maxParallel) && options.maxParallel > 0 ? options.maxParallel : 4;
  const ledger = options.ledger ?? ledgerFor(contextDir);
  const sleep = options.sleep ?? ((ms) => new Promise((done) => { const t = setTimeout(done, ms); t.unref?.(); }));

  /** Turn the tool arguments into a list of tasks. */
  const normalizeTasks = (args) => {
    const raw = Array.isArray(args.tasks) && args.tasks.length > 0 ? args.tasks : [args];
    return raw
      .map((item) => ({
        task: String(item?.task ?? '').trim(),
        label: String(item?.label ?? item?.task ?? '').trim().slice(0, 80),
        tier: typeof item?.tier === 'string' && routes[item.tier] !== undefined ? item.tier
          : (typeof args.tier === 'string' && routes[args.tier] !== undefined ? args.tier : defaultTier),
        cwd: typeof item?.cwd === 'string' && item.cwd.trim().length > 0 ? item.cwd.trim()
          : (typeof args.cwd === 'string' && args.cwd.trim().length > 0 ? args.cwd.trim() : undefined),
        provider: typeof item?.provider === 'string' ? item.provider.trim() : undefined,
        model: typeof item?.model === 'string' ? item.model.trim() : undefined,
      }))
      .filter((item) => item.task.length > 0);
  };

  /** What `project_context` answers. */
  const contextReport = (args, sessionKey) => {
    if (args.list === true) {
      const all = listProjects(contextDir);
      return all.length === 0
        ? `No project cards yet in ${contextDir}/projects.`
        : all.map((p) => `- ${p.slug}: ${p.meta.path ?? ''}${p.meta.deploy ? ` — deploy: ${p.meta.deploy}` : ''}`).join('\n');
    }
    const cwd = cwdFor(sessionKey);
    const card = findProject({ query: args.project, cwd: args.project ? undefined : cwd }, contextDir);
    const parts = [];
    if (card === undefined) {
      parts.push(`No project card matches ${args.project ? `"${args.project}"` : `the working directory ${cwd ?? '(unknown)'}`}. `
        + `Known: ${listProjects(contextDir).map((p) => p.slug).join(', ') || '(none)'}. Read the repo (README, package.json scripts, `
        + 'deploy configs) and record what you settle with `remember`.');
    } else {
      parts.push(card.text.trim());
      const recent = readWork({ days: 14 }, contextDir).filter((w) => w.project === card.slug).slice(0, 8);
      if (recent.length > 0) {
        parts.push(`\n## Recent delegated work\n${recent.map((w) => `- ${w.at.slice(0, 16)} ${w.status} ${w.label} (${w.route})${w.note ? ` — ${w.note}` : ''}`).join('\n')}`);
      }
    }
    const cooled = ledger.snapshot();
    if (Object.keys(cooled).length > 0) {
      parts.push(`\n## Routes out of quota now\n${Object.entries(cooled).map(([r, e]) => `- ${r}: ${e.minutesLeft} min left`).join('\n')}`);
    }
    return parts.join('\n');
  };

  /** Run one task on its route chain, with transient retry and quota fallback. */
  const runTask = async (item, state, { parent, subagents, sessionKey }) => {
    const cwd = item.cwd ?? cwdFor(sessionKey);
    const card = findProject({ cwd }, contextDir);
    const prompt = [contextBlock(card), item.task, REPORT_CONTRACT].filter((part) => part.length > 0).join('\n\n');
    const chain = candidateRoutes({ tier: item.tier, provider: item.provider, model: item.model, routes, defaultTier, ledger });
    const tried = [];
    const started = Date.now();
    // One id per task, written twice: at the start so the cockpit can show work
    // in flight, and at the end so the start record is known to be finished. A
    // start with no end is the only way to tell "still working" from "died".
    const workId = randomUUID();
    recordWork({ id: workId, phase: 'start', session: sessionKey, label: item.label, tier: item.tier, status: 'running', project: card?.slug, cwd }, contextDir);
    let last = { text: 'no route available', route: '' };
    for (const route of chain) {
      const { provider: llmProvider, model } = splitRoute(route);
      state.route = route;
      state.status = 'running';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const outcome = await activate({ subagents, parent, prompt, label: item.label, cwd: item.cwd, agentOptions: { provider: llmProvider, ...(model ? { model } : {}) } });
        if (outcome.ok) {
          const report = parseReport(outcome.text);
          state.status = report.status;
          const result = { ...item, route, tried, text: outcome.text, ...report, ms: Date.now() - started, project: card?.slug, childId: outcome.childId };
          for (const fact of report.facts) {
            if (card === undefined) continue;
            try { rememberFact({ project: card.slug, fact, source: `worker ${route}` }, contextDir); } catch { /* best effort */ }
          }
          recordWork({ id: workId, phase: 'end', session: sessionKey, label: item.label, tier: item.tier, route, tried, status: report.status, note: report.note.slice(0, 300), project: card?.slug, cwd, ms: result.ms }, contextDir);
          log(`[delegate] ${sessionKey} ${item.label.slice(0, 40)} → ${report.status} on ${route}`);
          return result;
        }
        last = { text: outcome.text, route };
        const kind = classifyFailure(outcome.text);
        if (kind === 'quota') {
          ledger.cool(route, outcome.text, retryAfterMs(outcome.text));
          tried.push(`${route} (quota)`);
          log(`[delegate] ${route} out of quota; cooled, trying next route`);
          break;
        }
        if (kind === 'transient' && attempt === 0) {
          log(`[delegate] ${route} transient failure, retrying once: ${outcome.text.slice(0, 120)}`);
          await sleep(2000);
          continue;
        }
        tried.push(`${route} (${kind})`);
        // A non-quota failure is about the task or the route itself; trying the
        // next route still beats handing the caller nothing.
        break;
      }
    }
    state.status = 'failed';
    const result = { ...item, route: last.route, tried, text: last.text, status: 'failed', note: last.text.slice(0, 300), facts: [], ms: Date.now() - started, project: card?.slug };
    recordWork({ id: workId, phase: 'end', session: sessionKey, label: item.label, tier: item.tier, route: last.route, tried, status: 'failed', note: result.note, project: card?.slug, cwd, ms: result.ms }, contextDir);
    return result;
  };

  /** One activation on one route; never throws. */
  const activate = async ({ subagents, parent, prompt, label, cwd, agentOptions }) => {
    try {
      const request = {
        prompt: [{ type: 'text', text: prompt }],
        parent,
        ...(cwd === undefined ? {} : { cwd }),
        maxDepth,
        agentOptions: { ...(options.agentOptions ?? {}), ...agentOptions },
      };
      const activation = await subagents.startActivation({
        provider,
        label,
        // DSH 0.2.2 flattened this request into the activation spec; keeping the
        // old `request` object too makes one build work on 0.2.1 and 0.2.2.
        ...request,
        request,
        delivery: 'caller',
        signal: new AbortController().signal,
      });
      const result = timeoutMs > 0
        ? await Promise.race([
          activation.result,
          new Promise((done) => { const timer = setTimeout(() => done(null), timeoutMs); timer.unref?.(); }),
        ])
        : await activation.result;
      if (result === null) {
        return {
          ok: true,
          childId: activation.childId,
          text: `The worker is still running after ${Math.round(timeoutMs / 60_000) || 1} minute(s) (child ${activation.childId}). `
            + 'It was NOT cancelled. Do not start the same task again.\nSTATUS: blocked — still running',
        };
      }
      const text = resultText(result);
      const stop = typeof result?.stopReason === 'string' ? result.stopReason : '';
      if (stop === 'error' || stop === 'failed' || (/^the worker stopped with "/.test(text) && classifyFailure(text) !== 'other')) {
        return { ok: false, text };
      }
      return { ok: true, childId: activation.childId, text: text.length > 0 ? text : '(the worker returned no text)' };
    } catch (error) {
      return { ok: false, text: `${String(error?.name ?? 'Error')}: ${String(error?.message ?? error)}` };
    }
  };

  /** The parent session's working directory, when the adapter told us. */
  const cwdFor = (sessionKey) => cwds.get(sessionKey);
  const cwds = new Map();

  /** Mint (or reuse) the token for one harness session. */
  const tokenFor = (sessionKey) => {
    for (const [token, key] of sessions) if (key === sessionKey) return token;
    const token = randomUUID();
    sessions.set(token, sessionKey);
    return token;
  };

  const server = createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    /**
     * A streaming reply: every line is one JSON-RPC message, so a tool that runs
     * for an hour can report progress instead of going silent until it finishes.
     */
    let streaming = false;
    const openStream = () => {
      streaming = true;
      response.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'cache-control': 'no-store',
      });
    };
    const emit = (message) => {
      if (!streaming) openStream();
      response.write(JSON.stringify(message) + '\n');
    };
    const finish = (message) => {
      emit(message);
      response.end();
    };
    if (request.method !== 'POST') return reply(405, { error: 'POST only' });

    const auth = String(request.headers.authorization ?? '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const sessionKey = sessions.get(token);
    if (sessionKey === undefined) return reply(401, { error: 'unauthorized' });

    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', async () => {
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        return reply(400, { error: 'bad json' });
      }
      const { id, method, params } = message;
      const answer = (result) => finish({ jsonrpc: '2.0', id, result });
      /**
       * Answer anything this endpoint does not implement.
       *
       * A client that opens with a method we ignore waits forever: Antigravity's
       * `agy acp` starts with `server/discover`, and because no response was ever
       * written the MCP server never finished initializing, so the agent was
       * handed no tools at all — the `delegate` tool silently did not exist.
       * Notifications still get no reply, per JSON-RPC.
       */
      const unimplemented = () => {
        if (id === undefined) {
          response.writeHead(202);
          return response.end();
        }
        return answer({});
      };
      const fail = (text) => finish({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text }], isError: true },
      });

      if (method === 'initialize') {
        return answer({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dsh', version: '1' } });
      }
      if (method === 'tools/list') return answer({ tools: [DELEGATE_TOOL, CONTEXT_TOOL, REMEMBER_TOOL] });
      if (method === 'server/discover') return answer({});
      if (method === 'ping') return answer({});
      if (typeof method === 'string' && method.startsWith('notifications/')) {
        response.writeHead(202);
        return response.end();
      }
      if (method === 'tools/call') {
        const args = params?.arguments ?? {};
        if (params?.name === CONTEXT_TOOL.name) {
          try {
            return answer({ content: [{ type: 'text', text: contextReport(args, sessionKey) }] });
          } catch (error) {
            return fail(String(error?.message ?? error));
          }
        }
        if (params?.name === REMEMBER_TOOL.name) {
          try {
            const { slug, line } = rememberFact({ project: String(args.project ?? ''), fact: String(args.fact ?? ''), source: 'agent' }, contextDir);
            log(`[delegate] ${sessionKey} remembered in ${slug}: ${line.slice(0, 80)}`);
            return answer({ content: [{ type: 'text', text: `Recorded in ${slug}: ${line}` }] });
          } catch (error) {
            return fail(String(error?.message ?? error));
          }
        }
        if (params?.name !== DELEGATE_TOOL.name) return fail(`unknown tool ${String(params?.name)}`);

        const items = normalizeTasks(args);
        if (items.length === 0) return fail('delegate needs `tasks` (or `task`) with a non-empty task');
        const parent = parents.get(sessionKey);
        if (parent === undefined) {
          log(`[delegate] ${sessionKey} refused: no live parent bound`);
          return fail('no live harness session to delegate from; send a message first');
        }
        const subagents = service();
        if (subagents === undefined || subagents === null) {
          log(`[delegate] ${sessionKey} refused: no subagent service mounted`);
          return fail('this harness has no subagent service mounted, so there is nothing to delegate to');
        }

        const progressToken = params?._meta?.progressToken ?? params?.progressToken;
        const startedAt = Date.now();
        const states = items.map((item) => ({ label: item.label, route: '', status: 'queued' }));
        let heartbeat;
        if (progressToken !== undefined && progressEveryMs > 0) {
          heartbeat = setInterval(() => {
            const seconds = Math.round((Date.now() - startedAt) / 1000);
            const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
            const summary = states.map((st) => `${st.label.slice(0, 30)}: ${st.status}${st.route ? ` on ${st.route}` : ''}`).join(' | ');
            emit({
              jsonrpc: '2.0',
              method: 'notifications/progress',
              params: { progressToken, progress: seconds, message: `${items.length} worker(s) still running (${elapsed}): ${summary}`.slice(0, 400) },
            });
          }, progressEveryMs);
          heartbeat.unref?.();
        }
        try {
          log(`[delegate] ${sessionKey} → ${items.length} task(s): ${items.map((i) => `${i.label.slice(0, 40)} [${i.tier}]`).join(', ')}`);
          const results = await runLimited(items, maxParallel, (item, index) => runTask(item, states[index], { parent, subagents, sessionKey }));
          const text = results.length === 1 && items.length === 1 && !Array.isArray(args.tasks)
            ? renderOne(results[0])
            : renderMany(results, Date.now() - startedAt);
          return answer({ content: [{ type: 'text', text }], ...(results.every((r) => r.status === 'failed') ? { isError: true } : {}) });
        } catch (error) {
          log(`[delegate] ${sessionKey} failed: ${String(error?.message ?? error)}`);
          return fail(`delegation failed: ${String(error?.name ?? 'Error')}: ${String(error?.message ?? error)}`);
        } finally {
          if (heartbeat !== undefined) clearInterval(heartbeat);
        }
      }
      if (id === undefined) return reply(200, {});
      return answer({});
    });
  });

  return {
    /** Bind the live agent for one session; called at each turn. */
    bind(sessionKey, agent, cwd) {
      if (agent === null || agent === undefined) parents.delete(sessionKey);
      else parents.set(sessionKey, agent);
      if (typeof cwd === 'string' && cwd.length > 0) cwds.set(sessionKey, cwd);
    },
    /** Remember a session's working directory for context lookup. */
    setCwd(sessionKey, cwd) {
      if (typeof cwd === 'string' && cwd.length > 0) cwds.set(sessionKey, cwd);
    },
    tokenFor,
    /** Start listening on a loopback port. */
    async listen() {
      await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
      const { port } = server.address();
      log(`[delegate] listening on 127.0.0.1:${port}`);
      return `http://127.0.0.1:${port}/mcp`;
    },
    close() {
      server.close();
    },
  };
}

/** Run `fn` over `items` with at most `limit` running at once, keeping order. */
export async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

function seconds(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function renderOne(result) {
  const fallback = result.tried.length > 0 ? `\n\n_(route: ${result.route}; skipped ${result.tried.join(', ')})_` : '';
  return `${result.text}${fallback}`;
}

function renderMany(results, ms) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const head = `${results.length} worker(s) in parallel, ${seconds(ms)}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`;
  const body = results.map((r, i) => [
    `### ${i + 1}. ${r.label} — ${r.status.toUpperCase()} (${r.route}, ${seconds(r.ms)})`,
    r.tried.length > 0 ? `_skipped: ${r.tried.join(', ')}_` : '',
    r.text.trim(),
  ].filter((part) => part.length > 0).join('\n')).join('\n\n---\n\n');
  return `${head}\n\n${body}`;
}
