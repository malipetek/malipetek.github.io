import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sidebarTicketLabel, sidebarRunShortcut } from './src/sidebar-presentation.mjs';

test('ticket label starts with the title and does not repeat the ticket number', () => {
  assert.equal(sidebarTicketLabel({ id: 17, title: 'Fix checkout' }), 'Fix checkout');
  assert.equal(sidebarTicketLabel({ id: 17, title_en: 'Update billing #17' }), 'Update billing #17');
  assert.equal(sidebarTicketLabel({ id: 17 }), 'Ticket #17');
});

test('run shortcut keeps the ticket kind and number in its accessible name only', () => {
  assert.equal(sidebarRunShortcut({ kind: 'task', ticketId: 17 }), 'Open system task #17');
  assert.equal(sidebarRunShortcut({ kind: 'ticket', ticketId: 19 }), 'Open client ticket #19');
});
