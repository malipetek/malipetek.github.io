/**
 * Superagent — the conversation surface over the same system the forms edit.
 *
 * The agent is the Harness's own: the Host registers the admin tools
 * (`admin_tickets`, `admin_work`, `admin_fleet`, `admin_project_*`), so the
 * panel starts a session with an admin brief and opens it in the main view.
 * The conversation, the tool calls and their confirmations are the app's, not a
 * second chat rendered here.
 */
import { useMemo, useState } from 'react';
import { useAdmin } from './store.js';
import { Button, Empty, FilterBar, Icon, MetaChip, PageHeader, UiStyles } from './ui/index.js';

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

export function SuperagentView() {
  const { data, host } = useAdmin();
  const [scope, setScope] = useState('all');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [started, setStarted] = useState(null);
  const superagent = host?.superagent ?? null;
  const available = Boolean(superagent?.start);
  const last = superagent?.last?.() ?? null;

  const scopes = useMemo(() => [
    { value: 'all', label: 'All system' },
    ...(data.projects ?? []).map((p) => ({ value: `p:${p.id}`, label: p.name })),
    ...(data.clients ?? []).map((c) => ({ value: `c:${c.id}`, label: c.name || c.email })),
  ], [data.projects, data.clients]);

  const scopeLabel = scopes.find((s) => s.value === scope)?.label ?? 'All system';
  const brief = (text) => {
    const focus = scope === 'all'
      ? 'Scope: the whole system.'
      : `Scope: ${scope.startsWith('p:') ? 'the project' : 'the client'} “${scopeLabel}” (${scope}). Work only there unless the answer needs the rest of the system.`;
    return [
      'You are the PTech Admin superagent. You manage ptechsolutions.net — tickets, the work queue, nodes, clients, projects and their sites — through the admin tools.',
      focus,
      'Read freely. Every write (a status change, a reply, a publish, a project or client change) shows an approval card before it runs: say in one line what you are about to change, then call the tool and let the card be the yes. After it runs, say what you did and what you could not verify.',
      '',
      text,
    ].join('\n');
  };

  const start = async (text = draft) => {
    const content = String(text).trim();
    if (!content || !available || busy) return;
    setBusy(true); setError(null);
    try {
      const id = await superagent.start({
        brief: brief(content),
        title: `Superagent · ${scope === 'all' ? 'whole system' : scopeLabel}`,
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
        actions={last ? <Button onClick={() => superagent.open(last)}>Continue last conversation</Button> : null}
      />
      <FilterBar label="Superagent scope">
        <label className="aw-field__label" htmlFor="aw-superagent-scope">Scope</label>
        <select id="aw-superagent-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <MetaChip>{available ? 'Connected' : 'Not in this host'}</MetaChip>
      </FilterBar>

      <form className="aw-superagent__composer" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <textarea
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
