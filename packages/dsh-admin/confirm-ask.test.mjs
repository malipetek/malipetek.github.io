import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfirmAsk } from './src/confirm-ask.mjs';

test('without a ConfirmHost the confirm fails closed and never touches a browser dialog', async () => {
  const original = globalThis.confirm;
  let confirmCalls = 0;
  globalThis.confirm = () => { confirmCalls += 1; return true; };
  const warnings = [];
  try {
    const confirmAsk = createConfirmAsk({ host: { open: null }, warn: (message) => warnings.push(message) });
    const answer = await confirmAsk({ title: 'Publish the site?', text: 'It goes live.' });
    assert.equal(answer, false, 'the ask must resolve false, never an unanswered yes');
    assert.equal(confirmCalls, 0, 'window.confirm must never be called');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Publish the site\?/, 'the warning names what was not confirmed');
  } finally {
    if (original === undefined) delete globalThis.confirm;
    else globalThis.confirm = original;
  }
});

test('a missing host object fails closed the same way', async () => {
  const confirmAsk = createConfirmAsk({ warn: () => {} });
  assert.equal(await confirmAsk({ title: 'Revoke the invite?' }), false);
});

test('a mounted ConfirmHost receives the ask and its answer resolves the caller', async () => {
  const host = { open: null };
  const confirmAsk = createConfirmAsk({ host, warn: () => {} });
  // What ConfirmHost's effect does while it is mounted.
  const opened = [];
  host.open = (next) => opened.push(next);

  const pending = confirmAsk({ title: 'Revoke the invite?', text: 'The link stops working.', confirm: 'Revoke', danger: true });
  assert.equal(opened.length, 1, 'the host is asked once');
  assert.deepEqual(
    { title: opened[0].title, text: opened[0].text, confirm: opened[0].confirm, danger: opened[0].danger },
    { title: 'Revoke the invite?', text: 'The link stops working.', confirm: 'Revoke', danger: true },
  );
  assert.equal(typeof opened[0].resolve, 'function');

  opened[0].resolve(true);
  assert.equal(await pending, true);

  const declined = confirmAsk({ title: 'Forget the node?' });
  opened[1].resolve(false);
  assert.equal(await declined, false);
});

test('the host is read at ask time, so unmounting closes the door again', async () => {
  const host = { open: (next) => { next.resolve(true); } };
  const confirmAsk = createConfirmAsk({ host, warn: () => {} });
  assert.equal(await confirmAsk({ title: 'While mounted' }), true);
  // ConfirmHost's cleanup: the slot is empty again.
  host.open = null;
  assert.equal(await confirmAsk({ title: 'After unmount' }), false);
});
