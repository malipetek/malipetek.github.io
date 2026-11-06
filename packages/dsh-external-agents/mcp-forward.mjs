/**
 * MCP over stdio, forwarded to an HTTP endpoint.
 *
 * The DSH plugin runs inside the harness and has `ctx.subagents`, but an ACP
 * agent can only spawn a **process**. This shim is that process: it speaks MCP
 * on stdin/stdout and relays each JSON-RPC request to the plugin's endpoint,
 * which owns the real work.
 *
 *   node mcp-forward.mjs --url http://127.0.0.1:1234/mcp --token <secret>
 */

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const url = flag('--url');
const token = flag('--token');
if (url === undefined) {
  process.stderr.write('[dsh-mcp] missing --url\n');
  process.exit(2);
}

const log = (line) => process.stderr.write(`[dsh-mcp] ${line}\n`);

/** Relay one JSON-RPC message to the endpoint, and write the reply back. */
async function relay(message) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      const body = await response.text();
      log(`endpoint ${response.status}: ${body.slice(0, 200)}`);
      if (message.id !== undefined) {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: `endpoint ${response.status}` },
        })}\n`);
      }
      return;
    }
    if (response.body === null) return;

    // The endpoint answers as a stream: progress notifications, then the result.
    // Each line is forwarded as it arrives, so a long tool stops looking hung.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answered = false;

    const forward = (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      process.stdout.write(`${trimmed}\n`);
      try {
        if (JSON.parse(trimmed).id !== undefined) answered = true;
      } catch {
        // A partial line is passed on and the client's parser decides.
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        forward(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    forward(buffer);
    if (!answered && message.id !== undefined) {
      log('endpoint closed without answering');
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: 'the harness endpoint closed without answering' },
      })}\n`);
    }
  } catch (error) {
    log(`relay failed: ${String(error?.message ?? error)}`);
    if (message.id !== undefined) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: String(error?.message ?? error) },
      })}\n`);
    }
  }
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log(`unparseable: ${line.slice(0, 80)}`);
        newline = buffer.indexOf('\n');
        continue;
      }
      if (message.id === undefined) {
        // Notifications are forwarded fire-and-forget.
        relay(message).catch(() => {});
      } else {
        // Requests are serialised: MCP clients expect ordered replies.
        handleSequential(message);
      }
    }
    newline = buffer.indexOf('\n');
  }
});

let chain = Promise.resolve();
/** Queue one request behind the previous. @param message - the request. */
function handleSequential(message) {
  chain = chain.then(() => relay(message));
}

log(`ready → ${url}`);
