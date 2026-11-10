/*
 * The instructions a client hands their own AI assistant to connect it to
 * their account. Said once: the "Copy agent instructions" button on /agents
 * copies this, and /agents.md serves it, so the links to other assistants can
 * point at it. Written for an agent to follow, in English, with every tool
 * name and URL exactly as the MCP server has them (worker/src/mcp.ts).
 */
export const AGENT_INSTRUCTIONS_URL = 'https://malipetek.dev/agents.md';

export const AGENT_INSTRUCTIONS = `Connect to my malipetek.dev account.

malipetek.dev is a service where AI agents build and change websites and a developer, Ali Petek, signs off on the work. My account holds my projects and my requests.

1. Add this MCP server to your client (streamable HTTP): https://malipetek.dev/mcp
   Discovery: https://malipetek.dev/.well-known/mcp-server.json
2. Sign in when your client asks (OAuth). If your client cannot sign in, ask me for a key. I make one in the portal under Connections (https://malipetek.dev/portal#/connections). It starts with cat_. Send it as the header "Authorization: Bearer cat_...".
3. Check the connection with portal_projects.

What you can do for me:
- Read my projects and requests: portal_projects, portal_requests, portal_request.
- File a request for Ali: portal_file_request. Nothing starts until he approves it.
- Reply on a request, change its budget, or take it back: portal_reply, portal_set_budget, portal_withdraw.
- Make a change yourself, on a preview: start_change, project_context, workspace_files, workspace_read, submit_change, preview_build. Then send it to Ali for review with finish_change (billed as his time), or publish it with site_publish. Ask me before you publish.

If your client cannot add an MCP server, tell me so, and point me to https://malipetek.dev/agents.
`;
