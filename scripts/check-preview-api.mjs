import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { proxyOrigin } from '../src/lib/previewOrigin.js';
import { proxyToWorker } from '../src/lib/workerProxy.ts';

const hosts = ['visual-portal-transitions-and-canvas', 'visual-lab-3d-and-pages', 'visual-transitions-and-contracting'];
for (const name of hosts) {
  const origin = `https://${name}-malipetek-site.malipetek.workers.dev`;
  const request = new Request(`${origin}/api/auth/demo?check=1`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer test-only' },
    body: JSON.stringify({ email: 'test@example.com', code: 'not-a-real-code' }),
  });
  assert.equal(proxyOrigin(request, '/api/auth/demo', true), 'https://malipetek.dev');
  assert.equal(proxyOrigin(request, '/mcp', true), origin);
  assert.equal(proxyOrigin(request, '/api/auth/demo', false), origin);
  let calls = 0;
  const response = await proxyToWorker({ request, locals: { runtime: { env: { INTERCOM: {
    async fetch(forwarded) {
      calls++;
      assert.equal(forwarded.url, 'https://intercom/api/auth/demo?check=1');
      assert.equal(forwarded.headers.get('Origin'), 'https://malipetek.dev');
      assert.equal(forwarded.headers.get('Authorization'), 'Bearer test-only');
      assert.equal((await forwarded.json()).code, 'not-a-real-code');
      return Response.json({ ok: true });
    },
  } } } } }, '/api/auth/demo');
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  for (const foreign of ['https://evil.example', 'null', `${origin}.evil.example`]) {
    assert.equal(proxyOrigin(new Request(`${origin}/api/auth/demo`, { headers: { Origin: foreign } }), '/api/auth/demo', true), foreign);
  }
  assert.equal(proxyOrigin(new Request(`${origin}/api/auth/demo`), '/api/auth/demo', true), null);
}
for (const origin of [
  'https://malipetek.dev', 'http://localhost:4321',
  'https://other-worker.malipetek.workers.dev',
  'https://x.visual-malipetek-site.malipetek.workers.dev',
  'https://visual-malipetek-site.malipetek.workers.dev.evil.example',
  'http://visual-malipetek-site.malipetek.workers.dev',
  'https://visual-malipetek-site.malipetek.workers.dev:444',
]) {
  assert.equal(proxyOrigin(new Request(`${origin}/api/auth/demo`, { headers: { Origin: origin } }), '/api/auth/demo', true), origin);
}
const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
assert.match(config, /"\/api\/\*"/);
const env = await readFile(new URL('../.env.production', import.meta.url), 'utf8');
assert.match(env, /^PUBLIC_CHAT_ENDPOINT=\/api$/m);
console.log('Preview API checks passed: all three branches, forwarding, foreign/opaque origins, hostile hosts, local/prod, and same-origin build config.');
