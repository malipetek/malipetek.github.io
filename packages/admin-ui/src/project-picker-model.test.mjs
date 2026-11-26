import test from 'node:test';
import assert from 'node:assert/strict';
import { flatItems, groupProjects } from './project-picker-model.mjs';

const projects = [
  { id: 'p1', name: 'Personal website', slug: 'personal-website', clients: [{ id: 'c1', email: 'akif@example.com' }] },
  { id: 'p2', name: 'Liftor Co.', slug: 'liftor-co', clients: [{ id: 'c2', email: 'ali@example.com' }] },
  { id: 'p3', name: 'Demo Bakery Site', slug: 'demo-bakery', clients: [{ id: 'c2', email: 'ali@example.com' }, { id: 'c3', email: 'zed@example.com' }] },
  { id: 'p4', name: 'PTech Solutions site', slug: 'ptechsolutions', clients: [] },
];

test('the ticket\'s own client comes first, other clients by name, projects with no client last', () => {
  const groups = groupProjects(projects, { clientEmail: 'AKIF@example.com' });
  assert.deepEqual(groups.map((g) => [g.label, g.own, g.items.map((i) => i.id)]), [
    ['akif@example.com', true, ['p1']],
    ['ali@example.com', false, ['p3', 'p2']],
    ['No client', false, ['p4']],
  ]);
});

test('a project shared by clients is listed once, with a hint for the others', () => {
  const items = flatItems(groupProjects(projects));
  assert.equal(items.filter((i) => i.id === 'p3').length, 1);
  assert.equal(items.find((i) => i.id === 'p3').hint, '+1 client');
});

test('search matches the project name, slug or client, every word', () => {
  assert.deepEqual(flatItems(groupProjects(projects, { query: 'bakery' })).map((i) => i.id), ['p3']);
  assert.deepEqual(flatItems(groupProjects(projects, { query: 'zed' })).map((i) => i.id), ['p3']);
  assert.deepEqual(flatItems(groupProjects(projects, { query: 'ali site' })).map((i) => i.id), ['p3']);
  assert.deepEqual(groupProjects(projects, { query: 'nothing like it' }), []);
});
