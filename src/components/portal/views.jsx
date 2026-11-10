/* The client portal's pages, other than a single request (TicketView.jsx). */
import { useEffect, useMemo, useState } from 'react';
import { api, errorText, fmtTime } from '../../lib/portal';
import { billOf, HOURLY_USD, clock, money } from '../../lib/pricing.js';
import { Board, DRAG_TICKET, STAGES, stageText } from './Board.jsx';
import { boardReturn, go, href, isOpen, useT, usePortal } from './store.js';
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
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TICKET, String(ticket.id));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onMouseEnter={() => onHover?.(ticket.id)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(ticket.id)}
        onBlur={() => onHover?.(null)}
      >
        <span className="cp-row__id">#{ticket.id}</span>
        <span className="cp-row__title">
          <span>{ticket.title}</span>
          {ticket.first_preview ? <span className="cp-new">{t('views.row.firstPreview')}</span> : null}
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

function PageHead({ title, sub, children, style }) {
  return (
    <header className="cp-head" style={style}>
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children ? <div className="cp-head__actions">{children}</div> : null}
    </header>
  );
}

/** The same requests, grouped by the project (and its sites) they belong to. */
function GroupedRequests({ projects, tickets, hovered, onHover }) {
  const t = useT();
  const groups = projects
    .map((project) => ({ project, rows: tickets.filter((x) => x.project_id === project.id) }))
    .filter((group) => group.rows.length);
  const loose = tickets.filter((x) => !x.project_id);
  return (
    <div className="cp-groups">
      {groups.map(({ project, rows }) => {
        const sites = project.sites ?? [];
        return (
          <section className="cp-group" key={project.id}>
            <header className="cp-group__head">
              <a href={href(`project/${project.id}`)}>{project.name}</a>
              <span className="cp-muted">{t('views.sites.count', { n: sites.length })}</span>
            </header>
            <ul className="cp-rows cp-rows--compact">
              {rows.map((x) => (
                <RequestRow key={x.id} t={x} showProject={false} hovered={hovered === x.id} onHover={onHover} />
              ))}
            </ul>
          </section>
        );
      })}
      {loose.length ? (
        <section className="cp-group">
          <header className="cp-group__head">
            <span>{t('board.gettingSetUp')}</span>
          </header>
          <ul className="cp-rows cp-rows--compact">
            {loose.map((x) => (
              <RequestRow key={x.id} t={x} showProject={false} hovered={hovered === x.id} onHover={onHover} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ————— overview ————— */

/* The overview's filters survive hash navigation in this page load, so coming
   back to the board shows it as it was left, not reset. */
let overviewMemory = null; // { stage, project }

export function Overview() {
  const t = useT();
  const { data, compose, notify, reload } = usePortal();
  const [stage, setStage] = useState(() => overviewMemory?.stage ?? null);
  const [hovered, setHovered] = useState(null);
  const [project, setProject] = useState(() => overviewMemory?.project ?? null);
  useEffect(() => {
    overviewMemory = { stage, project };
  }, [stage, project]);
  const [sheet, setSheet] = useState(null);
  const { tickets, projects, user } = data;
  const sheetProject = sheet ? projects.find((p) => p.id === sheet.projectId) ?? null : null;
  const sheetSites = sheetProject ? (sheetProject.sites ?? (sheetProject.site ? [sheetProject.site] : [])) : [];
  const sheetSite = sheet?.siteId ? sheetSites.find((s) => s.id === sheet.siteId) ?? null : null;
  const open = tickets.filter(isOpen);
  const shown = stage ? tickets.filter((t) => t.status === stage) : open;
  const visible =
    project === null ? shown : project === 'none' ? shown.filter((t) => !t.project_id) : shown.filter((t) => t.project_id === project);
  // The board also keeps the last few shipped requests, so it gets every
  // request (open and shipped) for the chosen project, not just `shown`.
  // Why a request is not moving: the board marks the ones that have waited too
  // long, and the tooltip says what they are waiting for.
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const reasonFor = (ticket) => {
    const owner = ticket.project_id ? projectById.get(ticket.project_id) : null;
    if (ticket.client_waiting_since) return { waitingReason: t('board.reason.client'), stuck: false };
    if (ticket.status === 'new') return { waitingReason: t('board.reason.approval'), stuck: false };
    if (ticket.status === 'approved') {
      if (owner?.repoError) return { waitingReason: t('board.reason.repo'), stuck: true };
      if (owner?.repoWanted) return { waitingReason: t('board.reason.repoSoon'), stuck: false };
      return { waitingReason: t('board.reason.queue'), stuck: Date.now() / 1000 - ticket.updated_at > 12 * 3600 };
    }
    if (ticket.status === 'in_progress') return { waitingReason: t('board.reason.running'), stuck: false };
    if (ticket.status === 'review') return { waitingReason: t('board.reason.review'), stuck: false };
    return { waitingReason: null, stuck: false };
  };
  const boardTickets = (
    project === null ? tickets : project === 'none' ? tickets.filter((t) => !t.project_id) : tickets.filter((t) => t.project_id === project)
  ).map((ticket) => ({ ...ticket, ...reasonFor(ticket) }));

  const moveTicket = async (ticketId, projectId, siteId) => {
    try {
      await api(`/portal/tickets/${ticketId}`, { method: 'PATCH', body: { projectId, ...(siteId ? { siteId } : {}) } });
      notify(t('board.movedTicket'));
      await reload();
    } catch (error) {
      notify(errorText(error, t), 'error');
    }
  };
  const moveSite = async (siteId, projectId) => {
    try {
      await api(`/portal/sites/${siteId}`, { method: 'PATCH', body: { projectId } });
      notify(t('board.movedSite'));
      await reload();
    } catch (error) {
      notify(errorText(error, t), 'error');
    }
  };
  const stageEntry = STAGES.find((s) => s.key === stage);
  const stageLabel = stageEntry ? stageText(t, stageEntry) : undefined;
  const projectName = project === null ? null : project === 'none' ? t('board.gettingSetUp') : projects.find((p) => p.id === project)?.name;
  const name = user.name || user.email.split('@')[0];
  const building = open.filter((x) => x.status === 'in_progress').length;

  const summary = [
    open.length ? t('views.overview.openCount', { n: open.length }) : t('views.overview.noOpen'),
    building ? t('views.overview.building', { n: building }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="cp-view cp-view--board">
      <PageHead title={t('views.overview.title', { greeting: greeting(t), name })} sub={summary}>
        <Button kind="primary" onClick={() => compose()}>
          <Icon name="plus" size={15} /> {t('nav.newRequest')}
        </Button>
      </PageHead>

      <Board
        tickets={boardTickets}
        lanes={data.lanes}
        stage={stage}
        onStage={setStage}
        hovered={hovered}
        onHover={setHovered}
        onOpen={(id) => go(`ticket/${id}`)}
        project={project}
        onProject={setProject}
        onOpenProject={(id, siteId) => setSheet({ projectId: id, siteId: siteId ?? null })}
        onMoveTicket={moveTicket}
        onMoveSite={moveSite}
      />

      <div className="cp-board-scroll">
        <div className="cp-overview">
          <section className="cp-card cp-card--flush">
          <header className="cp-card__head">
            <h2 className="cp-h2">{stage ? stageLabel : projectName ?? t('views.overview.openRequests')}</h2>
            <div className="cp-card__tools">
              {project !== null ? (
                <button type="button" className="cp-linkbtn" onClick={() => setProject(null)}>
                  {t('board.allProjects')}
                </button>
              ) : null}
              {stage ? (
                <button type="button" className="cp-linkbtn" onClick={() => setStage(null)}>
                  {t('views.overview.showAllOpen')}
                </button>
              ) : (
                <a className="cp-linkbtn" href={href('requests?filter=all')}>
                  {t('views.overview.allRequests')}
                </a>
              )}
            </div>
          </header>
          {visible.length ? (
            !stage && projects.length && project === null ? (
              <GroupedRequests projects={projects} tickets={visible} hovered={hovered} onHover={setHovered} />
            ) : (
              <ul className="cp-rows cp-rows--compact">
                {visible.map((x) => (
                  <RequestRow key={x.id} t={x} hovered={hovered === x.id} onHover={setHovered} />
                ))}
              </ul>
            )
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
          <a className="cp-linkbtn" href={href('new')}>
            {t('views.overview.addProject')}
          </a>
        </header>
        {projects.length ? (
          <div className="cp-projects">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} tickets={tickets.filter((x) => x.project_id === p.id)} onOpen={(p) => setSheet({ projectId: p.id, siteId: null })} />
            ))}
          </div>
        ) : (
          <div className="cp-card cp-empty">
            <p>{t('views.overview.noProject')}</p>
            <Button kind="primary" href={href('new')}>
              {t('views.overview.setupFirst')}
            </Button>
          </div>
        )}
        </section>
      </div>

      {sheetProject ? (
        <EntitySheet
          project={sheetProject}
          site={sheetSite}
          tickets={tickets}
          onClose={() => setSheet(null)}
          onOpenProject={(id) => {
            // The sheet stays mounted through the route change — named, it
            // morphs into the project page's head instead of popping shut.
            boardReturn.sheet = id;
            document.querySelector('.cp-modal')?.style.setProperty('view-transition-name', 'cp-project');
            go(`project/${id}`);
          }}
          onOpenSite={(siteId) => setSheet({ projectId: sheetProject.id, siteId })}
          onNewRequest={(projectId) => {
            setSheet(null);
            compose(projectId);
          }}
        />
      ) : null}
    </div>
  );
}

/** What is waiting on the client: replies, a paused meter, a preview to publish, setup to finish. */
function NeedsYou() {
  const t = useT();
  const { data } = usePortal();
  const items = [];
  if (!data.projects.length) items.push({ key: 'setup', href: href('new'), title: t('views.needs.setupTitle'), text: t('views.needs.setupText') });
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

function ProjectCard({ project, tickets, onOpen }) {
  const t = useT();
  const open = tickets.filter(isOpen).length;
  const s = project.site;
  const sites = project.sites ?? (s ? [s] : []);
  const live = s?.state === 'ready';
  const { setup } = project;
  return (
    <a
      className="cp-project"
      href={href(`project/${project.id}`)}
      onClick={(e) => {
        if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen(project);
      }}
    >
      <div className="cp-project__top">
        <span className={cx('cp-project__dot', live ? (unpublished(s) ? 'is-ahead' : 'is-live') : s?.state === 'failed' ? 'is-bad' : 'is-wait')} />
        <strong>{project.name}</strong>
        <span className="cp-tag">{project.kind === 'new' ? t('views.project.builtByUs') : t('views.project.yourCode')}</span>
      </div>
      <p className="cp-project__site">{live ? s.productionUrl.replace(/^https:\/\//, '') : siteLine(project, t)}</p>
      <div className="cp-project__foot">
        <span>{sites.length ? t('views.sites.count', { n: sites.length }) : siteLine(project, t)}</span>
        <span>{t('views.project.counts', { open, total: tickets.length })}</span>
      </div>
      <div className="cp-project__setup" title={t('views.project.setupProgress', { ready: setup.ready, total: setup.total })}>
        <span style={{ width: `${setup.total ? (setup.ready / setup.total) * 100 : 100}%` }} />
      </div>
    </a>
  );
}

/**
 * A project or site opened from the overview. A medium sheet with the facts and
 * the few actions that used to mean "leave the board": open, preview, new request.
 */
function EntitySheet({ project, site, tickets, onClose, onOpenProject, onOpenSite, onNewRequest }) {
  const t = useT();
  const sites = project.sites ?? (project.site ? [project.site] : []);
  const own = tickets.filter((x) => x.project_id === project.id);
  const open = own.filter(isOpen).length;
  const setup = project.setup ?? { ready: 0, total: 0 };

  const urlOf = (s, kind) =>
    kind === 'live'
      ? s?.productionUrl ?? s?.cloudflare?.productionUrl ?? null
      : s?.previewUrl ?? s?.cloudflare?.previewUrl ?? null;

  const stateOf = (s) => {
    if (!s) return { label: t('board.noSite'), cls: 'is-wait' };
    if (s.state === 'failed') return { label: t('views.entity.failed'), cls: 'is-bad' };
    if (unpublished(s)) return { label: t('board.preview'), cls: 'is-ahead' };
    if (s.state === 'ready') return { label: t('board.live'), cls: 'is-live' };
    if (urlOf(s, 'preview')) return { label: t('board.preview'), cls: 'is-ahead' };
    return { label: t('views.entity.settingUp'), cls: 'is-wait' };
  };

  const primary = site ?? sites.find((s) => s.isPrimary) ?? sites[0] ?? null;
  const preview = primary ? urlOf(primary, 'preview') : null;
  const live = primary ? urlOf(primary, 'live') : null;

  const actions = site ? (
    <>
      {preview ? (
        <Button href={preview} target="_blank" rel="noreferrer">
          {t('board.preview')}
        </Button>
      ) : null}
      {live ? (
        <Button href={live} target="_blank" rel="noreferrer">
          {t('board.live')}
        </Button>
      ) : null}
      <Button kind="primary" onClick={() => onOpenProject(project.id)}>
        {t('views.entity.openProject')}
      </Button>
    </>
  ) : (
    <>
      <Button onClick={() => onNewRequest(project.id)}>{t('views.entity.newRequest')}</Button>
      <Button href={href(`requests?project=${project.id}&filter=open`)}>{t('views.entity.requests')}</Button>
      <Button kind="primary" onClick={() => onOpenProject(project.id)}>
        {t('views.entity.openProject')}
      </Button>
    </>
  );

  return (
    <Modal
      title={site ? site.name || project.name : project.name}
      subtitle={site ? project.name : project.kind === 'new' ? t('views.project.builtByUs') : t('views.project.yourCode')}
      onClose={onClose}
      actions={actions}
    >
      <div className="cp-sheet">
        {site ? (
          <>
            <div className="cp-sheet__rows">
              <div className="cp-sheet__row">
                <span>{t('views.entity.status')}</span>
                <span className="cp-sheet__state">
                  <i className={cx('cp-project__dot', stateOf(site).cls)} />
                  {stateOf(site).label}
                </span>
              </div>
              <div className="cp-sheet__row">
                <span>{t('views.entity.host')}</span>
                <b>{site.host === 'cloudflare' ? t('views.entity.hostCloudflare') : t('views.entity.hostOurs')}</b>
              </div>
              {preview ? (
                <div className="cp-sheet__row">
                  <span>{t('board.preview')}</span>
                  <a className="cp-sheet__url" href={preview} target="_blank" rel="noreferrer">
                    {preview.replace(/^https:\/\//, '')}
                  </a>
                </div>
              ) : null}
              {live ? (
                <div className="cp-sheet__row">
                  <span>{t('board.live')}</span>
                  <a className="cp-sheet__url" href={live} target="_blank" rel="noreferrer">
                    {live.replace(/^https:\/\//, '')}
                  </a>
                </div>
              ) : null}
              <div className="cp-sheet__row">
                <span>{t('views.entity.project')}</span>
                <b>{project.name}</b>
              </div>
            </div>
            <p className="cp-sheet__hint">{t('views.entity.siteHint')}</p>
          </>
        ) : (
          <>
            <div className="cp-sheet__stats">
              <div className="cp-sheet__stat">
                <span>{t('views.entity.sites')}</span>
                <b>{sites.length}</b>
              </div>
              <div className="cp-sheet__stat">
                <span>{t('views.entity.openRequests')}</span>
                <b>{open}</b>
              </div>
              <div className="cp-sheet__stat">
                <span>{t('views.entity.setup')}</span>
                <b>
                  {setup.ready}/{setup.total}
                </b>
              </div>
            </div>

            <div>
              <div className="cp-sheet__label">{t('views.entity.sites')}</div>
              {sites.length ? (
                <div className="cp-sheet__sites">
                  {sites.map((s) => {
                    const st = stateOf(s);
                    const address = urlOf(s, st.cls === 'is-live' ? 'live' : 'preview');
                    return (
                      <button key={s.id} type="button" className="cp-sheet__site" onClick={() => onOpenSite(s.id)}>
                        <i className={cx('cp-project__dot', st.cls)} />
                        <span className="cp-sheet__site-text">
                          <b>
                            {s.name || project.name}
                            {s.isPrimary ? ` · ${t('views.entity.primary')}` : ''}
                          </b>
                          <span>{address ? address.replace(/^https:\/\//, '') : t('views.entity.noAddress')}</span>
                        </span>
                        <span className="cp-sheet__state">{st.label}</span>
                        <span className="cp-sheet__chev">›</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="cp-sheet__hint">{t('views.entity.noSiteHint')}</p>
              )}
            </div>

            <div className="cp-sheet__rows">
              <div className="cp-sheet__row">
                <span>{t('views.entity.code')}</span>
                <b>{project.repo ?? (project.kind === 'new' ? t('views.project.builtByUs') : t('views.project.yourCode'))}</b>
              </div>
              <div className="cp-sheet__row">
                <span>{t('views.entity.requests')}</span>
                <b>{t('views.project.counts', { open, total: own.length })}</b>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
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
  // A project opened through its sheet morphs the sheet into this head.
  const fromSheet = boardReturn.sheet !== null && String(boardReturn.sheet) === String(id);
  if (fromSheet) boardReturn.sheet = null;
  if (!project) return <p className="cp-empty">{t('views.project.notOnAccount')}</p>;
  const tickets = data.tickets.filter((x) => x.project_id === project.id);
  const known = project.setup.checks.filter((c) => c.state !== 'unknown');
  return (
    <div className="cp-view">
      <nav className="cp-crumbs">
        <a href={href('')}>{t('nav.overview')}</a>
        <span>{project.name}</span>
      </nav>
      <PageHead title={project.name} sub={project.kind === 'new' ? t('views.project.builtSub') : t('views.project.codeSub')} style={fromSheet ? { viewTransitionName: 'cp-project' } : undefined}>
        <Button kind="primary" onClick={() => compose(project.id)}>
          <Icon name="plus" size={15} /> {t('nav.newRequest')}
        </Button>
      </PageHead>

      <div className="cp-projectgrid">
        <SitesCard project={project} />
        <RepoCard project={project} />
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

/** Where the code lives, with the action that was missing: create it in the client's GitHub. */
function RepoCard({ project }) {
  const t = useT();
  const { reload, notify } = usePortal();
  const [state, setState] = useState(null);
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api(`/portal/projects/${project.id}/repo`).then(setState, () => setState(null));
  useEffect(() => {
    load();
  }, [project.id]);
  const act = async (body) => {
    setBusy(true);
    try {
      await api(`/portal/projects/${project.id}/repo`, { body });
      await load();
      await reload();
      notify(t('views.repo.connected'));
    } catch (error) {
      notify(errorText(error, t), 'error');
    } finally {
      setBusy(false);
    }
  };
  if (!state) return null;
  const github = state.installations?.[0];
  return (
    <section className="cp-card cp-repo">
      <h2 className="cp-h2">{t('views.repo.title')}</h2>
      {state.repo ? (
        <p className="cp-muted">
          {state.installation ? t('views.repo.mine', { account: state.installation.account_login }) : t('views.repo.ours')}{' '}
          <a href={state.repo} target="_blank" rel="noreferrer">
            {state.repo.replace(/^https:\/\/github\.com\//, '')}
          </a>
        </p>
      ) : state.repoWanted ? (
        <p className="cp-muted">{t('views.repo.wanted')}</p>
      ) : (
        <p className="cp-error">{t('views.repo.missing')}</p>
      )}
      {state.error ? (
        <p className="cp-error">
          {/permissions requested are not granted/i.test(state.error)
            ? t('views.repo.githubPermission')
            : t('views.repo.githubError', { message: state.error.replace(/^github:\s*/, '') })}
        </p>
      ) : null}
      {!state.repo || state.error ? (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {github ? (
            <Button size="sm" kind="primary" disabled={busy} onClick={() => act({ create: 'github', installationId: github.id })}>
              {t('views.repo.createGithub', { account: github.account_login })}
            </Button>
          ) : null}
          <Button size="sm" disabled={busy} onClick={() => act({ create: 'ours' })}>
            {t('views.repo.createOurs')}
          </Button>
        </div>
      ) : null}
      <details style={{ marginTop: '0.75rem' }}>
        <summary className="cp-linkbtn">{t('views.repo.useExisting')}</summary>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <input type="text" placeholder="https://github.com/you/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
          <Button size="sm" disabled={busy || !repo.trim()} onClick={() => act({ repo })}>
            {t('views.repo.use')}
          </Button>
        </div>
        <p className="cp-hint">{t('views.repo.hint')}</p>
      </details>
    </section>
  );
}

/** The project's sites: add one, open its channels, publish a preview. */
function SitesCard({ project }) {
  const t = useT();
  const { reload, notify } = usePortal();
  const sites = project.sites ?? (project.site ? [project.site] : []);
  const [adding, setAdding] = useState(false);
  return (
    <section className="cp-card cp-site">
      <header className="cp-card__head cp-card__head--tight">
        <h2 className="cp-h2">{t('views.sites.title')}</h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> {t('views.sites.add')}
        </Button>
      </header>
      {sites.length ? (
        <ul className="cp-sites">
          {sites.map((site) => (
            <SiteItem key={site.id} project={project} site={site} />
          ))}
        </ul>
      ) : (
        <div className="cp-empty">
          <p>{t('views.sites.none')}</p>
          <Button kind="primary" onClick={() => setAdding(true)}>
            {t('views.sites.add')}
          </Button>
        </div>
      )}
      {adding ? (
        <AddSiteModal
          project={project}
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            notify(t('views.sites.created'));
            await reload();
          }}
        />
      ) : null}
    </section>
  );
}

/** One address under a project: its channels, its preview, its versions. */
function SiteItem({ project, site }) {
  const t = useT();
  const { data, reload, ask, notify } = usePortal();
  const [deploys, setDeploys] = useState(null);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const ready = site.state === 'ready';
  useEffect(() => {
    if (!ready || !open) return;
    api(`/portal/projects/${project.id}/site/deploys?siteId=${encodeURIComponent(site.id)}`)
      .then(({ deploys }) => setDeploys(deploys))
      .catch(() => setDeploys([]));
  }, [project.id, site.id, ready, open, site.previewDeploy, site.productionDeploy]);
  const ahead = unpublished(site);
  const publish = () =>
    ask({
      title: t('views.site.publishTitle', { name: site.name || project.name }),
      text: t('views.site.publishText', { preview: site.previewUrl, live: site.productionUrl }),
      confirm: t('views.site.publish'),
      run: async () => {
        const out = await api(`/portal/projects/${project.id}/site/publish`, {
          method: 'POST',
          body: { siteId: site.id },
        });
        if (out?.cloudflareError) {
          notify(t('views.site.cloudflareError', { message: out.cloudflareError }), 'error');
        } else {
          notify(t('views.site.publishedNotice'));
        }
        await reload();
      },
    });
  const remove = () =>
    ask({
      title: t('views.sites.deleteTitle', { name: site.name || project.name }),
      text: t('views.sites.deleteText'),
      confirm: t('views.sites.deleteConfirm'),
      danger: true,
      run: async () => {
        await api(`/portal/projects/${project.id}/site`, { method: 'DELETE', body: { siteId: site.id } });
        notify(t('views.sites.deleted'));
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
        await api(`/portal/projects/${project.id}/site/rollback`, {
          body: { deployId: d.id, siteId: site.id },
        });
        notify(t('views.site.rolledBack'));
        await reload();
      },
    });
  return (
    <li className="cp-site-item">
      <div className="cp-site-item__head">
        <strong>{site.name || project.name}</strong>
        {site.isPrimary ? <span className="cp-tag">{t('views.sites.main')}</span> : null}
        <span className="cp-muted cp-site-item__slug">{site.slug}</span>
        <span
          className={cx(
            'cp-sitestate',
            site.state === 'failed' ? 'is-bad' : ahead ? 'is-ahead' : site.state === 'ready' ? 'is-live' : 'is-wait',
          )}
        >
          {site.state === 'failed'
            ? t('views.site.setupStopped')
            : site.state !== 'ready'
              ? t('views.site.being')
              : ahead
                ? t('views.site.ahead')
                : t('views.site.liveUpToDate')}
        </span>
      </div>

      {site.state === 'failed' ? (
        <p className="cp-error">{site.error || t('views.site.setupFailed')}</p>
      ) : site.state !== 'ready' ? (
        <p className="cp-making" role="status">
          <span className="cp-spinner" /> {t('views.site.making')}
        </p>
      ) : (
        <>
          <p className="cp-hint">
            {site.host === 'cloudflare'
              ? site.cloudflare?.error
                ? t('views.site.cloudflareFallingBack')
                : t('views.site.cloudflareHost')
              : t('views.site.oursHost')}
          </p>
          {site.cloudflare?.error ? (
            <p className="cp-error">{t('views.site.cloudflareError', { message: site.cloudflare.error })}</p>
          ) : null}
          <div className="cp-channels">
            <a className="cp-channel" href={site.feedbackUrl || site.previewUrl} target="_blank" rel="noopener">
              <span className="cp-label">{t('views.site.channelPreview')}</span>
              <strong>{site.previewUrl.replace(/^https:\/\//, '')}</strong>
              <span className="cp-muted">{t('views.site.previewHint')}</span>
              <Icon name="ext" size={14} />
            </a>
            <a className="cp-channel" href={site.customDomain || site.productionUrl} target="_blank" rel="noopener">
              <span className="cp-label">{t('views.site.channelLive')}</span>
              <strong>{(site.customDomain || site.productionUrl).replace(/^https:\/\//, '')}</strong>
              <span className="cp-muted">{t('views.site.liveHint')}</span>
              <Icon name="globe" size={14} />
            </a>
          </div>
          <div className="cp-site-item__actions">
            {ahead ? (
              data.canPublish ? (
                <Button kind="primary" onClick={publish}>
                  {t('views.site.publishPreview')}
                </Button>
              ) : (
                <p className="cp-hint">{t('views.site.aheadHint')}</p>
              )
            ) : null}
            <button type="button" className="cp-linkbtn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {t('views.sites.versions')}
            </button>
            <button type="button" className="cp-linkbtn" onClick={() => setMoving(true)}>
              {t('views.sites.move')}
            </button>
            <button type="button" className="cp-linkbtn cp-linkbtn--danger" onClick={remove}>
              {t('views.sites.delete')}
            </button>
            <HostSwitch project={project} site={site} />
          </div>
          {open ? (
            deploys?.length ? (
              <ol className="cp-versions">
                {deploys.slice(0, 8).map((d) => {
                  const isLive = d.id === site.productionDeploy;
                  const isPreview = d.id === site.previewDeploy;
                  return (
                    <li key={d.id}>
                      <span className={cx('cp-versions__dot', isLive && 'is-live', isPreview && !isLive && 'is-preview')} />
                      <span>
                        {d.ticket_id ? (
                          <a href={href(`ticket/${d.ticket_id}`)}>{t('views.site.requestLink', { id: d.ticket_id })}</a>
                        ) : (
                          t('views.site.siteVersion')
                        )}
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
            ) : (
              <p className="cp-hint">{t('common.loading')}</p>
            )
          ) : null}
        </>
      )}
      {moving ? (
        <MoveSiteModal
          site={site}
          fromProject={project}
          projects={data.projects}
          onClose={() => setMoving(false)}
          onDone={async () => {
            setMoving(false);
            notify(t('views.sites.moved'));
            await reload();
          }}
        />
      ) : null}
    </li>
  );
}

/** Move a site to another of the client's projects. */
function MoveSiteModal({ site, fromProject, projects, onClose, onDone }) {
  const t = useT();
  const options = (projects ?? []).filter((p) => p.id !== fromProject.id);
  const [projectId, setProjectId] = useState(options[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!projectId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/portal/sites/${site.id}`, { method: 'PATCH', body: { projectId } });
      await onDone();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('views.sites.moveTitle', { name: site.name || site.slug })}
      subtitle={t('views.sites.moveSubtitle')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button kind="primary" disabled={busy || !projectId} onClick={() => void save()}>
            {t('views.sites.moveConfirm')}
          </Button>
        </>
      }
    >
      {options.length ? (
        <div className="cp-site-form">
          <label className="cp-label" htmlFor="move-site-project">
            {t('views.sites.moveTo')}
          </label>
          <select id="move-site-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="cp-hint">{t('views.sites.moveHint')}</p>
        </div>
      ) : (
        <p className="cp-hint">{t('views.sites.moveNone')}</p>
      )}
    </Modal>
  );
}

/** Add another site under a project: name, address, host. */
function AddSiteModal({ project, onClose, onDone }) {
  const t = useT();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [host, setHost] = useState('ours');
  const [cloudflare, setCloudflare] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/portal/cloudflare').then(setCloudflare, () => setCloudflare({ connections: [] }));
  }, []);
  const connections = (cloudflare?.connections ?? []).filter((c) => !c.lapsed);
  const account = connections[0]?.accounts?.[0] ?? null;
  const count = project.sites?.length ?? (project.site ? 1 : 0);
  const defaultSlug = `${project.slug}${count > 0 ? `-${count + 1}` : ''}`;
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/portal/projects/${project.id}/site`, {
        method: 'POST',
        body: {
          name: name || undefined,
          siteSlug: slug || defaultSlug,
          host,
          connectionId: host === 'cloudflare' ? connections[0]?.id : undefined,
          accountId: host === 'cloudflare' ? account?.id : undefined,
        },
      });
      await onDone();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('views.sites.addTitle', { name: project.name })}
      subtitle={t('views.sites.addLede')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('views.startSite.notNow')}</Button>
          <Button kind="primary" disabled={busy} onClick={() => void go()}>
            {t('views.sites.add')}
          </Button>
        </>
      }
    >
      <div className="cp-site-form">
        <label className="cp-label" htmlFor="site-name">
          {t('views.sites.name')}
        </label>
        <input
          id="site-name"
          type="text"
          maxLength={80}
          placeholder={t('views.sites.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="cp-label" htmlFor="site-slug">
          {t('start.field.address.label')}
        </label>
        <div className="cp-address">
          <span>https://</span>
          <input
            id="site-slug"
            type="text"
            maxLength={63}
            placeholder={defaultSlug}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          />
          <span>.malipetek.online</span>
        </div>
        <span className="cp-label">{t('views.sites.host')}</span>
        <label className="choice-option">
          <input type="radio" name="site-host" checked={host === 'ours'} onChange={() => setHost('ours')} />
          <span className="choice-option__body">
            <strong>{t('start.host.ours.label')}</strong>
            <em>{t('start.host.ours.note', { address: `${slug || defaultSlug}.malipetek.online` })}</em>
          </span>
        </label>
        <label className="choice-option">
          <input
            type="radio"
            name="site-host"
            checked={host === 'cloudflare'}
            disabled={!connections.length}
            onChange={() => setHost('cloudflare')}
          />
          <span className="choice-option__body">
            <strong>{t('start.host.cloudflare.label')}</strong>
            <em>
              {connections.length
                ? t('start.host.cloudflare.note', { account: account?.name ?? t('views.cloudflare.yourAccount') })
                : t('start.host.cloudflare.missing')}
            </em>
            {!connections.length ? (
              <a href={href('connections')} className="cp-linkbtn">
                {t('views.site.connectCloudflare')}
              </a>
            ) : null}
          </span>
        </label>
      </div>
    </Modal>
  );
}

/**
 * Moving one site between our hosting and the client's Cloudflare account.
 * The deploy history does not change; the server mirrors the current preview
 * and production into their account.
 */
function HostSwitch({ project, site }) {
  const t = useT();
  const { reload, notify } = usePortal();
  const [cloudflare, setCloudflare] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/portal/cloudflare').then(setCloudflare, () => setCloudflare({ connections: [] }));
  }, []);
  const connections = (cloudflare?.connections ?? []).filter((c) => !c.lapsed);
  const canDeploy = connections.some((c) => (c.scopes ?? []).includes('workers-scripts.admin'));
  const move = async (host) => {
    setBusy(true);
    try {
      await api(`/portal/projects/${project.id}/site/host`, {
        method: 'POST',
        body: host === 'cloudflare' ? { host, siteId: site.id, connectionId: connections[0]?.id } : { host: 'ours', siteId: site.id },
      });
      notify(t('views.site.moved'));
      await reload();
    } catch (error) {
      notify(errorText(error, t), 'error');
    } finally {
      setBusy(false);
    }
  };
  if (site.host === 'cloudflare') {
    return (
      <>
        {site.cloudflare?.error && connections.length ? (
          canDeploy ? (
            <button type="button" className="cp-linkbtn" disabled={busy} onClick={() => move('cloudflare')}>
              {t('views.site.retryCloudflare', { account: connections[0]?.accounts?.map((a) => a.name).join(', ') || '' })}
            </button>
          ) : (
            <a className="cp-linkbtn" href={href('connections')}>
              {t('views.site.grantCloudflare')}
            </a>
          )
        ) : null}
        <button type="button" className="cp-linkbtn" disabled={busy} onClick={() => move('ours')}>
          {t('views.site.moveToOurs')}
        </button>
      </>
    );
  }
  return connections.length ? (
    <button type="button" className="cp-linkbtn" disabled={busy} onClick={() => move('cloudflare')}>
      {t('views.site.moveToCloudflare')}
    </button>
  ) : (
    <a className="cp-linkbtn" href={href('connections')}>
      {t('views.site.connectCloudflare')}
    </a>
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
  const { ask, data, reload, notify } = usePortal();
  const [state, setState] = useState(null);
  const load = () => api('/portal/github').then(setState, () => setState({ installations: [], installUrl: null }));
  useEffect(() => void load(), []);
  const first = state?.installations?.[0];
  const withoutRepo = (data.projects ?? []).filter((p) => !p.repo);
  const create = async (project, mode = 'github') => {
    try {
      await api(`/portal/projects/${project.id}/repo`, {
        body: mode === 'github' ? { create: 'github', installationId: first?.id } : { create: 'ours' },
      });
      await load();
      await reload();
    } catch (error) {
      // The connection card is the place to say it: GitHub's own words are
      // more useful than a generic failure.
      await load();
      notify(errorText(error, t), 'error');
    }
  };
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
          <p>{t('views.github.waitingOnConnection', { count: (state?.unconnected ?? []).length })}</p>
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
      {/* Connected, but a site has no repository yet: the action lives here too. */}
      {first && withoutRepo.length ? (
        <div className="cp-notice" role="status">
          <p>{t('views.github.noRepo', { account: first.account_login, count: withoutRepo.length })}</p>
          <ul className="cp-keys">
            {withoutRepo.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                {p.repoError ? <span className="cp-warn">{p.repoError.replace(/^github:\s*/, '')}</span> : null}
                <Button size="sm" onClick={() => void create(p)}>
                  {t('views.github.createRepo')}
                </Button>
                <Button size="sm" kind="ghost" onClick={() => void create(p, 'ours')}>
                  {t('views.repo.createOurs')}
                </Button>
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
            <span className={c.lapsed ? 'cp-warn' : 'cp-muted'}>
              {c.lapsed ? t('views.cloudflare.expired') : t('views.connections.connectedAgo', { when: ago(c.createdAt) })}
            </span>
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
                // A first preview is on Ali: it shows as free, with no meter and no budget.
                const p = billOf({
                  humanSeconds: ticket.human_seconds,
                  aiMicroUsd: ticket.ai_micro_usd,
                  firstPreview: Boolean(ticket.first_preview),
                });
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
                    <td className="is-num">{ticket.first_preview || ticket.budget_cents === null ? '—' : money(ticket.budget_cents)}</td>
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
