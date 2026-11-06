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

/** The single tool this bridge offers. */
export const DELEGATE_TOOL = {
  name: 'delegate',
  description:
    'Delegate a self-contained task to a DeepSeek Harness worker and return its answer. '
    + 'The worker runs on the harness\'s own model route, in a fresh child session, with the '
    + 'harness tools. Give it everything it needs: it cannot see this conversation.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The complete task for the worker, standing on its own.' },
      label: { type: 'string', description: 'Short name for this delegation, shown in the harness.' },
    },
    required: ['task'],
  },
};

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
      const fail = (text) => finish({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text }], isError: true },
      });

      if (method === 'initialize') {
        return answer({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dsh', version: '1' } });
      }
      if (method === 'tools/list') return answer({ tools: [DELEGATE_TOOL] });
      if (method === 'tools/call') {
        if (params?.name !== DELEGATE_TOOL.name) return fail(`unknown tool ${String(params?.name)}`);
        const task = String(params?.arguments?.task ?? '').trim();
        if (task.length === 0) return fail('delegate needs a task');
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

        const label = String(params?.arguments?.label ?? task.slice(0, 60));
        const progressToken = params?._meta?.progressToken ?? params?.progressToken;
        log(`[delegate] ${sessionKey} → ${label.slice(0, 80)}`);
        let heartbeat;
        let settled = false;
        try {
          const activation = await subagents.startActivation({
            provider,
            label,
            request: {
              prompt: [{ type: 'text', text: task }],
              parent,
              ...(options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions }),
            },
            // `caller` awaits the child's result instead of notifying the parent,
            // which is what a tool call needs.
            delivery: 'caller',
            // The service calls `signal.throwIfAborted()` before doing anything,
            // so a request with no signal dies with a TypeError. An MCP call has
            // no cancellation channel, so this turn's own controller is enough.
            signal: new AbortController().signal,
          });
          // Announce liveness while it runs. Without this a worker that takes
          // most of an hour is indistinguishable from a hang, which is exactly
          // how it looked when it was first used.
          if (progressToken !== undefined && progressEveryMs > 0) {
            const startedAt = Date.now();
            heartbeat = setInterval(() => {
              const seconds = Math.round((Date.now() - startedAt) / 1000);
              const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
              emit({
                jsonrpc: '2.0',
                method: 'notifications/progress',
                params: {
                  progressToken,
                  progress: seconds,
                  message: `worker ${activation.childId} still running (${elapsed}): ${label.slice(0, 60)}`,
                },
              });
            }, progressEveryMs);
            heartbeat.unref?.();
          }

          const result = timeoutMs > 0
            ? await Promise.race([
              activation.result,
              new Promise((resolve) => {
                const timer = setTimeout(() => resolve(null), timeoutMs);
                timer.unref?.();
              }),
            ])
            : await activation.result;
          if (result === null) {
            // Not cancelled: the work is real and may still finish.
            log(`[delegate] ${sessionKey} still running after ${Math.round(timeoutMs / 1000)}s; left alive`);
            return finish({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{
                  type: 'text',
                  text: `The worker is still running after ${Math.round(timeoutMs / 60_000) || 1} minute(s) `
                    + `(child ${activation.childId}). It was NOT cancelled. Do not delegate the same task again; `
                    + 'narrow the ask or wait and check its output.',
                }],
                isError: false,
              },
            });
          }
          const text = resultText(result);
          log(`[delegate] ${sessionKey} done → ${text.slice(0, 80)}`);
          if (text.trim().length === 0) log(`[delegate] empty result shape: ${JSON.stringify(result).slice(0, 300)}`);
          return answer({ content: [{ type: 'text', text: text.length > 0 ? text : '(the worker returned no text)' }] });
        } catch (error) {
          log(`[delegate] ${sessionKey} failed: ${String(error?.message ?? error)}`);
          return fail(`delegation failed: ${String(error?.name ?? 'Error')}: ${String(error?.message ?? error)}`);
        } finally {
          if (heartbeat !== undefined) clearInterval(heartbeat);
          settled = true;
        }
      }
      if (id === undefined) return reply(200, {});
      return answer({});
    });
  });

  return {
    /** Bind the live agent for one session; called at each turn. */
    bind(sessionKey, agent) {
      if (agent === null || agent === undefined) parents.delete(sessionKey);
      else parents.set(sessionKey, agent);
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
