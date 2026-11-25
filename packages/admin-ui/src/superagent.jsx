/**
 * Superagent — the conversation surface over the same system the forms edit.
 *
 * The agent is the Harness's own: the Host registers the admin tools
 * (`admin_tickets`, `admin_work`, `admin_fleet`, `admin_project_*`), so the
 * panel starts a session with an admin brief and opens it in the main view.
 * The conversation, the tool calls and their confirmations are the app's, not a
 * second chat rendered here.
 */
import { useMemo, useRef, useState } from 'react';
import { ago, needsYou } from './format.js';
import { shorten, superagentBrief, superagentTitle } from './superagent-brief.js';
import { useAdmin } from './store.js';
import { Button, Dot, Empty, FilterBar, Icon, MetaChip, PageHeader, UiStyles } from './ui/index.js';

/** What the agent can do, in the words the tool descriptions use. */
const ABILITIES = [
  { icon: 'inbox', title: 'Read the work', detail: 'Tickets with their threads, the queue, nodes, running runs and cost.' },
  { icon: 'ticket', title: 'Move a ticket', detail: 'Approve, decline, set status, reply to the client, write a private note.' },
  { icon: 'board', title: 'Do the work', detail: 'Claim an approved ticket, work it in a worktree, report the run.' },
  { icon: 'projects', title: 'Change a project', detail: 'Create it, set its folder on this machine, clone it, publish its site.' },
  { icon: 'clients', title: 'Handle clients', detail: 'Invite them, attach projects, turn email copies on or off.' },
];

const EXAMPLES = [
  'What is stuck, and why?',
  'Create a project for a new bakery client',
  'Which previews are waiting to be published?',
  'Move this week’s reviews to done',
];

/** `3 tickets stalled`, `1 ticket stalled` — the count reads as a sentence. */
const counted = (list, one, more) => `${list.length} ${list.length === 1 ? one : more}`;

/**
 * What the system is saying, before anyone asks. The same rule as Needs you,
 * so the panel and the inbox never disagree, and each line jumps to the view
 * that can act on it.
 */
function briefingOf(data) {
  const n = needsYou(data);
  const running = data.running ?? [];
  return [
    n.stalled.length ? { tone: 'bad', text: counted(n.stalled, 'ticket stalled', 'tickets stalled'), go: 'inbox' } : null,
    n.waiting.length ? { tone: 'warn', text: counted(n.waiting, 'client waiting on a reply', 'clients waiting on a reply'), go: 'inbox' } : null,
    n.new.length ? { tone: 'warn', text: counted(n.new, 'request to approve or decline', 'requests to approve or decline'), go: 'inbox' } : null,
    n.stuck.length ? { tone: 'bad', text: counted(n.stuck, 'approved ticket no node can take', 'approved tickets no node can take'), go: 'work' } : null,
    n.review.length ? { tone: 'info', text: counted(n.review, 'ticket in review', 'tickets in review'), go: 'inbox' } : null,
    n.offline.length ? { tone: 'bad', text: counted(n.offline, 'node offline', 'nodes offline'), go: 'fleet' } : null,
    running.length ? { tone: 'ok', text: counted(running, 'run going', 'runs going'), go: 'fleet' } : null,
  ].filter(Boolean);
}

export function SuperagentView() {
  const { data, host, open } = useAdmin();
  const [scope, setScope] = useState('all');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [started, setStarted] = useState(null);
  const composer = useRef(null);
  const superagent = host?.superagent ?? null;
  const available = Boolean(superagent?.start);
  const last = superagent?.last?.() ?? null;
  const briefing = useMemo(() => (data.loaded ? briefingOf(data) : null), [data]);
  /** The conversations this panel started, newest first; empty on a host that cannot list them. */
  const recent = useMemo(() => {
    try { return superagent?.recent?.() ?? []; } catch { return []; }
  }, [superagent, started]);
  const recentTotal = useMemo(() => {
    try { return superagent?.recentTotal?.() ?? recent.length; } catch { return recent.length; }
  }, [superagent, started, recent.length]);
  /** Put the question in the composer and leave the click on Start to the operator. */
  const ask = (question) => {
    setDraft(question);
    composer.current?.focus();
  };

  const scopes = useMemo(() => [
    { value: 'all', label: 'All system' },
    ...(data.projects ?? []).map((p) => ({ value: `p:${p.id}`, label: p.name })),
    ...(data.clients ?? []).map((c) => ({ value: `c:${c.id}`, label: c.name || c.email })),
  ], [data.projects, data.clients]);

  const scopeLabel = scopes.find((s) => s.value === scope)?.label ?? 'All system';
  const brief = (text) => superagentBrief({ scope, label: scopeLabel, text });

  const start = async (text = draft) => {
    const content = String(text).trim();
    if (!content || !available || busy) return;
    setBusy(true); setError(null);
    try {
      const id = await superagent.start({
        brief: brief(content),
        title: superagentTitle({ scope, label: scopeLabel, ask: content }),
      });
      setStarted(id);
      setDraft('');
    } catch (e) {
      setError(e?.message ?? 'The superagent could not start.');
    } finally { setBusy(false); }
  };

  return (
    <div className="ui-workspace aw-superagent">
      <UiStyles />
      <PageHeader
        title="Superagent"
        subtitle="Ask the system, then watch it work. Every form action has a tool here, and every write waits for your yes."
        actions={last && recent.length === 0 ? <Button onClick={() => superagent.open(last)}>Continue last conversation</Button> : null}
      />
      <FilterBar label="Superagent scope">
        <label className="aw-field__label" htmlFor="aw-superagent-scope">Scope</label>
        <select id="aw-superagent-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <MetaChip>{available ? 'Connected' : 'Not in this host'}</MetaChip>
      </FilterBar>

      <section className="aw-brief" aria-label="Right now">
        <div className="aw-brief__head">
          <h2 className="aw-brief__title">Right now</h2>
          {briefing?.length ? (
            <Button
              size="sm"
              onClick={() => ask(`Right now: ${briefing.map((line) => line.text).join(', ')}. What is stuck, and why?`)}
            >
              Ask about this
            </Button>
          ) : null}
        </div>
        {briefing === null ? (
          <p className="aw-muted">Reading the system…</p>
        ) : briefing.length === 0 ? (
          <p className="aw-muted">Nothing needs you. No stalled work, no requests waiting, every node online.</p>
        ) : (
          <ul className="aw-brief__list">
            {briefing.map((line) => (
              <li key={line.text}>
                <Dot state={line.tone} />
                <button type="button" className="aw-brief__link" onClick={() => open(line.go)}>{line.text}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="aw-superagent__composer" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <textarea
          ref={composer}
          rows={3}
          value={draft}
          disabled={!available || busy}
          aria-label="Ask the superagent"
          placeholder={available ? 'Ask for an outcome…' : 'The superagent runs in the desktop app'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void start(); } }}
        />
        <Button type="submit" kind="primary" disabled={!available || busy || !draft.trim()} disabledReason={available ? undefined : 'The superagent runs in the desktop app, where the admin tools are registered.'}>
          {busy ? 'Starting…' : 'Start conversation'}
        </Button>
      </form>
      {available ? (
        <p className="aw-superagent__composer-hint"><kbd>⌘↵</kbd> starts it and opens the conversation in the main view.</p>
      ) : null}

      {!available ? (
        <Empty
          title="The superagent runs in the desktop app"
          hint="It starts a conversation with the admin tools registered by the Host, so every step is a tool call you can watch and confirm. This page keeps the forms."
        />
      ) : null}
      {error ? <p className="aw-callout" role="alert">{error}</p> : null}
      {started ? (
        <p className="aw-callout" role="status">
          Started in a conversation{host?.superagent?.open ? ' — opened in the main view' : '. Find it in the session list'}.
        </p>
      ) : null}

      {recent.length > 0 ? (
        <section className="aw-superagent__recent" aria-label="Superagent conversations">
          <h2 className="aw-brief__title">Conversations</h2>
          <ul className="aw-superagent__recent-list">
            {recent.map((row) => (
              <li key={row.id}>
                <button type="button" className="aw-superagent__recent-row" onClick={() => superagent.open(row.id)}>
                  <span className="aw-superagent__recent-title">{row.title}</span>
                  <span className="aw-muted">{row.running ? 'working now' : `${ago(Math.floor(row.updatedAt / 1000))} ago`}</span>
                </button>
              </li>
            ))}
          </ul>
          {recentTotal > recent.length ? (
            <p className="aw-muted">Newest {recent.length} of {recentTotal}. The Superagent workspace lists the rest.</p>
          ) : null}
        </section>
      ) : null}

      <div className="aw-superagent__prompts">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="aw-superagent__prompt"
            disabled={!available || busy}
            onClick={() => setDraft(example)}
          >
            {example}
          </button>
        ))}
      </div>

      <section className="aw-superagent__abilities" aria-label="What the superagent can do">
        {ABILITIES.map((ability) => (
          <article key={ability.title} className="aw-superagent__ability">
            <Icon name={ability.icon} size={16} />
            <div>
              <strong>{ability.title}</strong>
              <p className="aw-muted">{ability.detail}</p>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
