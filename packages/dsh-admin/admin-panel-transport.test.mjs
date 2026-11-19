import test from 'node:test';
import assert from 'node:assert/strict';
import { panelTransport } from './src/panel-transport.mjs';

const read = 'api GET /admin/tickets/27';
const write = 'api POST /admin/tickets/27/time {"seconds":1}';

test('desktop polls fail without invoking the legacy session transport', async () => {
  let legacy = 0;
  const command = panelTransport(async () => { legacy++; }, { desktop: true, fetcher: async () => new Response(null, {status: 404}) });
  assert.equal((await command(read)).ok, false);
  assert.equal(legacy, 0);
});

test('time POST is never retried after a lost reply, even in a non-desktop client', async () => {
  let tries = 0;
  const command = panelTransport(() => assert.fail('no replay'), { fetcher: async (url, init) => {
    assert.equal(url, '/api/admin/command');
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).line, write);
    tries++;
    throw new Error('lost reply');
  }});
  assert.equal((await command.quiet(write)).ok, false);
  assert.equal(tries, 1);
});

test('quiet path preserves application replies and legacy keeps its ordinary non-desktop call', async () => {
  const legacy = async line => ({ok: true, text: line});
  const command = panelTransport(legacy, { fetcher: async () => Response.json({kind: 'error',text: 'Ticket is closed.'}) });
  assert.deepEqual(await command(read), await legacy(read));
  assert.deepEqual(await command.quiet(read), {ok: false, text: 'Ticket is closed.'});
});
