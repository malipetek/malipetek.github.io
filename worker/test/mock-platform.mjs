/*
 * A stand-in for the GPTflare control plane's bootstrap API — only what
 * src/sites.ts calls. Operations finish on their second poll, so the state
 * machine is exercised step by step. `control` lets a test sign a user in or
 * make provisioning refuse, and `state` records what the Worker sent.
 *
 * The real API's reply fields are not known from this repo; these follow the
 * names sites.ts reads first. If the real platform differs, the first real
 * setup shows it in `project_sites.last_payload`.
 */
import http from 'node:http';

export const KEY = 'e2e-platform-key';

export function startMockPlatform() {
  const state = { auth: {}, polls: {}, edits: [], approvals: 0, calls: [], drafts: [], failProvision: false };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const send = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const path = url.pathname.replace('/api/gpt/bootstrap', '');
    state.calls.push(`${req.method} ${path}`);
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'bad platform key' });

    if (path === '/start-auth') {
      const id = `ar_${Object.keys(state.auth).length + 1}`;
      state.auth[id] = { status: 'pending', email: body.email };
      return send(200, { authRequestId: id, status: 'pending' });
    }
    const auth = body.authRequestId ?? url.searchParams.get('authRequestId');
    if (!state.auth[auth]) return send(410, { error: 'AUTH_REQUEST_EXPIRED' });
    const verified = state.auth[auth].status === 'verified';
    if (path === '/auth-status') return send(200, { status: state.auth[auth].status, email: state.auth[auth].email, canCreateSite: verified });
    if (!verified) return send(403, { error: 'the user must complete sign-in' });

    switch (path) {
      case '/create-site': {
        state.drafts.push(body);
        const n = state.drafts.length;
        return send(202, { siteId: `site_${n}`, operationId: `op_create_${n}` });
      }
      case '/operation-status': {
        const id = url.searchParams.get('operationId');
        state.polls[id] = (state.polls[id] ?? 0) + 1;
        return send(200, { operationId: id, status: state.polls[id] >= 2 ? 'succeeded' : 'running' });
      }
      case '/provision-site':
        if (state.failProvision) return send(422, { error: 'TEMPLATE_UNAVAILABLE: the business template is being updated' });
        return send(202, { operationId: `op_provision_${body.siteId}` });
      case '/site-state': {
        const siteId = url.searchParams.get('siteId');
        const draft = state.drafts[Number(siteId.split('_')[1]) - 1];
        const slug = String(draft?.siteName ?? 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return send(200, { siteId, slug, repository: { htmlUrl: `https://github.com/GPTflare-Sites/${slug}` } });
      }
      case '/edit-preview':
        state.edits.push(body);
        return send(200, { ok: true, commit: `c${state.edits.length}` });
      case '/approve-preview':
        state.approvals += 1;
        return send(200, { ok: true });
      default:
        return send(404, { error: `mock has no ${path}` });
    }
  });

  const control = {
    /** The client opened the platform's sign-in link. */
    verify(email) {
      for (const entry of Object.values(state.auth)) if (entry.email === email) entry.status = 'verified';
    },
    failProvision(on) {
      state.failProvision = on;
    },
  };

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, state, control, close: () => server.close() });
    });
  });
}
