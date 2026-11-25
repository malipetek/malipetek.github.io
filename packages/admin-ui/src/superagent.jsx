/**
 * Superagent — the conversation surface over the same system the forms edit.
 *
 * Laid out like the app's chat: the thread fills the panel, the briefing reads
 * as the assistant's opening turn, and the composer sits at the foot. The
 * conversation itself is a Harness session: starting one hands the brief to the
 * main view, where every tool call and approval card already lives.
 */
import { useMemo, useRef, useState } from 'react';
import { ago, needsYou } from './format.js';
import { superagentBrief, superagentTitle } from './superagent-brief.js';
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
  const recent = useMemo(() => {
    try { return superagent?.recent?.() ?? []; } catch { return []; }
  }, [superagent, started]);
  const recentTotal = useMemo(() => {
    try { return superagent?.recentTotal?.() ?? recent.length; } catch { return recent.length; }
  }, [superagent, started, recent.length]);

  const scopes = useMemo(() => [
    { value: 'all', label: 'All system' },
    ...(data.projects ?? []).map((p) => ({ value: `p:${p.id}`, label: p.name })),
    ...(data.clients ?? []).map((c) => ({ value: `c:${c.id}`, label: c.name || c.email })),
  ], [data.projects, data.clients]);

  const scopeLabel = scopes.find((s) => s.value === scope)?.label ?? 'All system';
  const brief = (text) => superagentBrief({ scope, label: scopeLabel, text });
  /** Put a question in the composer and leave the send to the operator. */
  const ask = (question) => {
    setDraft(question);
    composer.current?.focus();
  };

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
    <div className="ui-workspace aw-superagent aw-superagent--chat">
      <UiStyles />
      <div className="aw-superagent__head">
        <PageHeader
          title="Superagent"
          subtitle="Ask the system, then watch it work. Every write waits for your yes."
          actions={last && recent.length === 0 ? <Button size="sm" onClick={() => superagent.open(last)}>Continue last</Button> : null}
        />
        <FilterBar label="Superagent scope">
          <label className="aw-field__label" htmlFor="aw-superagent-scope">Scope</label>
          <select id="aw-superagent-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <MetaChip>{available ? 'Connected' : 'Not in this host'}</MetaChip>
        </FilterBar>
      </div>

      <div className="aw-superagent__thread" aria-live="polite">
        <article className="aw-superagent__turn aw-superagent__turn--agent">
          <span className="aw-superagent__who">Superagent</span>
          {briefing === null ? (
            <p className="aw-muted">Reading the system…</p>
          ) : briefing.length === 0 ? (
            <p>Nothing needs you. No stalled work, no requests waiting, every node online.</p>
          ) : (
            <>
              <p>Right now:</p>
              <ul className="aw-superagent__lines">
                {briefing.map((line) => (
                  <li key={line.text}>
                    <Dot state={line.tone} />
                    <button type="button" className="aw-superagent__line" onClick={() => open(line.go)}>{line.text}</button>
                  </li>
                ))}
              </ul>
              <Button size="sm" onClick={() => ask(`Right now: ${briefing.map((line) => line.text).join(', ')}. What is stuck, and why?`)}>
                Ask about this
              </Button>
            </>
          )}
        </article>

        {recent.length > 0 ? (
          <article className="aw-superagent__turn aw-superagent__turn--agent">
            <span className="aw-superagent__who">Earlier conversations</span>
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
          </article>
        ) : null}

        {!available ? (
          <Empty
            title="The superagent runs in the desktop app"
            hint="It starts a conversation with the admin tools registered by the Host, so every step is a tool call you can watch and confirm. This page keeps the forms."
          />
        ) : null}

        <div className="aw-superagent__prompts">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="aw-superagent__prompt"
              disabled={!available || busy}
              onClick={() => ask(example)}
            >
              {example}
            </button>
          ))}
        </div>

        <details className="aw-superagent__abilities-more">
          <summary>What it can do</summary>
          <div className="aw-superagent__abilities">
            {ABILITIES.map((ability) => (
              <article key={ability.title} className="aw-superagent__ability">
                <Icon name={ability.icon} size={16} />
                <div>
                  <strong>{ability.title}</strong>
                  <p className="aw-muted">{ability.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </details>

        {error ? <p className="aw-callout" role="alert">{error}</p> : null}
        {started ? (
          <p className="aw-callout" role="status">
            Started in a conversation{host?.superagent?.open ? ' — opened in the main view' : '. Find it in the session list'}.
          </p>
        ) : null}
      </div>

      <form className="aw-superagent__composer" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <textarea
          ref={composer}
          rows={2}
          value={draft}
          disabled={!available || busy}
          aria-label="Ask the superagent"
          placeholder={available ? 'Ask for an outcome…' : 'The superagent runs in the desktop app'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void start(); } }}
        />
        <Button type="submit" kind="primary" disabled={!available || busy || !draft.trim()} disabledReason={available ? undefined : 'The superagent runs in the desktop app, where the admin tools are registered.'}>
          {busy ? 'Starting…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
