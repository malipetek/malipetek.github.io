/**
 * A minimal MCP server over stdio, for one purpose: proving that an ACP agent
 * actually connects to a server handed to it in `session/new`.
 *
 * It exposes a single `echo` tool. No dependencies, no state, newline-delimited
 * JSON-RPC on stdin/stdout, diagnostics on stderr so they never corrupt the
 * protocol stream.
 */

const server = { name: 'dsh-echo', version: '1' };

/** Write one JSON-RPC message. @param message - the message. */
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

/** Report a diagnostic on stderr. @param line - the line. */
const log = (line) => process.stderr.write(`[dsh-echo] ${line}\n`);

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) handle(line);
    newline = buffer.indexOf('\n');
  }
});

/** Handle one request. @param line - raw JSON. */
function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    log(`unparseable line: ${line.slice(0, 80)}`);
    return;
  }
  const { id, method, params } = request;
  log(`← ${method}${id === undefined ? '' : ` #${id}`}`);

  // Notifications carry no id and take no reply.
  if (id === undefined) return;

  if (method === 'initialize') {
    send({
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: server,
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({
      id,
      result: {
        tools: [{
          name: 'echo',
          description: 'Return the text it was given, prefixed with "echo: ".',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: 'Text to echo back.' } },
            required: ['text'],
          },
        }],
      },
    });
    return;
  }
  if (method === 'tools/call') {
    const text = String(params?.arguments?.text ?? '');
    log(`★ tools/call echo(${JSON.stringify(text)})`);
    send({ id, result: { content: [{ type: 'text', text: `echo: ${text}` }] } });
    return;
  }
  if (method === 'ping') {
    send({ id, result: {} });
    return;
  }
  send({ id, error: { code: -32601, message: `unknown method ${method}` } });
}

log('ready');
