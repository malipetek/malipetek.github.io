import assert from 'node:assert/strict';
import test from 'node:test';

import { writeApproval } from './admin-approval.mjs';

test('reads pass without a card', () => {
  for (const [name, args] of [
    ['admin_tickets', { action: 'list' }],
    ['admin_tickets', { action: 'get', ticketId: 214 }],
    ['admin_directory', { action: 'clients' }],
    ['admin_project_local', { action: 'info', projectId: 'p2' }],
    ['admin_project_operations', { operation: 'project.read', projectId: 'p2' }],
    ['admin_fleet', { action: 'queue' }],
    ['admin_work', { action: 'claim', ticketId: 214 }],
    ['some_other_tool', { action: 'set_status' }],
  ]) assert.equal(writeApproval(name, args), null, `${name} ${JSON.stringify(args)}`);
});

test('every operator-facing write asks, and names the object', () => {
  const cases = [
    ['admin_tickets', { action: 'set_status', ticketId: 214, status: 'approved' }, /ticket #214 to approved/],
    ['admin_tickets', { action: 'reply', ticketId: 212 }, /Reply to ticket #212/],
    ['admin_tickets', { action: 'note', ticketId: 212 }, /private note on ticket #212/],
    ['admin_directory', { action: 'create_project', name: 'Bakery' }, /Create the project “Bakery”/],
    ['admin_directory', { action: 'set_folder', slug: 'p2', folder: '/tmp/x' }, /p2 at \/tmp\/x/],
    ['admin_directory', { action: 'link', clientId: 'c1', projectId: 'p2' }, /Give client c1 access to project p2/],
    ['admin_directory', { action: 'unlink', clientId: 'c1', projectId: 'p2' }, /Remove client c1 from project p2/],
    ['admin_directory', { action: 'set_deploy_target', project: 'petekkoleji', kind: 'pages', target: 'petekkoleji' }, /deploy to Cloudflare Pages project petekkoleji, production from main/],
    ['admin_directory', { action: 'invite', email: 'it@petekkoleji.com', projects: ['petekkoleji'] }, /Invite it@petekkoleji\.com to petekkoleji\? They are emailed/],
    ['admin_project_local', { action: 'configure', projectId: 'p2', path: '/tmp/y' }, /p2 at \/tmp\/y/],
    ['admin_project_local', { action: 'clone', projectId: 'p2' }, /Clone project p2/],
    ['admin_project_operations', { operation: 'project.update', projectId: 'p2' }, /Change project p2/],
    ['admin_project_operations', { operation: 'mentions.send', projectId: 'p2' }, /Notify the saved recipients on project p2/],
    ['admin_project_operations', { operation: 'work.draft', projectId: 'p2', title: 'Tidy' }, /draft task “Tidy” on p2/],
    ['admin_project_operations', { operation: 'work.queue', projectId: 'p2', title: 'Tidy' }, /approved task “Tidy” on p2/],
    ['admin_fleet', { action: 'file_task', title: 'Fix', slug: 'bakery' }, /“Fix” on bakery/],
    ['admin_fleet', { action: 'route', ticketId: 214 }, /routing of ticket #214/],
    ['admin_fleet', { action: 'cancel', runId: 902 }, /Cancel run #902/],
    ['admin_fleet', { action: 'drain', nodeId: 'n1' }, /Stop node n1/],
    ['admin_fleet', { action: 'undrain', nodeId: 'n1' }, /Let node n1/],
    ['admin_fleet', { action: 'node_control' }, /this machine's work node/],
  ];
  for (const [name, args, pattern] of cases) {
    const ask = writeApproval(name, args);
    assert.equal(ask?.kind, 'ask', `${name} ${args.action ?? args.operation}`);
    assert.match(ask.reason, pattern);
    assert.deepEqual(ask.displayReason, { en: ask.reason });
  }
});

test('an unreadable call still asks rather than running', () => {
  assert.match(writeApproval('admin_tickets', undefined).reason, /Run admin_tickets/);
  assert.match(writeApproval('admin_project_operations', null).reason, /Run admin_project_operations/);
});
