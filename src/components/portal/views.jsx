/* The client portal's pages, other than a single request (TicketView.jsx). */
import { useEffect, useMemo, useState } from 'react';
import { api, errorText, fmtTime } from '../../lib/portal';
import { HOURLY_USD, clock, money, priceOf } from '../../lib/pricing.js';
import { Board, STAGES } from './Board.jsx';
import { go, href, isOpen, usePortal } from './store.js';
import { Button, Icon, MiniTrack, Modal, StatusPill, ago, cx, fmtDate, totalOf } from './ui.jsx';

const unpublished = (site) => site?.state === 'ready' && site.previewDeploy && site.previewDeploy !== site.productionDeploy;
const overBudget = (t) => isOpen(t) && t.budget_cents !== null && totalOf(t) > t.budget_cents;
const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/* ————— shared rows ————— */

export function RequestRow({ t, hovered, onHover, showProject = true }) {
  return (
    <li>
      <a
        className={cx('cp-row', !showProject && 'cp-row--bare', t.unread && 'is-unread', hovered && 'is-hover')}
        href={href(`ticket/${t.id}`)}
        onMouseEnter={() => onHover?.(t.id)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(t.id)}
        onBlur={() => onHover?.(null)}
      >
        <span className="cp-row__id">#{t.id}</span>
        <span className="cp-row__title">
          <span>{t.title}</span>
          {t.unread ? <span className="cp-new">new reply</span> : null}
          {overBudget(t) ? <span className="cp-new cp-new--warn">paused at budget</span> : null}
        </span>
        {showProject ? <span className="cp-row__project">{t.project_name ?? '—'}</span> : null}
        <MiniTrack status={t.status} />
        <StatusPill status={t.status} />
        <span className="cp-row__cost">{totalOf(t) ? money(totalOf(t)) : ''}</span>
        <span className="cp-row__when">{ago(t.updated_at)}</span>
      </a>
    </li>
  );
}

function PageHead({ title, sub, children }) {
  return (
    <header className="cp-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="cp-head__actions">{children}</div> : null}
    </header>
  );
}

/* ————— overview ————— */

export function Overview() {
  const { data, compose } = usePortal();
  const [stage, setStage] = useState(null);
  const [hovered, setHovered] = useState(null);
  const { tickets, projects, user } = data;
  const open = tickets.filter(isOpen);
  const shown = stage ? tickets.filter((t) => t.status === stage) : open;
  const stageLabel = STAGES.find((s) => s.key === stage)?.label;
  const name = user.name || user.email.split('@')[0];

  const summary = [
    open.length ? `${open.length} open request${open.length === 1 ? '' : 's'}` : 'No open requests',
    open.filter((t) => t.status === 'in_progress').length ? `${open.filter((t) => t.status === 'in_progress').length} being built right now` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="cp-view">
      <PageHead title={`${greeting()}, ${name}`} sub={summary}>
        <Button kind="primary" onClick={() => compose()}>
          <Icon name="plus" size={15} /> New request
        </Button>
      </PageHead>

      <Board tickets={tickets} stage={stage} onStage={setStage} hovered={hovered} onHover={setHovered} onOpen={(id) => go(`ticket/${id}`)} />

      <div className="cp-overview">
        <section className="cp-card cp-card--flush">
          <header className="cp-card__head">
            <h2 className="cp-h2">{stage ? stageLabel : 'Open requests'}</h2>
            {stage ? (
              <button type="button" className="cp-linkbtn" onClick={() => setStage(null)}>
                Show all open
              </button>
            ) : (
              <a className="cp-linkbtn" href={href('requests?filter=all')}>
                All requests →
              </a>
            )}
          </header>
          {shown.length ? (
            <ul className="cp-rows cp-rows--compact">
              {shown.map((t) => (
                <RequestRow key={t.id} t={t} hovered={hovered === t.id} onHover={setHovered} />
              ))}
            </ul>
          ) : (
            <div className="cp-empty">
              {tickets.length ? <p>Nothing here right now.</p> : <p>Nothing yet. Write your first request: what you need, in your own words.</p>}
              {!stage ? (
                <Button kind="primary" onClick={() => compose()}>
                  New request
                </Button>
              ) : null}
            </div>
          )}
        </section>

        <div className="cp-overview__side">
          <NeedsYou />
          <SpendCard />
        </div>
      </div>

      <section className="cp-section">
        <header className="cp-section__head">
          <h2 className="cp-h2">Projects</h2>
          <a className="cp-linkbtn" href="/portal/start">
            Add a project →
          </a>
        </header>
        {projects.length ? (
          <div className="cp-projects">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} tickets={tickets.filter((t) => t.project_id === p.id)} />
            ))}
          </div>
        ) : (
          <div className="cp-card cp-empty">
            <p>No project yet. Three questions and there is one.</p>
            <Button kind="primary" href="/portal/start">
              Set up your first project →
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/** What is waiting on the client: replies, a paused meter, a preview to publish, setup to finish. */
function NeedsYou() {
  const { data } = usePortal();
  const items = [];
  if (!data.projects.length) items.push({ key: 'setup', href: '/portal/start', title: 'Set up your first project', text: 'Three questions, and Ali knows what you need.' });
  for (const t of data.tickets) {
    if (t.unread) items.push({ key: `r${t.id}`, href: href(`ticket/${t.id}`), title: `New reply on #${t.id}`, text: t.title });
    if (overBudget(t)) items.push({ key: `b${t.id}`, href: href(`ticket/${t.id}`), title: `#${t.id} is paused at its budget`, text: 'Raise the budget to let work go on.' });
  }
  for (const p of data.projects) {
    if (unpublished(p.site)) {
      items.push({
        key: `p${p.id}`,
        href: href(`project/${p.id}`),
        title: `${p.name}: preview has changes`,
        text: data.canPublish ? 'Look them over and publish when they are right.' : 'Look them over; tell Ali when they are right.',
      });
    }
    if (p.kind === 'new' && !p.site) items.push({ key: `s${p.id}`, href: href(`project/${p.id}`), title: `Set up ${p.name}'s site`, text: 'One click: you get a preview and a live address.' });
    for (const c of p.setup.checks) {
      // Optional steps (a custom domain) never nag.
      if (c.owner === 'you' && c.state === 'missing' && c.blocking) items.push({ key: `c${p.id}${c.key}`, href: href(`project/${p.id}`), title: `${p.name}: ${c.label}`, text: c.detail });
    }
  }
  return (
    <section className="cp-card">
      <h2 className="cp-h2">Needs you</h2>
      {items.length ? (
        <ul className="cp-todo">
          {items.slice(0, 6).map((i) => (
            <li key={i.key}>
              <a href={i.href}>
                <strong>{i.title}</strong>
                <span>{i.text}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cp-muted cp-allclear">Nothing. Ali has what he needs.</p>
      )}
    </section>
  );
}

function SpendCard() {
  const { data } = usePortal();
  const u = data.usage ?? { billedCents: 0, openCents: 0, aiCents: 0 };
  return (
    <section className="cp-card">
      <header className="cp-card__head cp-card__head--tight">
        <h2 className="cp-h2">Spend</h2>
        <a className="cp-linkbtn" href={href('billing')}>
          Details →
        </a>
      </header>
      <div className="cp-spend">
        <div>
          <span className="cp-label">Finished</span>
          <b>{money(u.billedCents)}</b>
        </div>
        <div>
          <span className="cp-label">On the meter</span>
          <b>{money(u.openCents)}</b>
        </div>
      </div>
      <p className="cp-hint">AI at cost, no markup: {money(u.aiCents)} of it so far.</p>
    </section>
  );
}

function siteLine(project) {
  const s = project.site;
  if (!s) return project.kind === 'new' ? 'No site yet' : project.repo ? 'Code connected' : 'Getting set up';
  if (s.state === 'failed') return 'Site setup stopped';
  if (s.state !== 'ready') return 'Site being made…';
  return unpublished(s) ? 'Preview ahead of live' : 'Live';
}

function ProjectCard({ project, tickets }) {
  const open = tickets.filter(isOpen).length;
  const s = project.site;
  const live = s?.state === 'ready';
  const { setup } = project;
  return (
    <a className="cp-project" href={href(`project/${project.id}`)}>
      <div className="cp-project__top">
        <span className={cx('cp-project__dot', live ? (unpublished(s) ? 'is-ahead' : 'is-live') : s?.state === 'failed' ? 'is-bad' : 'is-wait')} />
        <strong>{project.name}</strong>
        <span className="cp-tag">{project.kind === 'new' ? 'built by us' : 'your code'}</span>
      </div>
      <p className="cp-project__site">{live ? s.productionUrl.replace(/^https:\/\//, '') : siteLine(project)}</p>
      <div className="cp-project__foot">
        <span>{siteLine(project)}</span>
        <span>
          {open} open · {tickets.length} total
        </span>
      </div>
      <div className="cp-project__setup" title={`${setup.ready} of ${setup.total} setup steps done`}>
        <span style={{ width: `${setup.total ? (setup.ready / setup.total) * 100 : 100}%` }} />
      </div>
    </a>
  );
}

/* ————— all requests ————— */

const FILTERS = [
  { key: 'open', label: 'Open', test: isOpen },
  { key: 'you', label: 'Needs you', test: (t) => t.unread || overBudget(t) },
  { key: 'done', label: 'Done', test: (t) => t.status === 'done' || t.status === 'declined' },
  { key: 'all', label: 'All', test: () => true },
];

export function RequestsView({ query }) {
  const { data, compose } = usePortal();
  const [filter, setFilter] = useState(query.get('filter') ?? 'open');
  const [project, setProject] = useState(query.get('project') ?? '');
  const [text, setText] = useState('');
  useEffect(() => {
    if (query.get('filter')) setFilter(query.get('filter'));
  }, [query]);
  const test = FILTERS.find((f) => f.key === filter)?.test ?? isOpen;
  const q = text.trim().toLowerCase();
  const rows = data.tickets.filter((t) => test(t) && (!project || t.project_id === project) && (!q || `#${t.id} ${t.title}`.toLowerCase().includes(q)));

  return (
    <div className="cp-view">
      <PageHead title="Requests" sub="Everything you have asked for, newest change first.">
        <Button kind="primary" onClick={() => compose(project || undefined)}>
          <Icon name="plus" size={15} /> New request
        </Button>
      </PageHead>
      <div className="cp-toolbar">
        <div className="cp-seg" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              <span>{data.tickets.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        {data.projects.length > 1 ? (
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        <input type="search" placeholder="Search requests" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search requests" />
      </div>
      <section className="cp-card cp-card--flush">
        {rows.length ? (
          <ul className="cp-rows">
            <li className="cp-rows__head" aria-hidden="true">
              <span>#</span>
              <span>Request</span>
              <span>Project</span>
              <span>Steps</span>
              <span>Status</span>
              <span>Cost</span>
              <span>Updated</span>
            </li>
            {rows.map((t) => (
              <RequestRow key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <p className="cp-empty">No requests match.</p>
        )}
      </section>
    </div>
  );
}

/* ————— one project ————— */

export function ProjectView({ id }) {
  const { data, compose } = usePortal();
  const project = data.projects.find((p) => p.id === id);
  if (!project) return <p className="cp-empty">That project is not on your account.</p>;
  const tickets = data.tickets.filter((t) => t.project_id === project.id);
  const known = project.setup.checks.filter((c) => c.state !== 'unknown');
  return (
    <div className="cp-view">
      <nav className="cp-crumbs">
        <a href={href('')}>Overview</a>
        <span>{project.name}</span>
      </nav>
      <PageHead title={project.name} sub={project.kind === 'new' ? 'Built and hosted by us.' : 'Your existing code, looked after by us.'}>
        <Button kind="primary" onClick={() => compose(project.id)}>
          <Icon name="plus" size={15} /> New request
        </Button>
      </PageHead>

      <div className="cp-projectgrid">
        <SiteCard project={project} />
        <section className="cp-card">
          <header className="cp-card__head cp-card__head--tight">
            <h2 className="cp-h2">Setup</h2>
            <span className="cp-muted">
              {project.setup.ready}/{project.setup.total}
            </span>
          </header>
          <ul className="cp-checks">
            {known.map((c) => (
              <li key={c.key} className={`is-${c.state}`}>
                <span className="cp-checks__mark" aria-hidden="true">
                  {c.state === 'ready' ? '✓' : c.state === 'pending' ? '…' : '○'}
                </span>
                <span>
                  <strong>{c.label}</strong>
                  <em>{c.detail}</em>
                </span>
                <span className="cp-checks__who">{c.owner === 'you' ? 'you' : 'us'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="cp-section">
        <header className="cp-section__head">
          <h2 className="cp-h2">Requests</h2>
          <a className="cp-linkbtn" href={href(`requests?filter=all&project=${project.id}`)}>
            Open in the list →
          </a>
        </header>
        <div className="cp-card cp-card--flush">
          {tickets.length ? (
            <ul className="cp-rows cp-rows--compact">
              {tickets.map((t) => (
                <RequestRow key={t.id} t={t} showProject={false} />
              ))}
            </ul>
          ) : (
            <p className="cp-empty">No requests for this project yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

/** The hosted site: set it up, follow it, open it, publish it, roll it back. */
function SiteCard({ project }) {
  const { data, reload, ask, notify } = usePortal();
  const site = project.site;
  const [deploys, setDeploys] = useState(null);
  const [starting, setStarting] = useState(false);
  const ready = site?.state === 'ready';
  useEffect(() => {
    if (!ready) return;
    api(`/portal/projects/${project.id}/site/deploys`)
      .then(({ deploys }) => setDeploys(deploys))
      .catch(() => setDeploys([]));
  }, [project.id, ready, site?.previewDeploy, site?.productionDeploy]);

  if (!site && project.kind !== 'new') {
    return (
      <section className="cp-card cp-site">
        <h2 className="cp-h2">Code</h2>
        <p className="cp-muted">{project.repo ? `Working on ${project.repo.replace(/^https:\/\/github\.com\//, '')}.` : 'We are connecting your code. Nothing to do here.'}</p>
      </section>
    );
  }
  if (!site || site.state === 'failed') {
    return (
      <section className="cp-card cp-site">
        <h2 className="cp-h2">Your site</h2>
        {site ? <p className="cp-error">Setting up the site stopped. We have been told; you can also try again.</p> : null}
        <p className="cp-muted">A real site, hosted for you, with its own address at once: a placeholder first, the real thing as it is built. Every change lands on a preview address first; nothing goes live until it is published.</p>
        <Button
          kind="primary"
          disabled={starting}
          onClick={() => setStarting(true)}
        >
          {site ? 'Try again →' : 'Set up my site →'}
        </Button>
        {starting ? (
          <StartSite
            project={project}
            onClose={() => setStarting(false)}
            onDone={async () => {
              setStarting(false);
              notify('Your site is being made.');
              await reload();
            }}
          />
        ) : null}
      </section>
    );
  }
  if (!ready) {
    return (
      <section className="cp-card cp-site">
        <h2 className="cp-h2">Your site</h2>
        <p className="cp-making" role="status">
          <span className="cp-spinner" /> Your site is being made. This page follows along.
        </p>
      </section>
    );
  }

  const ahead = unpublished(site);
  const publish = () =>
    ask({
      title: `Publish ${project.name}?`,
      text: `What you see at ${site.previewUrl} becomes the live site at ${site.productionUrl}.`,
      confirm: 'Publish',
      run: async () => {
        await api(`/portal/projects/${project.id}/site/publish`, { method: 'POST', body: {} });
        notify('Published. The live site has the new version.');
        await reload();
      },
    });
  const rollback = (d) =>
    ask({
      title: 'Put this version back live?',
      text: `The live site goes back to the version from ${fmtDate(d.created_at)}${d.ticket_id ? ` (request #${d.ticket_id})` : ''}. The preview stays as it is.`,
      confirm: 'Roll back',
      run: async () => {
        await api(`/portal/projects/${project.id}/site/rollback`, { body: { deployId: d.id } });
        notify('Rolled back.');
        await reload();
      },
    });

  return (
    <section className="cp-card cp-site">
      <header className="cp-card__head cp-card__head--tight">
        <h2 className="cp-h2">Your site</h2>
        <span className={cx('cp-sitestate', ahead ? 'is-ahead' : 'is-live')}>{ahead ? 'Preview ahead of live' : 'Live is up to date'}</span>
      </header>
      <div className="cp-channels">
        <a className="cp-channel" href={site.previewUrl} target="_blank" rel="noopener">
          <span className="cp-label">Preview</span>
          <strong>{site.previewUrl.replace(/^https:\/\//, '')}</strong>
          <span className="cp-muted">Where changes land first</span>
          <Icon name="ext" size={14} />
        </a>
        <a className="cp-channel" href={site.productionUrl} target="_blank" rel="noopener">
          <span className="cp-label">Live</span>
          <strong>{(site.customDomain || site.productionUrl).replace(/^https:\/\//, '')}</strong>
          <span className="cp-muted">What your visitors see</span>
          <Icon name="globe" size={14} />
        </a>
      </div>
      {ahead ? (
        data.canPublish ? (
          <Button kind="primary" onClick={publish}>
            Publish the preview →
          </Button>
        ) : (
          <p className="cp-hint">The preview has changes that are not live yet. Ali publishes them when you say they look right.</p>
        )
      ) : null}
      {deploys?.length ? (
        <>
          <h3 className="cp-label cp-site__hist">Versions</h3>
          <ol className="cp-versions">
            {deploys.slice(0, 8).map((d) => {
              const isLive = d.id === site.productionDeploy;
              const isPreview = d.id === site.previewDeploy;
              return (
                <li key={d.id}>
                  <span className={cx('cp-versions__dot', isLive && 'is-live', isPreview && !isLive && 'is-preview')} />
                  <span>
                    {d.ticket_id ? <a href={href(`ticket/${d.ticket_id}`)}>Request #{d.ticket_id}</a> : 'Site version'}
                    <em>{fmtTime(d.created_at)}</em>
                  </span>
                  {isLive ? <span className="cp-tag cp-tag--live">live</span> : null}
                  {isPreview ? <span className="cp-tag">preview</span> : null}
                  {!isLive && data.canPublish ? (
                    <button type="button" className="cp-linkbtn" onClick={() => rollback(d)}>
                      Put live
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </section>
  );
}

function StartSite({ project, onClose, onDone }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Set up ${project.name}`}
      subtitle="A real site, hosted for you, with a preview and a live address."
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>Not now</Button>
          <Button
            kind="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/portal/projects/${project.id}/site`, { method: 'POST', body: {} });
                await onDone();
              } catch (e) {
                setError(errorText(e));
                setBusy(false);
              }
            }}
          >
            Set it up →
          </Button>
        </>
      }
    >
      <ol className="cp-numbered">
        <li>Your site gets its own address at once: a placeholder page first, the real thing as it is built.</li>
        <li>Every change lands on the preview address first. Nothing goes live until it is published.</li>
      </ol>
      <p className="cp-hint">Hosting and AI runs are billed at cost on the requests that use them.</p>
    </Modal>
  );
}

/* ————— connections ————— */

export function ConnectionsView() {
  const { data } = usePortal();
  if (data.user.role !== 'client') {
    return (
      <div className="cp-view">
        <PageHead title="Connections" />
        <p className="cp-empty">Connections belong to client accounts. Sign in as a client to see them.</p>
      </div>
    );
  }
  return (
    <div className="cp-view">
      <PageHead title="Connections" sub="Optional. Everything works without them." />
      <div className="cp-connect">
        <Assistants />
        <Github />
      </div>
    </div>
  );
}

function Assistants() {
  const { ask } = usePortal();
  const [tokens, setTokens] = useState(null);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState(null);
  const load = () => api('/portal/agent-tokens').then(({ tokens }) => setTokens(tokens), () => setTokens([]));
  useEffect(() => void load(), []);
  return (
    <section className="cp-card">
      <h2 className="cp-h2">Your AI assistant</h2>
      <p className="cp-muted">
        Work from ChatGPT, Claude, Cursor or any assistant that speaks MCP. It sees your projects, files requests, replies and sets budgets: the same things you can do here, nothing more. Its requests wait for Ali like any other.
      </p>
      <ul className="cp-keys">
        {(tokens ?? []).map((t) => (
          <li key={t.id}>
            <strong>{t.label}</strong>
            <span className="cp-muted">{t.last_used_at ? `last used ${ago(t.last_used_at)}` : 'not used yet'}</span>
            <Button
              size="sm"
              kind="ghost"
              onClick={() =>
                ask({
                  title: `Revoke “${t.label}”?`,
                  text: 'That assistant loses access at once. You can make a new key any time.',
                  confirm: 'Revoke',
                  danger: true,
                  run: async () => {
                    await api(`/portal/agent-tokens/${t.id}`, { method: 'DELETE' });
                    await load();
                  },
                })
              }
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <Button onClick={() => setMaking(true)}>Connect an assistant →</Button>
      {making ? (
        <NewKey
          onClose={() => setMaking(false)}
          onMade={async (key) => {
            setMaking(false);
            setMade(key);
            await load();
          }}
        />
      ) : null}
      {made ? <ShowKey made={made} onClose={() => setMade(null)} /> : null}
    </section>
  );
}

function NewKey({ onClose, onMade }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const make = async () => {
    try {
      onMade(await api('/portal/agent-tokens', { body: { label: label.trim() } }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal
      title="Connect an assistant"
      subtitle="Name it so you know which key to revoke later."
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={make}>
            Make the key →
          </Button>
        </>
      }
    >
      <input type="text" maxLength={60} placeholder="e.g. Claude on my laptop" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && make()} />
    </Modal>
  );
}

/** The key, once. After this dialog only its hash exists. */
function ShowKey({ made, onClose }) {
  const config = JSON.stringify({ mcpServers: { 'malipetek-dev': { type: 'http', url: made.mcpUrl, headers: { Authorization: `Bearer ${made.token}` } } } }, null, 2);
  const Copy = ({ text }) => {
    const [done, setDone] = useState(false);
    return (
      <Button size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true), () => {})}>
        {done ? 'Copied' : 'Copy'}
      </Button>
    );
  };
  return (
    <Modal
      wide
      title={`Key for ${made.label}`}
      subtitle="Copy it now: it is shown only this once."
      onClose={onClose}
      actions={
        <Button kind="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="cp-keyfields">
        <span className="cp-label">Server address</span>
        <code>{made.mcpUrl}</code>
        <Copy text={made.mcpUrl} />
        <span className="cp-label">Key</span>
        <code>{made.token}</code>
        <Copy text={made.token} />
        <span className="cp-label">For an MCP config file</span>
        <pre>{config}</pre>
        <Copy text={config} />
      </div>
      <p className="cp-hint">The assistant sends the key as "Authorization: Bearer …".</p>
    </Modal>
  );
}

function Github() {
  const { ask } = usePortal();
  const [state, setState] = useState(null);
  const load = () => api('/portal/github').then(setState, () => setState({ installations: [], installUrl: null }));
  useEffect(() => void load(), []);
  return (
    <section className="cp-card">
      <h2 className="cp-h2">GitHub</h2>
      <p className="cp-muted">Keep a project's code in your own GitHub account, or let us work on an existing private repo. You pick exactly which repos the app can reach, and can revoke it any time on GitHub.</p>
      <ul className="cp-keys">
        {(state?.installations ?? []).map((i) => (
          <li key={i.id}>
            <strong>@{i.account_login}</strong>
            <span className="cp-muted">connected</span>
            <Button
              size="sm"
              kind="ghost"
              onClick={() =>
                ask({
                  title: `Disconnect @${i.account_login}?`,
                  text: 'Projects using this connection lose access to the repos it reached. You can reconnect any time by installing the app again.',
                  confirm: 'Disconnect',
                  danger: true,
                  run: async () => {
                    await api(`/portal/github/${i.id}`, { method: 'DELETE' });
                    await load();
                  },
                })
              }
            >
              Disconnect
            </Button>
          </li>
        ))}
      </ul>
      {state?.installUrl ? <Button href={state.installUrl}>Connect GitHub →</Button> : null}
    </section>
  );
}

/* ————— billing ————— */

export function BillingView() {
  const { data } = usePortal();
  const u = data.usage ?? { billedCents: 0, openCents: 0, aiCents: 0, tickets: 0 };
  const rows = useMemo(() => data.tickets.filter((t) => totalOf(t) > 0 || t.human_seconds > 0), [data.tickets]);
  return (
    <div className="cp-view">
      <PageHead title="Billing" sub={`Ali's time at $${HOURLY_USD} an hour, billed by the second, plus what the AI cost, with no markup.`} />
      <div className="cp-tiles">
        <div className="cp-tile">
          <span className="cp-label">Finished requests</span>
          <b>{money(u.billedCents)}</b>
        </div>
        <div className="cp-tile">
          <span className="cp-label">On the meter now</span>
          <b>{money(u.openCents)}</b>
        </div>
        <div className="cp-tile">
          <span className="cp-label">AI, at cost</span>
          <b>{money(u.aiCents)}</b>
        </div>
        <div className="cp-tile">
          <span className="cp-label">Requests</span>
          <b>{data.tickets.length}</b>
        </div>
      </div>
      <section className="cp-card cp-card--flush">
        {rows.length ? (
          <table className="cp-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Status</th>
                <th className="is-num">Ali's time</th>
                <th className="is-num">AI</th>
                <th className="is-num">Total</th>
                <th className="is-num">Budget</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const p = priceOf({ humanSeconds: t.human_seconds, aiMicroUsd: t.ai_micro_usd });
                return (
                  <tr key={t.id} onClick={() => go(`ticket/${t.id}`)}>
                    <td>
                      <a href={href(`ticket/${t.id}`)}>
                        <span className="cp-row__id">#{t.id}</span> {t.title}
                      </a>
                    </td>
                    <td>
                      <StatusPill status={t.status} />
                    </td>
                    <td className="is-num">
                      {clock(t.human_seconds)} · {money(p.timeCents)}
                    </td>
                    <td className="is-num">{money(p.aiCents)}</td>
                    <td className="is-num">
                      <b>{money(totalOf(t))}</b>
                      {t.price_cents === null && isOpen(t) ? <em> running</em> : null}
                    </td>
                    <td className="is-num">{t.budget_cents === null ? '—' : money(t.budget_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="cp-empty">Nothing billed yet. The meter starts when Ali or an agent works on a request.</p>
        )}
      </section>
    </div>
  );
}
