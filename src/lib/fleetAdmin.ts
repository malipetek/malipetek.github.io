/*
 * The fleet half of /portal/admin: nodes, the work queue, runs, system tasks
 * and settings — the same management surface as the Harness Admin panel
 * (packages/dsh-admin), drawn with the portal's own element builder.
 *
 * Everything that creates or edits more than one value opens a <dialog>;
 * choices from a known set are chips and segmented buttons, never free text.
 */
import { api, errorText, h } from './portal';

/* ————— shapes the Worker returns ————— */

export interface NodeHealth {
  at?: number;
  system?: {
    uptimeSec: number;
    load: number[];
    cpus: number;
    memFreePct?: number;
    memTotalGb: number;
    disk: { freeGb: number; totalGb: number } | null;
    battery: { percent: number; onPower: boolean } | null;
    tailscaleIp: string | null;
  };
  process?: { pid: number; version: string; uptimeSec: number; supervisor: string; lastError: string | null };
  executors?: Record<string, { ok: boolean; version: string | null }>;
  services?: { name: string; up: boolean; detail: string }[];
}

export interface FleetNode {
  id: string;
  hostname: string;
  os: string;
  capabilities: string[];
  executors: string[];
  slugs: string[];
  slots: number;
  version: string;
  draining: boolean;
  online: boolean;
  lastSeenAt: number;
  health: NodeHealth;
  overrides: { slots?: number; capabilities?: string[]; executors?: string[]; alertOfflineMinutes?: number };
  running: { id: number; ticket_id: number; executor: string; started_at: number; title: string }[];
}

export interface QueueItem {
  id: number;
  title: string;
  kind: string;
  priority: number;
  requires: string[];
  executor: string | null;
  slug: string | null;
  waitingSeconds: number;
  eligible: string[];
  reason: string;
}

export interface Run {
  id: number;
  ticket_id: number;
  executor: string;
  model: string | null;
  status?: string;
  node_id: string | null;
  attempt: number;
  cancel_requested?: number;
  cost_micro_usd?: number;
  started_at: number;
  finished_at?: number | null;
  title: string;
  slug: string | null;
}

export interface Settings {
  stallMinutes: number;
  maxAttempts: number;
  notifyRunFinished: boolean;
  defaultPriority: number;
  sitesDomain: string;
  clientPublish: boolean;
}

export interface Catalog {
  capabilities: { id: string; label: string; hint: string }[];
  executors: { id: string; label: string; hint: string }[];
}

export interface FleetState {
  nodes: FleetNode[];
  queue: QueueItem[];
  running: Run[];
  recent: Run[];
  settings: Settings;
  catalog: Catalog;
  projects: { id: string; slug: string; name: string }[];
}

export async function loadFleet(projects: FleetState['projects']): Promise<FleetState> {
  const [nodes, queue, runs, settings] = await Promise.all([
    api<{ nodes: FleetNode[] }>('/admin/nodes'),
    api<{ queue: QueueItem[] }>('/admin/queue'),
    api<{ running: Run[]; recent: Run[] }>('/admin/runs'),
    api<{ settings: Settings; catalog: Catalog }>('/admin/settings'),
  ]);
  return {
    nodes: nodes.nodes,
    queue: queue.queue,
    running: runs.running,
    recent: runs.recent,
    settings: settings.settings,
    catalog: settings.catalog,
    projects,
  };
}

/* ————— small helpers ————— */

export const PRIORITIES = [
  { value: -10, label: 'Low' },
  { value: 0, label: 'Normal' },
  { value: 10, label: 'High' },
  { value: 50, label: 'Urgent' },
];
export const priorityName = (v: number) => PRIORITIES.find((p) => p.value === v)?.label ?? `p${v}`;

export function span(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const ago = (unix: number) => span(Date.now() / 1000 - unix);
const money = (micro = 0) => `$${(micro / 1_000_000).toFixed(micro && micro < 10_000 ? 4 : 2)}`;

/** A ticket's `requires`, which arrives as a JSON string or an array. */
export function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

function button(label: string, onClick: () => void, cls = 'btn') {
  const b = h('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

const dot = (state: 'ok' | 'warn' | 'bad') => h('span', { class: `dot dot--${state}`, 'aria-hidden': 'true' });

/** Where a task would go — the Worker's claim rule, run on the loaded state. */
export function predict(
  nodes: FleetNode[],
  { slug, requires, executor, kind }: { slug: string | null; requires: string[]; executor: string | null; kind: string },
): { state: 'ok' | 'warn' | 'bad'; text: string } {
  if (!slug) return { state: 'bad', text: 'Pick a project.' };
  if (!nodes.length) return { state: 'bad', text: 'No node has ever connected. It will wait until one does.' };
  const holders = nodes.filter((n) => n.slugs.includes(slug));
  if (!holders.length) return { state: 'bad', text: `No node has a folder for ${slug}. Map it in the Harness Admin panel.` };
  const capable = holders.filter((n) => requires.every((r) => n.capabilities.includes(r)));
  if (!capable.length) return { state: 'bad', text: `No node with ${slug} has ${requires.join(' + ')}.` };
  const needs = kind === 'client' ? 'claude' : executor;
  const runnable = needs ? capable.filter((n) => n.executors.includes(needs)) : capable;
  if (!runnable.length) return { state: 'bad', text: `No capable node runs ${needs}.` };
  const live = runnable.filter((n) => n.online && !n.draining);
  if (!live.length) return { state: 'warn', text: `Will wait for ${runnable.map((n) => n.id).join(' or ')} — offline or draining right now.` };
  const free = live.filter((n) => n.running.length < n.slots);
  if (!free.length) return { state: 'ok', text: `Queued behind current work on ${live.map((n) => n.id).join(' or ')}.` };
  return { state: 'ok', text: `Starts on ${free.map((n) => n.id).join(' or ')} within 30 seconds.` };
}

/* ————— controls ————— */

interface Control<T> {
  el: HTMLElement;
  get(): T;
  onChange(fn: () => void): void;
}

/** Toggle chips. `multi` false makes them a one-of-n choice. */
export function chips(options: { value: string; label: string; hint?: string; note?: string; disabled?: boolean }[], selected: string[], multi = true): Control<string[]> {
  let value = [...selected];
  const listeners: (() => void)[] = [];
  const el = h('div', { class: 'chips', role: 'group' });
  const draw = () =>
    el.replaceChildren(
      ...options.map((o) => {
        const on = value.includes(o.value);
        const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), title: o.hint, disabled: o.disabled }, o.label, o.note ? h('small', null, o.note) : null);
        b.addEventListener('click', () => {
          value = multi ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value];
          draw();
          listeners.forEach((fn) => fn());
        });
        return b;
      }),
    );
  draw();
  return { el, get: () => value, onChange: (fn) => listeners.push(fn) };
}

/** One-of-n segmented buttons. */
export function segmented<T extends string | number>(options: { value: T; label: string; disabled?: boolean }[], initial: T, disabled = false): Control<T> {
  let value = initial;
  const listeners: (() => void)[] = [];
  const el = h('div', { class: 'seg', role: 'group' });
  const draw = () =>
    el.replaceChildren(
      ...options.map((o) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(o.value === value), disabled: disabled || o.disabled }, o.label);
        b.addEventListener('click', () => {
          value = o.value;
          draw();
          listeners.forEach((fn) => fn());
        });
        return b;
      }),
    );
  draw();
  return { el, get: () => value, onChange: (fn) => listeners.push(fn) };
}

function priorityPicker(initial: number) {
  const options = PRIORITIES.map((p) => ({ value: p.value, label: p.label }));
  if (!options.some((o) => o.value === initial)) options.push({ value: initial, label: `Custom (${initial})` });
  return segmented(options, initial);
}

/** − n + */
export function stepper(initial: number, min: number, max: number, suffix = ''): Control<number> {
  let value = initial;
  const listeners: (() => void)[] = [];
  const out = h('strong', null, String(value));
  const less = h('button', { type: 'button', class: 'btn btn--sm', 'aria-label': 'less' }, '−');
  const more = h('button', { type: 'button', class: 'btn btn--sm', 'aria-label': 'more' }, '+');
  const set = (n: number) => {
    value = Math.min(max, Math.max(min, n));
    out.textContent = String(value);
    less.disabled = value <= min;
    more.disabled = value >= max;
    listeners.forEach((fn) => fn());
  };
  less.addEventListener('click', () => set(value - 1));
  more.addEventListener('click', () => set(value + 1));
  set(value);
  return { el: h('div', { class: 'stepper' }, less, out, more, suffix ? h('span', { class: 'portal-note' }, suffix) : null), get: () => value, onChange: (fn) => listeners.push(fn) };
}

/** A switch with a label. */
export function toggle(label: string, hint: string, initial: boolean): Control<boolean> {
  let value = initial;
  const listeners: (() => void)[] = [];
  const sw = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(value), 'aria-label': label });
  const flip = () => {
    value = !value;
    sw.setAttribute('aria-checked', String(value));
    listeners.forEach((fn) => fn());
  };
  sw.addEventListener('click', flip);
  const text = h('span', { class: 'switch-label' }, h('span', null, label), hint ? h('small', null, hint) : null);
  text.addEventListener('click', flip);
  return { el: h('div', { class: 'switch-row' }, sw, text), get: () => value, onChange: (fn) => listeners.push(fn) };
}

export function field(label: string, control: Node, hint?: string) {
  return h('div', { class: 'dlg-field' }, h('span', { class: 'portal-label' }, label), control, hint ? h('span', { class: 'portal-note' }, hint) : null);
}

function capabilityChips(catalog: Catalog, nodes: FleetNode[], selected: string[], lockOs = false) {
  const known = new Map(catalog.capabilities.map((c) => [c.id, c]));
  for (const n of nodes) for (const c of n.capabilities) if (!known.has(c)) known.set(c, { id: c, label: c, hint: `reported by ${n.id}` });
  return chips(
    [...known.values()]
      .filter((c) => !(lockOs && c.id.startsWith('os:')))
      .map((c) => {
        const have = nodes.filter((n) => n.capabilities.includes(c.id));
        return { value: c.id, label: c.label, hint: c.hint, note: nodes.length ? `${have.filter((n) => n.online).length}/${have.length}` : undefined };
      }),
    selected,
  );
}

function executorPicker(catalog: Catalog, initial: string, isClient: boolean) {
  return segmented([{ value: '', label: 'Any' }, ...catalog.executors.map((e) => ({ value: e.id, label: e.label }))], isClient ? 'claude' : initial, isClient);
}

function prediction() {
  const el = h('p', { class: 'prediction', role: 'status' });
  return {
    el,
    show(result: { state: 'ok' | 'warn' | 'bad'; text: string }) {
      el.className = `prediction prediction--${result.state}`;
      el.replaceChildren(dot(result.state), result.text);
    },
  };
}

/* ————— dialogs ————— */

/**
 * A modal dialog. `actions` gets a `close` and returns the footer buttons;
 * Escape and a click on the backdrop close it.
 */
export function openDialog({
  title,
  subtitle,
  body,
  actions,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  body: Node[];
  actions: (close: () => void, error: (text: string) => void) => Node[];
  wide?: boolean;
}) {
  const dialog = h('dialog', { class: `dlg${wide ? ' dlg--wide' : ''}`, 'aria-label': title });
  const close = () => dialog.close();
  const errorEl = h('p', { class: 'portal-note is-error', role: 'alert', hidden: true });
  const error = (text: string) => {
    errorEl.hidden = false;
    errorEl.textContent = text;
  };
  dialog.append(
    h('header', { class: 'dlg-head' }, h('div', null, h('h2', null, title), subtitle ? h('p', { class: 'portal-note' }, subtitle) : null), button('✕', close, 'dlg-x')),
    h('div', { class: 'dlg-body' }, ...body),
    h('footer', { class: 'dlg-foot' }, errorEl, h('span', { class: 'dlg-spacer' }), ...actions(close, error)),
  );
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { close, error };
}

/** "Are you sure?" before anything that stops work or tells a client. */
export function confirmDialog(title: string, body: string, confirm: string, run: () => Promise<unknown>, danger = false) {
  openDialog({
    title,
    body: [h('p', null, body)],
    actions: (close, error) => [
      button('Keep', close),
      button(
        confirm,
        async () => {
          try {
            await run();
            close();
          } catch (e) {
            error(errorText(e));
          }
        },
        danger ? 'btn btn--danger' : 'btn btn--solid',
      ),
    ],
  });
}

/** File a system task. */
export function taskDialog(state: FleetState, done: () => void) {
  const title = h('input', { required: true, maxlength: 140, placeholder: 'e.g. Upgrade Astro to v6' });
  const brief = h('textarea', { rows: 6, maxlength: 8000, placeholder: 'Describe the change, the files involved, and how to check it.' });
  const project = chips(
    state.projects.map((p) => ({ value: p.slug, label: p.name })),
    state.projects[0] ? [state.projects[0].slug] : [],
    false,
  );
  const priority = priorityPicker(state.settings.defaultPriority);
  const needs = capabilityChips(state.catalog, state.nodes, []);
  const agent = executorPicker(state.catalog, '', false);
  const approve = toggle('Queue it now', 'Off files it as waiting, so you can approve it later.', true);
  const where = prediction();
  const update = () =>
    where.show(
      approve.get()
        ? predict(state.nodes, { slug: project.get()[0] ?? null, requires: needs.get(), executor: agent.get() || null, kind: 'system' })
        : { state: 'warn', text: 'Filed as waiting; nothing runs until you approve it.' },
    );
  [project, needs, agent, approve].forEach((c) => c.onChange(update));
  update();

  openDialog({
    title: 'New system task',
    subtitle: 'Your own work on one of your projects. It runs on the first node that can take it.',
    wide: true,
    body: [
      field('Title', title),
      field('Project', project.el),
      field('What to do', brief, 'This brief is trusted: it goes to the agent as your instructions.'),
      field('Priority', priority.el),
      field('Needs', needs.el, 'Only nodes with every selected capability take it. The count is nodes online / nodes that have it.'),
      field('Agent', agent.el),
      approve.el,
      where.el,
    ],
    actions: (close, error) => [
      button('Cancel', close),
      button(
        'File task',
        async () => {
          if (!title.value.trim() || !brief.value.trim() || !project.get()[0]) return error('Give it a title, a project and a brief.');
          try {
            await api('/admin/work', {
              body: {
                title: title.value.trim(),
                brief: brief.value.trim(),
                slug: project.get()[0],
                priority: priority.get(),
                requires: needs.get(),
                executor: agent.get() || null,
                approve: approve.get(),
              },
            });
            close();
            done();
          } catch (e) {
            error(errorText(e));
          }
        },
        'btn btn--solid',
      ),
    ],
  });
  title.focus();
}

/** Priority, needs and agent for one item. */
export function routingDialog(
  state: FleetState,
  ticket: { id: number; title: string; kind?: string; priority?: number; requires?: unknown; executor?: string | null; slug?: string | null; status?: string },
  done: () => void,
) {
  const isClient = (ticket.kind ?? 'client') !== 'system';
  const priority = priorityPicker(ticket.priority ?? 0);
  const needs = capabilityChips(state.catalog, state.nodes, listOf(ticket.requires));
  const agent = executorPicker(state.catalog, ticket.executor ?? '', isClient);
  const where = prediction();
  const update = () => where.show(predict(state.nodes, { slug: ticket.slug ?? null, requires: needs.get(), executor: agent.get() || null, kind: ticket.kind ?? 'client' }));
  [needs, agent].forEach((c) => c.onChange(update));
  update();
  openDialog({
    title: `Routing · #${ticket.id}`,
    subtitle: ticket.title,
    body: [
      field('Priority', priority.el, 'Higher goes first; equal priorities go oldest first.'),
      field('Needs', needs.el),
      field('Agent', agent.el, isClient ? 'Client work always runs on Claude Code, the sandboxed agent.' : undefined),
      ...(ticket.status === 'approved' ? [where.el] : []),
    ],
    actions: (close, error) => [
      button('Cancel', close),
      button(
        'Save',
        async () => {
          try {
            const body: Record<string, unknown> = { priority: priority.get(), requires: needs.get() };
            if (!isClient) body.executor = agent.get() || null;
            await api(`/admin/tickets/${ticket.id}`, { method: 'PATCH', body });
            close();
            done();
          } catch (e) {
            error(errorText(e));
          }
        },
        'btn btn--solid',
      ),
    ],
  });
}

/** One node: health, services, and its settings. */
export function nodeDialog(state: FleetState, node: FleetNode, done: () => void) {
  const hl = node.health ?? {};
  const s = hl.system;
  const p = hl.process;
  const row = (label: string, value: string, bad = false) => h('div', { class: `kv${bad ? ' kv--bad' : ''}` }, h('span', null, label), h('span', null, value));
  const health = s
    ? h(
        'div',
        { class: 'kvs' },
        row('Reported', `${span((Date.now() - (hl.at ?? 0)) / 1000)} ago`),
        row('Machine up', span(s.uptimeSec)),
        row('Load', `${s.load.join(' · ')} on ${s.cpus} cores`, s.load[0] > s.cpus * 1.5),
        row('Memory free', `${s.memFreePct ?? '?'}% of ${s.memTotalGb} GB`, (s.memFreePct ?? 100) < 10),
        s.disk ? row('Disk free', `${s.disk.freeGb} of ${s.disk.totalGb} GB`, s.disk.freeGb < 10) : null,
        s.battery ? row('Battery', `${s.battery.percent}% · ${s.battery.onPower ? 'on power' : 'on battery'}`, !s.battery.onPower && s.battery.percent < 20) : null,
        row('Tailscale IP', s.tailscaleIp ?? 'none', !s.tailscaleIp),
        p ? row('Node process', `v${p.version} · up ${span(p.uptimeSec)} · ${p.supervisor === 'manual' ? 'not a service' : p.supervisor}`, p.supervisor === 'manual') : null,
        p?.lastError ? row('Last error', p.lastError, true) : null,
      )
    : h('p', { class: 'portal-note' }, 'No health report yet — this node runs an older version, or never reported.');
  const services = (hl.services ?? []).length
    ? h('div', { class: 'chips' }, ...(hl.services ?? []).map((svc) => h('span', { class: 'svc' }, dot(svc.up ? 'ok' : 'bad'), svc.name, h('small', null, svc.detail))))
    : h('p', { class: 'portal-note' }, 'None watched.');

  const o = node.overrides ?? {};
  const slots = stepper(o.slots ?? node.slots, 1, 8);
  const caps = capabilityChips(state.catalog, [], o.capabilities ?? node.capabilities.filter((c) => !c.startsWith('os:')), true);
  const installed = Object.entries(hl.executors ?? {});
  const agents = chips(
    (installed.length ? installed : node.executors.map((e) => [e, { ok: true, version: null }] as const)).map(([name, info]) => ({
      value: name,
      label: info.ok ? name : `${name} (missing)`,
      hint: info.version ?? undefined,
      disabled: !info.ok,
    })),
    o.executors ?? node.executors,
  );
  const alert = segmented(
    [
      { value: 0, label: 'Never' },
      { value: 15, label: '15 min' },
      { value: 60, label: '1 hour' },
      { value: 360, label: '6 hours' },
    ],
    o.alertOfflineMinutes ?? 0,
  );

  openDialog({
    title: node.id,
    subtitle: `${node.os} · ${node.hostname} · ${node.online ? (node.draining ? 'online, draining' : 'online') : `offline for ${ago(node.lastSeenAt)}`}`,
    wide: true,
    body: [
      h('section', { class: 'dlg-section' }, h('h3', { class: 'portal-label' }, 'Health'), health),
      h('section', { class: 'dlg-section' }, h('h3', { class: 'portal-label' }, 'Services'), services),
      h(
        'section',
        { class: 'dlg-section' },
        h('h3', { class: 'portal-label' }, 'Running'),
        node.running.length ? h('ul', { class: 'plain' }, ...node.running.map((r) => h('li', null, `#${r.ticket_id} ${r.title} · ${r.executor} · ${ago(r.started_at)}`))) : h('p', { class: 'portal-note' }, 'Idle.'),
      ),
      h(
        'section',
        { class: 'dlg-section' },
        h('h3', { class: 'portal-label' }, 'Settings'),
        field('Parallel runs', slots.el),
        field('Capabilities', caps.el, `${node.capabilities.filter((c) => c.startsWith('os:')).join(', ') || 'The OS'} is automatic.`),
        field('Agents it offers', agents.el, 'Only agents installed on the node can be offered.'),
        field('Email me when it is offline for', alert.el, 'Never for a laptop that sleeps; on for an always-on machine.'),
      ),
    ],
    actions: (close, error) => [
      ...(node.online
        ? []
        : [
            button(
              'Forget',
              () =>
                confirmDialog(`Forget ${node.id}?`, 'It disappears from the fleet. If it is still alive it comes back on its next heartbeat.', 'Forget', async () => {
                  await api(`/admin/nodes/${node.id}`, { method: 'DELETE' });
                  close();
                  done();
                }, true),
              'btn btn--danger',
            ),
          ]),
      button(node.draining ? 'Resume taking work' : 'Drain', async () => {
        try {
          await api(`/admin/nodes/${node.id}`, { method: 'PATCH', body: { draining: !node.draining } });
          close();
          done();
        } catch (e) {
          error(errorText(e));
        }
      }),
      button('Cancel', close),
      button(
        'Save settings',
        async () => {
          try {
            await api(`/admin/nodes/${node.id}`, {
              method: 'PATCH',
              body: { overrides: { slots: slots.get(), capabilities: caps.get(), executors: agents.get(), alertOfflineMinutes: alert.get() } },
            });
            close();
            done();
          } catch (e) {
            error(errorText(e));
          }
        },
        'btn btn--solid',
      ),
    ],
  });
}

/* ————— views ————— */

/** Always visible: every node, the queue, and what needs a look. */
export function healthStrip(state: FleetState, go: (view: string) => void, refresh: () => void) {
  const stuck = state.queue.filter((q) => !q.eligible.length).length;
  const pill = (content: (Node | string)[], onClick: () => void, bad = false) => {
    const b = h('button', { type: 'button', class: `hpill${bad ? ' hpill--bad' : ''}` }, ...content);
    b.addEventListener('click', onClick);
    return b;
  };
  return [
    ...state.nodes.map((n) => {
      const degraded = (n.health?.services ?? []).some((s) => !s.up) || Boolean(n.health?.process?.lastError);
      return pill(
        [dot(!n.online ? 'bad' : degraded || n.draining ? 'warn' : 'ok'), n.id, h('small', null, n.online ? (n.running.length ? `${n.running.length} running` : 'idle') : `offline ${ago(n.lastSeenAt)}`)],
        () => nodeDialog(state, n, refresh),
        !n.online,
      );
    }),
    ...(state.nodes.length ? [] : [pill([dot('bad'), 'no nodes'], () => go('fleet'), true)]),
    pill([`${state.queue.length} queued${stuck ? ` · ${stuck} stuck` : ''}`], () => go('fleet'), stuck > 0),
    pill([`${state.running.length} running`], () => go('fleet')),
  ];
}

/** The fleet view: nodes, the queue, running and recent runs. */
export function fleetView(state: FleetState, refresh: () => void) {
  const section = (title: string, action: Node | null, ...children: Node[]) =>
    h('section', { class: 'fleet-section' }, h('div', { class: 'fleet-head' }, h('h2', null, title), action), ...children);

  const nodeCard = (n: FleetNode) => {
    const s = n.health?.system;
    const down = (n.health?.services ?? []).filter((x) => !x.up);
    const card = h(
      'button',
      { type: 'button', class: `node-card${n.online ? '' : ' node-card--off'}` },
      h('span', { class: 'node-top' }, dot(!n.online ? 'bad' : down.length || n.draining ? 'warn' : 'ok'), h('strong', null, n.id), h('small', null, n.os), h('span', { class: 'node-state' }, n.online ? (n.draining ? 'draining' : `${n.running.length}/${n.slots} busy`) : `offline ${ago(n.lastSeenAt)}`)),
      n.online && s
        ? h(
            'span',
            { class: 'node-stats' },
            `load ${s.load[0]} · mem ${s.memFreePct ?? '?'}%${s.disk ? ` · disk ${s.disk.freeGb}G` : ''}${s.battery ? ` · batt ${s.battery.percent}%${s.battery.onPower ? ' ⚡' : ''}` : ''}`,
          )
        : null,
      h('span', { class: 'tags' }, ...n.executors.map((e) => h('span', { class: 'tag' }, e)), ...n.capabilities.map((c) => h('span', { class: 'tag tag--dash' }, c))),
      down.length ? h('span', { class: 'node-bad' }, `${down.map((d) => d.name).join(', ')} down`) : null,
      h('small', null, `${n.slugs.length} project folder${n.slugs.length === 1 ? '' : 's'} · Details →`),
    );
    card.addEventListener('click', () => nodeDialog(state, n, refresh));
    return card;
  };

  const runRow = (r: Run, live: boolean) => {
    const li = h(
      'li',
      { class: 'run-row' },
      h('span', { class: `run-state run-state--${live ? 'live' : r.status}` }, live ? (r.cancel_requested ? 'stopping' : 'running') : r.status ?? ''),
      h('a', { href: `#ticket=${r.ticket_id}` }, `#${r.ticket_id} ${r.title}`),
      h('small', null, [r.slug ?? 'no project', r.executor, r.node_id ? `on ${r.node_id}` : 'in the Harness', r.attempt > 1 ? `attempt ${r.attempt}` : '', live ? '' : money(r.cost_micro_usd)].filter(Boolean).join(' · ')),
      h('small', { class: 'run-time' }, live || !r.finished_at ? `${ago(r.started_at)} so far` : `${Math.max(1, Math.round((r.finished_at - r.started_at) / 60))}m · ${ago(r.finished_at)} ago`),
    );
    if (live && !r.cancel_requested) {
      li.append(
        button(
          'Stop',
          () =>
            confirmDialog('Stop this run?', `#${r.ticket_id} ${r.title} — the agent is stopped and the item goes to review.`, 'Stop run', async () => {
              await api(`/admin/runs/${r.id}/cancel`, { method: 'POST' });
              refresh();
            }, true),
          'btn btn--sm btn--danger',
        ),
      );
    }
    return li;
  };

  const queueRow = (q: QueueItem) =>
    h(
      'li',
      { class: `queue-row${q.eligible.length ? '' : ' queue-row--stuck'}` },
      h(
        'div',
        null,
        h('a', { href: `#ticket=${q.id}` }, `#${q.id} ${q.title}`),
        h(
          'span',
          { class: 'tags' },
          q.kind === 'system' ? h('span', { class: 'tag tag--dash' }, 'system') : null,
          h('span', { class: 'tag' }, q.slug ?? 'no project'),
          q.priority ? h('span', { class: 'tag' }, priorityName(q.priority)) : null,
          ...q.requires.map((r) => h('span', { class: 'tag tag--dash' }, r)),
          q.executor ? h('span', { class: 'tag' }, q.executor) : null,
          h('small', null, `waiting ${span(q.waitingSeconds)}`),
        ),
        h('p', { class: 'queue-reason' }, q.reason),
      ),
      button('Route', () => routingDialog(state, { ...q, status: 'approved' }, refresh), 'btn btn--sm'),
    );

  return [
    section(
      `Nodes · ${state.nodes.filter((n) => n.online).length}/${state.nodes.length} online`,
      null,
      state.nodes.length ? h('div', { class: 'node-grid' }, ...state.nodes.map(nodeCard)) : h('p', { class: 'portal-note' }, 'No node has ever connected. Install one with fleet/install.sh.'),
    ),
    section(
      `Queue · ${state.queue.length}`,
      button('+ New task', () => taskDialog(state, refresh), 'btn btn--solid btn--sm'),
      state.queue.length ? h('ul', { class: 'plain fleet-list' }, ...state.queue.map(queueRow)) : h('p', { class: 'portal-note' }, 'Nothing approved is waiting.'),
    ),
    section(`Running · ${state.running.length}`, null, state.running.length ? h('ul', { class: 'plain fleet-list' }, ...state.running.map((r) => runRow(r, true))) : h('p', { class: 'portal-note' }, 'Nothing is running.')),
    section(
      `Recent · ${state.recent.length} · ${money(state.recent.reduce((a, r) => a + (r.cost_micro_usd ?? 0), 0))}`,
      null,
      state.recent.length ? h('ul', { class: 'plain fleet-list' }, ...state.recent.map((r) => runRow(r, r.status === 'running'))) : h('p', { class: 'portal-note' }, 'No runs recorded yet.'),
    ),
  ];
}

/** System-wide settings. */
export function settingsView(state: FleetState, refresh: () => void) {
  const minutes = (m: number) => (m === 0 ? 'Never' : m < 60 ? `${m} min` : `${m / 60} h`);
  const stall = segmented([0, 15, 30, 60, 120].map((m) => ({ value: m, label: minutes(m) })), state.settings.stallMinutes);
  const attempts = stepper(state.settings.maxAttempts, 1, 10, 'lost runs');
  const priority = priorityPicker(state.settings.defaultPriority);
  const notify = toggle('Email me when a run finishes', 'With the summary and the changed files.', state.settings.notifyRunFinished);
  const publish = toggle('Clients may publish their own preview', 'Off: only you publish a preview to production.', state.settings.clientPublish);
  // A domain is the one setting that is not from a known set.
  const domain = h('input', { type: 'text', value: state.settings.sitesDomain, spellcheck: 'false', autocomplete: 'off', style: 'max-width: 20rem' });
  const domainCtl = { el: domain, get: () => domain.value.trim().toLowerCase(), onChange: (fn: () => void) => domain.addEventListener('input', fn) };
  const status = h('p', { class: 'portal-note', role: 'status' }, 'Saved');
  const save = h('button', { type: 'button', class: 'btn btn--solid', disabled: true }, 'Save settings');
  const current = () => ({ stallMinutes: stall.get(), maxAttempts: attempts.get(), defaultPriority: priority.get(), notifyRunFinished: notify.get(), sitesDomain: domainCtl.get(), clientPublish: publish.get() });
  const dirty = () => JSON.stringify(current()) !== JSON.stringify({ stallMinutes: state.settings.stallMinutes, maxAttempts: state.settings.maxAttempts, defaultPriority: state.settings.defaultPriority, notifyRunFinished: state.settings.notifyRunFinished, sitesDomain: state.settings.sitesDomain, clientPublish: state.settings.clientPublish });
  const mark = () => {
    save.disabled = !dirty();
    status.textContent = dirty() ? 'Unsaved changes' : 'Saved';
    status.classList.remove('is-error');
  };
  [stall, attempts, priority, notify, publish, domainCtl].forEach((c) => c.onChange(mark));
  save.addEventListener('click', async () => {
    try {
      await api('/admin/settings', { method: 'PATCH', body: current() });
      refresh();
    } catch (e) {
      status.textContent = errorText(e);
      status.classList.add('is-error');
    }
  });

  return [
    h(
      'section',
      { class: 'settings-panel' },
      h('h2', null, 'Queue'),
      h('p', { class: 'portal-note' }, 'Applies to every node. Machine settings — folders, budgets, the model — live in the Harness Admin panel, because they are on the machine.'),
      field('Email me when approved work is stuck for', stall.el, 'Stuck means no node can take it: offline, missing folder, missing capability.'),
      field('Give up after', attempts.el, 'How many times a node may go silent on an item before it goes to review instead of round again.'),
      field('New tasks default to', priority.el),
      notify.el,
      h('h2', null, 'Hosted sites'),
      field('Sites live under', domain, 'New sites answer on <site>.<domain> and <site>-preview.<domain>. Existing sites keep the address they were given.'),
      publish.el,
      h('div', { class: 'settings-foot' }, status, save),
    ),
  ];
}
