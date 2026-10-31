/* The client portal's pages, other than a single request (TicketView.jsx). */
import { useEffect, useMemo, useState } from 'react';
import { api, errorText, fmtTime } from '../../lib/portal';
import { HOURLY_USD, clock, money, priceOf } from '../../lib/pricing.js';
import { Board, STAGES, stageText } from './Board.jsx';
import { go, href, isOpen, useT, usePortal } from './store.js';
import { Button, Icon, MiniTrack, Modal, StatusPill, ago, cx, fmtDate, totalOf } from './ui.jsx';

const unpublished = (site) => site?.state === 'ready' && site.previewDeploy && site.previewDeploy !== site.productionDeploy;
const overBudget = (t) => isOpen(t) && t.budget_cents !== null && totalOf(t) > t.budget_cents;
const greeting = (t) => {
  const h = new Date().getHours();
  return h < 5 ? t('views.greeting.evening') : h < 12 ? t('views.greeting.morning') : h < 18 ? t('views.greeting.afternoon') : t('views.greeting.evening');
};

/* ————— shared rows ————— */

export function RequestRow({ t: ticket, hovered, onHover, showProject = true }) {
  const t = useT();
  return (
    <li>
      <a
        className={cx('cp-row', !showProject && 'cp-row--bare', ticket.unread && 'is-unread', hovered && 'is-hover')}
        href={href(`ticket/${ticket.id}`)}
        onMouseEnter={() => onHover?.(ticket.id)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(ticket.id)}
        onBlur={() => onHover?.(null)}
      >
        <span className="cp-row__id">#{ticket.id}</span>
        <span className="cp-row__title">
          <span>{ticket.title}</span>
          {ticket.unread ? <span className="cp-new">{t('views.row.newReply')}</span> : null}
          {overBudget(ticket) ? <span className="cp-new cp-new--warn">{t('views.row.pausedAtBudget')}</span> : null}
        </span>
        {showProject ? <span className="cp-row__project">{ticket.project_name ?? '—'}</span> : null}
        <MiniTrack status={ticket.status} />
        <StatusPill status={ticket.status} />
        <span className="cp-row__cost">{totalOf(ticket) ? money(totalOf(ticket)) : ''}</span>
        <span className="cp-row__when">{ago(ticket.updated_at)}</span>
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
  const t = useT();
  const { data, compose } = usePortal();
  const [stage, setStage] = useState(null);
  const [hovered, setHovered] = useState(null);
  const { tickets, projects, user } = data;
  const open = tickets.filter(isOpen);
  const shown = stage ? tickets.filter((t) => t.status === stage) : open;
  const stageEntry = STAGES.find((s) => s.key === stage);
  const stageLabel = stageEntry ? stageText(t, stageEntry) : undefined;
  const name = user.name || user.email.split('@')[0];
  const building = open.filter((x) => x.status === 'in_progress').length;

  const summary = [
    open.length ? t('views.overview.openCount', { n: open.length }) : t('views.overview.noOpen'),
    building ? t('views.overview.building', { n: building }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="cp-view">
      <PageHead title={t('views.overview.title', { greeting: greeting(t), name })} sub={summary}>
        <Button kind="primary" onClick={() => compose()}>
          <Icon name="plus" size={15} /> {t('nav.newRequest')}
        </Button>
      </PageHead>

      <Board tickets={tickets} stage={stage} onStage={setStage} hovered={hovered} onHover={setHovered} onOpen={(id) => go(`ticket/${id}`)} />

      <div className="cp-overview">
        <section className="cp-card cp-card--flush">
          <header className="cp-card__head">
            <h2 className="cp-h2">{stage ? stageLabel : t('views.overview.openRequests')}</h2>
            {stage ? (
              <button type="button" className="cp-linkbtn" onClick={() => setStage(null)}>
                {t('views.overview.showAllOpen')}
              </button>
            ) : (
              <a className="cp-linkbtn" href={href('requests?filter=all')}>
                {t('views.overview.allRequests')}
              </a>
            )}
          </header>
          {shown.length ? (
            <ul className="cp-rows cp-rows--compact">
              {shown.map((x) => (
                <RequestRow key={x.id} t={x} hovered={hovered === x.id} onHover={setHovered} />
              ))}
            </ul>
          ) : (
            <div className="cp-empty">
              {tickets.length ? <p>{t('views.overview.nothingHere')}</p> : <p>{t('views.overview.nothingYet')}</p>}
              {!stage ? (
                <Button kind="primary" onClick={() => compose()}>
                  {t('nav.newRequest')}
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
          <h2 className="cp-h2">{t('views.overview.projects')}</h2>
          <a className="cp-linkbtn" href="/portal/start">
            {t('views.overview.addProject')}
          </a>
        </header>
        {projects.length ? (
          <div className="cp-projects">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} tickets={tickets.filter((x) => x.project_id === p.id)} />
            ))}
          </div>
        ) : (
          <div className="cp-card cp-empty">
            <p>{t('views.overview.noProject')}</p>
            <Button kind="primary" href="/portal/start">
              {t('views.overview.setupFirst')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/** What is waiting on the client: replies, a paused meter, a preview to publish, setup to finish. */
function NeedsYou() {
  const t = useT();
  const { data } = usePortal();
  const items = [];
  if (!data.projects.length) items.push({ key: 'setup', href: '/portal/start', title: t('views.needs.setupTitle'), text: t('views.needs.setupText') });
  for (const ticket of data.tickets) {
    if (ticket.unread) items.push({ key: `r${ticket.id}`, href: href(`ticket/${ticket.id}`), title: t('views.needs.replyTitle', { id: ticket.id }), text: ticket.title });
    if (overBudget(ticket)) items.push({ key: `b${ticket.id}`, href: href(`ticket/${ticket.id}`), title: t('views.needs.pausedTitle', { id: ticket.id }), text: t('views.needs.pausedText') });
  }
  for (const p of data.projects) {
    if (unpublished(p.site)) {
      items.push({
        key: `p${p.id}`,
        href: href(`project/${p.id}`),
        title: t('views.needs.previewTitle', { name: p.name }),
        text: data.canPublish ? t('views.needs.previewPublish') : t('views.needs.previewTell'),
      });
    }
    if (p.kind === 'new' && !p.site) items.push({ key: `s${p.id}`, href: href(`project/${p.id}`), title: t('views.needs.siteTitle', { name: p.name }), text: t('views.needs.siteText') });
    for (const c of p.setup.checks) {
      // Optional steps (a custom domain) never nag.
      if (c.owner === 'you' && c.state === 'missing' && c.blocking) items.push({ key: `c${p.id}${c.key}`, href: href(`project/${p.id}`), title: `${p.name}: ${c.label}`, text: c.detail });
    }
  }
  return (
    <section className="cp-card">
      <h2 className="cp-h2">{t('views.needs.title')}</h2>
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
        <p className="cp-muted cp-allclear">{t('views.needs.clear')}</p>
      )}
    </section>
  );
}

function SpendCard() {
  const t = useT();
  const { data } = usePortal();
  const u = data.usage ?? { billedCents: 0, openCents: 0, aiCents: 0 };
  return (
    <section className="cp-card">
      <header className="cp-card__head cp-card__head--tight">
        <h2 className="cp-h2">{t('views.spend.title')}</h2>
        <a className="cp-linkbtn" href={href('billing')}>
          {t('views.spend.details')}
        </a>
      </header>
      <div className="cp-spend">
        <div>
          <span className="cp-label">{t('views.spend.finished')}</span>
          <b>{money(u.billedCents)}</b>
        </div>
        <div>
          <span className="cp-label">{t('views.spend.onMeter')}</span>
          <b>{money(u.openCents)}</b>
        </div>
      </div>
      <p className="cp-hint">{t('views.spend.aiNote', { amount: money(u.aiCents) })}</p>
    </section>
  );
}

function siteLine(project, t) {
  const s = project.site;
  if (!s) return project.kind === 'new' ? t('views.site.noSite') : project.repo ? t('views.site.codeConnected') : t('views.site.gettingSetUp');
  if (s.state === 'failed') return t('views.site.setupStopped');
  if (s.state !== 'ready') return t('views.site.being');
  return unpublished(s) ? t('views.site.ahead') : t('views.site.live');
}

function ProjectCard({ project, tickets }) {
  const t = useT();
  const open = tickets.filter(isOpen).length;
  const s = project.site;
  const live = s?.state === 'ready';
  const { setup } = project;
  return (
    <a className="cp-project" href={href(`project/${project.id}`)}>
      <div className="cp-project__top">
        <span className={cx('cp-project__dot', live ? (unpublished(s) ? 'is-ahead' : 'is-live') : s?.state === 'failed' ? 'is-bad' : 'is-wait')} />
        <strong>{project.name}</strong>
        <span className="cp-tag">{project.kind === 'new' ? t('views.project.builtByUs') : t('views.project.yourCode')}</span>
      </div>
      <p className="cp-project__site">{live ? s.productionUrl.replace(/^https:\/\//, '') : siteLine(project, t)}</p>
      <div className="cp-project__foot">
        <span>{siteLine(project, t)}</span>
        <span>{t('views.project.counts', { open, total: tickets.length })}</span>
      </div>
      <div className="cp-project__setup" title={t('views.project.setupProgress', { ready: setup.ready, total: setup.total })}>
        <span style={{ width: `${setup.total ? (setup.ready / setup.total) * 100 : 100}%` }} />
      </div>
    </a>
  );
}

/* ————— all requests ————— */

const FILTERS = [
  { key: 'open', labelKey: 'views.filter.open', test: isOpen },
  { key: 'you', labelKey: 'views.filter.needs', test: (t) => t.unread || overBudget(t) },
  { key: 'done', labelKey: 'views.filter.done', test: (t) => t.status === 'done' || t.status === 'declined' },
  { key: 'all', labelKey: 'views.filter.all', test: () => true },
];

export function RequestsView({ query }) {
  const t = useT();
  const { data, compose } = usePortal();
  const [filter, setFilter] = useState(query.get('filter') ?? 'open');
  const [project, setProject] = useState(query.get('project') ?? '');
  const [text, setText] = useState('');
  useEffect(() => {
    if (query.get('filter')) setFilter(query.get('filter'));
  }, [query]);
  const test = FILTERS.find((f) => f.key === filter)?.test ?? isOpen;
  const q = text.trim().toLowerCase();
  const rows = data.tickets.filter((x) => test(x) && (!project || x.project_id === project) && (!q || `#${x.id} ${x.title}`.toLowerCase().includes(q)));

  return (
    <div className="cp-view">
      <PageHead title={t('nav.requests')} sub={t('views.requests.sub')}>
        <Button kind="primary" onClick={() => compose(project || undefined)}>
          <Icon name="plus" size={15} /> {t('nav.newRequest')}
        </Button>
      </PageHead>
      <div className="cp-toolbar">
        <div className="cp-seg" role="group" aria-label={t('views.requests.show')}>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {t(f.labelKey)}
              <span>{data.tickets.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        {data.projects.length > 1 ? (
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label={t('views.col.project')}>
            <option value="">{t('views.requests.allProjects')}</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        <input type="search" placeholder={t('views.requests.search')} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('views.requests.search')} />
      </div>
      <section className="cp-card cp-card--flush">
        {rows.length ? (
          <ul className="cp-rows">
            <li className="cp-rows__head" aria-hidden="true">
              <span>#</span>
              <span>{t('views.col.request')}</span>
              <span>{t('views.col.project')}</span>
              <span>{t('views.col.steps')}</span>
              <span>{t('views.col.status')}</span>
              <span>{t('views.col.cost')}</span>
              <span>{t('views.col.updated')}</span>
            </li>
            {rows.map((x) => (
              <RequestRow key={x.id} t={x} />
            ))}
          </ul>
        ) : (
          <p className="cp-empty">{t('views.requests.noMatch')}</p>
        )}
      </section>
    </div>
  );
}

/* ————— one project ————— */

export function ProjectView({ id }) {
  const t = useT();
  const { data, compose } = usePortal();
  const project = data.projects.find((p) => p.id === id);
  if (!project) return <p className="cp-empty">{t('views.project.notOnAccount')}</p>;
  const tickets = data.tickets.filter((x) => x.project_id === project.id);
  const known = project.setup.checks.filter((c) => c.state !== 'unknown');
  return (
    <div className="cp-view">
      <nav className="cp-crumbs">
        <a href={href('')}>{t('nav.overview')}</a>
        <span>{project.name}</span>
      </nav>
      <PageHead title={project.name} sub={project.kind === 'new' ? t('views.project.builtSub') : t('views.project.codeSub')}>
        <Button kind="primary" onClick={() => compose(project.id)}>
          <Icon name="plus" size={15} /> {t('nav.newRequest')}
        </Button>
      </PageHead>

      <div className="cp-projectgrid">
        <SiteCard project={project} />
        <section className="cp-card">
          <header className="cp-card__head cp-card__head--tight">
            <h2 className="cp-h2">{t('views.project.setup')}</h2>
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
                <span className="cp-checks__who">{c.owner === 'you' ? t('views.checks.you') : t('views.checks.us')}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="cp-section">
        <header className="cp-section__head">
          <h2 className="cp-h2">{t('views.project.requests')}</h2>
          <a className="cp-linkbtn" href={href(`requests?filter=all&project=${project.id}`)}>
            {t('views.project.openList')}
          </a>
        </header>
        <div className="cp-card cp-card--flush">
          {tickets.length ? (
            <ul className="cp-rows cp-rows--compact">
              {tickets.map((x) => (
                <RequestRow key={x.id} t={x} showProject={false} />
              ))}
            </ul>
          ) : (
            <p className="cp-empty">{t('views.project.noRequests')}</p>
          )}
        </div>
      </section>
    </div>
  );
}

/** The hosted site: set it up, follow it, open it, publish it, roll it back. */
function SiteCard({ project }) {
  const t = useT();
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
        <h2 className="cp-h2">{t('views.site.code')}</h2>
        <p className="cp-muted">{project.repo ? t('views.site.workingOn', { repo: project.repo.replace(/^https:\/\/github\.com\//, '') }) : t('views.site.connecting')}</p>
      </section>
    );
  }
  if (!site || site.state === 'failed') {
    return (
      <section className="cp-card cp-site">
        <h2 className="cp-h2">{t('views.site.title')}</h2>
        {site ? <p className="cp-error">{t('views.site.setupFailed')}</p> : null}
        <p className="cp-muted">{t('views.site.intro')}</p>
        <Button
          kind="primary"
          disabled={starting}
          onClick={() => setStarting(true)}
        >
          {site ? t('views.site.tryAgain') : t('views.site.setUp')}
        </Button>
        {starting ? (
          <StartSite
            project={project}
            onClose={() => setStarting(false)}
            onDone={async () => {
              setStarting(false);
              notify(t('views.site.startedNotice'));
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
        <h2 className="cp-h2">{t('views.site.title')}</h2>
        <p className="cp-making" role="status">
          <span className="cp-spinner" /> {t('views.site.making')}
        </p>
      </section>
    );
  }

  const ahead = unpublished(site);
  const publish = () =>
    ask({
      title: t('views.site.publishTitle', { name: project.name }),
      text: t('views.site.publishText', { preview: site.previewUrl, live: site.productionUrl }),
      confirm: t('views.site.publish'),
      run: async () => {
        await api(`/portal/projects/${project.id}/site/publish`, { method: 'POST', body: {} });
        notify(t('views.site.publishedNotice'));
        await reload();
      },
    });
  const rollback = (d) =>
    ask({
      title: t('views.site.rollbackTitle'),
      text: d.ticket_id
        ? t('views.site.rollbackRequest', { date: fmtDate(d.created_at), id: d.ticket_id })
        : t('views.site.rollbackDated', { date: fmtDate(d.created_at) }),
      confirm: t('views.site.rollbackConfirm'),
      run: async () => {
        await api(`/portal/projects/${project.id}/site/rollback`, { body: { deployId: d.id } });
        notify(t('views.site.rolledBack'));
        await reload();
      },
    });

  return (
    <section className="cp-card cp-site">
      <header className="cp-card__head cp-card__head--tight">
        <h2 className="cp-h2">{t('views.site.title')}</h2>
        <span className={cx('cp-sitestate', ahead ? 'is-ahead' : 'is-live')}>{ahead ? t('views.site.ahead') : t('views.site.liveUpToDate')}</span>
      </header>
      <div className="cp-channels">
        <a className="cp-channel" href={site.previewUrl} target="_blank" rel="noopener">
          <span className="cp-label">{t('views.site.channelPreview')}</span>
          <strong>{site.previewUrl.replace(/^https:\/\//, '')}</strong>
          <span className="cp-muted">{t('views.site.previewHint')}</span>
          <Icon name="ext" size={14} />
        </a>
        <a className="cp-channel" href={site.productionUrl} target="_blank" rel="noopener">
          <span className="cp-label">{t('views.site.channelLive')}</span>
          <strong>{(site.customDomain || site.productionUrl).replace(/^https:\/\//, '')}</strong>
          <span className="cp-muted">{t('views.site.liveHint')}</span>
          <Icon name="globe" size={14} />
        </a>
      </div>
      {ahead ? (
        data.canPublish ? (
          <Button kind="primary" onClick={publish}>
            {t('views.site.publishPreview')}
          </Button>
        ) : (
          <p className="cp-hint">{t('views.site.aheadHint')}</p>
        )
      ) : null}
      {deploys?.length ? (
        <>
          <h3 className="cp-label cp-site__hist">{t('views.site.versions')}</h3>
          <ol className="cp-versions">
            {deploys.slice(0, 8).map((d) => {
              const isLive = d.id === site.productionDeploy;
              const isPreview = d.id === site.previewDeploy;
              return (
                <li key={d.id}>
                  <span className={cx('cp-versions__dot', isLive && 'is-live', isPreview && !isLive && 'is-preview')} />
                  <span>
                    {d.ticket_id ? <a href={href(`ticket/${d.ticket_id}`)}>{t('views.site.requestLink', { id: d.ticket_id })}</a> : t('views.site.siteVersion')}
                    <em>{fmtTime(d.created_at)}</em>
                  </span>
                  {isLive ? <span className="cp-tag cp-tag--live">{t('views.site.tagLive')}</span> : null}
                  {isPreview ? <span className="cp-tag">{t('views.site.tagPreview')}</span> : null}
                  {!isLive && data.canPublish ? (
                    <button type="button" className="cp-linkbtn" onClick={() => rollback(d)}>
                      {t('views.site.putLive')}
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
  const t = useT();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('views.startSite.title', { name: project.name })}
      subtitle={t('views.startSite.subtitle')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('views.startSite.notNow')}</Button>
          <Button
            kind="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/portal/projects/${project.id}/site`, { method: 'POST', body: {} });
                await onDone();
              } catch (e) {
                setError(errorText(e, t));
                setBusy(false);
              }
            }}
          >
            {t('views.startSite.setIt')}
          </Button>
        </>
      }
    >
      <ol className="cp-numbered">
        <li>{t('views.startSite.step1')}</li>
        <li>{t('views.startSite.step2')}</li>
      </ol>
      <p className="cp-hint">{t('views.startSite.hint')}</p>
    </Modal>
  );
}

/* ————— connections ————— */

export function ConnectionsView() {
  const t = useT();
  const { data } = usePortal();
  if (data.user.role !== 'client') {
    return (
      <div className="cp-view">
        <PageHead title={t('nav.connections')} />
        <p className="cp-empty">{t('views.connections.clientOnly')}</p>
      </div>
    );
  }
  return <Connections />;
}

/** One list of assistant keys feeds two cards: ChatGPT's own, and everything else. */
function Connections() {
  const t = useT();
  const [tokens, setTokens] = useState(null);
  const load = () => api('/portal/agent-tokens').then(({ tokens }) => setTokens(tokens), () => setTokens([]));
  useEffect(() => void load(), []);
  const isChatGPT = (x) => x.via === 'ChatGPT';
  return (
    <div className="cp-view">
      <PageHead title={t('nav.connections')} sub={t('views.connections.sub')} />
      <div className="cp-connect">
        <ChatGPT tokens={(tokens ?? []).filter(isChatGPT)} reload={load} />
        <Assistants tokens={(tokens ?? []).filter((x) => !isChatGPT(x))} reload={load} />
        <Github />
        <Cloudflare />
      </div>
    </div>
  );
}

/** A connected assistant's row: what it is, when it last worked, and the way to cut it off. */
function KeyRow({ t: token, reload, what }) {
  const t = useT();
  const { ask } = usePortal();
  return (
    <li>
      <strong>{token.label}</strong>
      <span className="cp-muted">
        {token.last_used_at ? t('views.connections.lastUsed', { when: ago(token.last_used_at) }) : t('views.connections.connectedAgo', { when: ago(token.created_at) })}
      </span>
      <Button
        size="sm"
        kind="ghost"
        onClick={() =>
          ask({
            title: t('views.keys.disconnectTitle', { name: what ?? `“${token.label}”` }),
            text: t('views.keys.disconnectText'),
            confirm: t('views.connections.disconnect'),
            danger: true,
            run: async () => {
              await api(`/portal/agent-tokens/${token.id}`, { method: 'DELETE' });
              await reload();
            },
          })
        }
      >
        {t('views.connections.disconnect')}
      </Button>
    </li>
  );
}

/** The address assistants connect to: this site's own MCP endpoint. */
const MCP_URL = typeof location === 'undefined' ? 'https://malipetek.dev/mcp' : `${location.origin}/mcp`;

function CopyButton({ text, label }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true), () => {})}>
      {done ? t('views.copy.copied') : (label ?? t('views.copy.copy'))}
    </Button>
  );
}

function ChatGPT({ tokens, reload }) {
  const t = useT();
  const connected = tokens.length > 0;
  return (
    <section className="cp-card">
      <h2 className="cp-h2">ChatGPT</h2>
      <p className="cp-muted">{t('views.chatgpt.intro')}</p>
      {connected ? (
        <ul className="cp-keys">
          {tokens.map((x) => (
            <KeyRow key={x.id} t={x} reload={reload} what="ChatGPT" />
          ))}
        </ul>
      ) : (
        <ol className="cp-howto">
          <li>{t('views.chatgpt.step1')}</li>
          <li>
            {t('views.chatgpt.paste')} <code>{MCP_URL}</code> <CopyButton text={MCP_URL} />
          </li>
          <li>{t('views.chatgpt.step3')}</li>
        </ol>
      )}
      {!connected ? (
        <Button href="https://chatgpt.com" target="_blank" rel="noreferrer">
          {t('views.chatgpt.open')}
        </Button>
      ) : null}
    </section>
  );
}

function Assistants({ tokens, reload }) {
  const t = useT();
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState(null);
  const load = reload;
  return (
    <section className="cp-card">
      <h2 className="cp-h2">{t('views.assistants.title')}</h2>
      <p className="cp-muted">{t('views.assistants.intro')}</p>
      <ul className="cp-keys">
        {tokens.map((x) => (
          <KeyRow key={x.id} t={x} reload={reload} />
        ))}
      </ul>
      <Button onClick={() => setMaking(true)}>{t('views.assistants.connect')}</Button>
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
  const t = useT();
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const make = async () => {
    try {
      onMade(await api('/portal/agent-tokens', { body: { label: label.trim() } }));
    } catch (e) {
      setError(errorText(e, t));
    }
  };
  return (
    <Modal
      title={t('views.newKey.title')}
      subtitle={t('views.newKey.subtitle')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button kind="primary" onClick={make}>
            {t('views.newKey.make')}
          </Button>
        </>
      }
    >
      <input type="text" maxLength={60} placeholder={t('views.newKey.placeholder')} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && make()} />
    </Modal>
  );
}

/** The key, once. After this dialog only its hash exists. */
function ShowKey({ made, onClose }) {
  const t = useT();
  const config = JSON.stringify({ mcpServers: { 'malipetek-dev': { type: 'http', url: made.mcpUrl, headers: { Authorization: `Bearer ${made.token}` } } } }, null, 2);
  const Copy = ({ text }) => {
    const [done, setDone] = useState(false);
    return (
      <Button size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true), () => {})}>
        {done ? t('views.copy.copied') : t('views.copy.copy')}
      </Button>
    );
  };
  return (
    <Modal
      wide
      title={t('views.showKey.title', { label: made.label })}
      subtitle={t('views.showKey.subtitle')}
      onClose={onClose}
      actions={
        <Button kind="primary" onClick={onClose}>
          {t('views.showKey.done')}
        </Button>
      }
    >
      <div className="cp-keyfields">
        <span className="cp-label">{t('views.showKey.server')}</span>
        <code>{made.mcpUrl}</code>
        <Copy text={made.mcpUrl} />
        <span className="cp-label">{t('views.showKey.key')}</span>
        <code>{made.token}</code>
        <Copy text={made.token} />
        <span className="cp-label">{t('views.showKey.configFile')}</span>
        <pre>{config}</pre>
        <Copy text={config} />
      </div>
      <p className="cp-hint">{t('views.showKey.hint')}</p>
    </Modal>
  );
}

function Github() {
  const t = useT();
  const { ask } = usePortal();
  const [state, setState] = useState(null);
  const load = () => api('/portal/github').then(setState, () => setState({ installations: [], installUrl: null }));
  useEffect(() => void load(), []);
  return (
    <section className="cp-card">
      <h2 className="cp-h2">GitHub</h2>
      <p className="cp-muted">{t('views.github.intro')}</p>
      <ul className="cp-keys">
        {(state?.installations ?? []).map((i) => (
          <li key={i.id}>
            <strong>@{i.account_login}</strong>
            <span className="cp-muted">{t('views.connections.connected')}</span>
            <Button
              size="sm"
              kind="ghost"
              onClick={() =>
                ask({
                  title: t('views.github.disconnectTitle', { login: i.account_login }),
                  text: t('views.github.disconnectText'),
                  confirm: t('views.connections.disconnect'),
                  danger: true,
                  run: async () => {
                    await api(`/portal/github/${i.id}`, { method: 'DELETE' });
                    await load();
                  },
                })
              }
            >
              {t('views.connections.disconnect')}
            </Button>
          </li>
        ))}
      </ul>
      {/* A project that names a repo we cannot read: connect, or the work waits. */}
      {(state?.unconnected ?? []).length ? (
        <div className="cp-notice cp-notice--warn" role="status">
          <p>
            {t('views.github.waitingOnConnection', { count: (state?.unconnected ?? []).length })}
          </p>
          <ul className="cp-keys">
            {(state?.unconnected ?? []).map((p) => (
              <li key={p.slug}>
                <strong>{p.name}</strong>
                <span className="cp-muted">{p.repo.replace(/^https:\/\/github\.com\//, '')}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {state?.installUrl ? <Button href={state.installUrl}>{t('views.github.connect')}</Button> : null}
    </section>
  );
}

/** What the Cloudflare callback said, from ?cloudflare=…, once. */
const CF_OUTCOME = {
  connected: ['ok', 'views.cloudflare.connected'],
  declined: ['warn', 'views.cloudflare.declined'],
  failed: ['warn', 'views.cloudflare.failed'],
  signin: ['warn', 'views.cloudflare.signin'],
};

function Cloudflare() {
  const t = useT();
  const { ask } = usePortal();
  const [state, setState] = useState(null);
  const [outcome] = useState(() => {
    if (typeof location === 'undefined') return null;
    const said = new URLSearchParams(location.search).get('cloudflare');
    if (said) history.replaceState(null, '', `${location.pathname}${location.hash}`);
    return CF_OUTCOME[said] ?? null;
  });
  const load = () => api('/portal/cloudflare').then(setState, () => setState({ connections: [], connectUrl: null }));
  useEffect(() => void load(), []);
  const names = (c) => (c.accounts.length ? c.accounts.map((a) => a.name).join(', ') : t('views.cloudflare.yourAccount'));
  return (
    <section className="cp-card">
      <h2 className="cp-h2">Cloudflare</h2>
      <p className="cp-muted">{t('views.cloudflare.intro')}</p>
      {outcome ? <p className={cx('cp-notice', `cp-notice--${outcome[0]}`)}>{t(outcome[1])}</p> : null}
      <ul className="cp-keys">
        {(state?.connections ?? []).map((c) => (
          <li key={c.id}>
            <strong>{names(c)}</strong>
            <span className={c.lapsed ? 'cp-warn' : 'cp-muted'}>{c.lapsed ? t('views.cloudflare.expired') : t('views.connections.connectedAgo', { when: ago(c.createdAt) })}</span>
            <Button
              size="sm"
              kind="ghost"
              onClick={() =>
                ask({
                  title: t('views.cloudflare.disconnectTitle', { name: names(c) }),
                  text: t('views.cloudflare.disconnectText'),
                  confirm: t('views.connections.disconnect'),
                  danger: true,
                  run: async () => {
                    await api(`/portal/cloudflare/${c.id}`, { method: 'DELETE' });
                    await load();
                  },
                })
              }
            >
              {t('views.connections.disconnect')}
            </Button>
          </li>
        ))}
      </ul>
      {state?.connectUrl ? (
        <Button href={state.connectUrl}>{state.connections.some((c) => !c.lapsed) ? t('views.cloudflare.connectAnother') : t('views.cloudflare.connect')}</Button>
      ) : null}
    </section>
  );
}

/* ————— billing ————— */

export function BillingView() {
  const t = useT();
  const { data } = usePortal();
  const u = data.usage ?? { billedCents: 0, openCents: 0, aiCents: 0, tickets: 0 };
  const rows = useMemo(() => data.tickets.filter((x) => totalOf(x) > 0 || x.human_seconds > 0), [data.tickets]);
  return (
    <div className="cp-view">
      <PageHead title={t('nav.billing')} sub={t('views.billing.sub', { rate: `$${HOURLY_USD}` })} />
      <div className="cp-tiles">
        <div className="cp-tile">
          <span className="cp-label">{t('views.billing.finished')}</span>
          <b>{money(u.billedCents)}</b>
        </div>
        <div className="cp-tile">
          <span className="cp-label">{t('views.billing.onMeterNow')}</span>
          <b>{money(u.openCents)}</b>
        </div>
        <div className="cp-tile">
          <span className="cp-label">{t('views.billing.aiAtCost')}</span>
          <b>{money(u.aiCents)}</b>
        </div>
        <div className="cp-tile">
          <span className="cp-label">{t('nav.requests')}</span>
          <b>{data.tickets.length}</b>
        </div>
      </div>
      <section className="cp-card cp-card--flush">
        {rows.length ? (
          <table className="cp-table">
            <thead>
              <tr>
                <th>{t('views.col.request')}</th>
                <th>{t('views.col.status')}</th>
                <th className="is-num">{t('views.col.time')}</th>
                <th className="is-num">{t('views.col.ai')}</th>
                <th className="is-num">{t('views.col.total')}</th>
                <th className="is-num">{t('views.col.budget')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ticket) => {
                const p = priceOf({ humanSeconds: ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd });
                return (
                  <tr key={ticket.id} onClick={() => go(`ticket/${ticket.id}`)}>
                    <td>
                      <a href={href(`ticket/${ticket.id}`)}>
                        <span className="cp-row__id">#{ticket.id}</span> {ticket.title}
                      </a>
                    </td>
                    <td>
                      <StatusPill status={ticket.status} />
                    </td>
                    <td className="is-num">
                      {clock(ticket.human_seconds)} · {money(p.timeCents)}
                    </td>
                    <td className="is-num">{money(p.aiCents)}</td>
                    <td className="is-num">
                      <b>{money(totalOf(ticket))}</b>
                      {ticket.price_cents === null && isOpen(ticket) ? <em> {t('views.billing.running')}</em> : null}
                    </td>
                    <td className="is-num">{ticket.budget_cents === null ? '—' : money(ticket.budget_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="cp-empty">{t('views.billing.empty')}</p>
        )}
      </section>
    </div>
  );
}
