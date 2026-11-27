/* Project destination shared by the web workbench and the native host. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './store.js';
import { Button, DataTable, Empty, ErrorNote, Field, Icon, Modal, OverflowMenu, PageHeader, PageTabs, Segmented, Skeleton, StatusPill, Tag } from './ui/index.js';
import { RepoModal, ProjectEditModal } from './fleet.jsx';
import { LOCALES } from '../../../src/lib/locales.js';
import { ProjectSolutions, SolutionTags } from './project-solutions.jsx';
import { SitePanel } from './ticket.jsx';
import { AskSuperagentButton } from './superagent-ask.jsx';
import { ago } from './format.js';
import { briefPayload, createProjectResource, projectTickets, projectWork, projectTopology, repoRef, resourceUrl, singleFlight } from './project-model.js';
import { operatorTicketCounts, stationsFor, unshippedPreview } from './project-world-model.mjs';
import { PipelineStrip, ProjectMap } from './project-world.jsx';
import projectStyles from './project-styles.js';
import { InjectedStyles } from './ui/injected-styles.js';

const errorText = error => error?.message || String(error || 'Request failed');
const pathFor = project => `/admin/projects/${encodeURIComponent(project.id)}`;

/* Three tabs. Old stored tab keys (Solutions, Resources, People, Activity & review) still resolve. */
const TABS = ['Overview', 'Work', 'Setup'];
const TAB_ALIASES = { Solutions: 'Setup', Resources: 'Setup', People: 'Setup', 'Activity & review': 'Work' };
const TABS_KEY = 'aw-project-tab-v1';
const MAP_KEY = 'aw-project-map';
const normalizeTab = value => TABS.includes(value) ? value : (TAB_ALIASES[value] ?? 'Overview');
const readTabs = () => { try { return JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}') ?? {}; } catch { return {}; } };
const storedTab = id => normalizeTab(readTabs()[String(id)]);
const writeTab = (id, tab) => { try { const all = readTabs(); all[String(id)] = tab; localStorage.setItem(TABS_KEY, JSON.stringify(all)); } catch { /* storage unavailable here */ } };
const readMapOpen = () => { try { return localStorage.getItem(MAP_KEY) === '1'; } catch { return false; } };
const writeMapOpen = open => { try { localStorage.setItem(MAP_KEY, open ? '1' : '0'); } catch { /* storage unavailable here */ } };

function useProjectResource(load) {
  const [state, setState] = useState({ load: null, value: null, loading: true, error: null });
  const resource = useRef(null);
  useEffect(() => {
    const current = createProjectResource(load, next => setState({ ...next, load }));
    resource.current = current;
    void current.refresh();
    return () => current.dispose();
  }, [load]);
  const refresh = useCallback(() => resource.current?.refresh(), []);
  return [state.load === load ? state : { value: null, loading: true, error: null }, refresh];
}

/** All writes use the same synchronous guard for form and pointer submission. */
function useWrite() {
  const [state, setState] = useState({ busy: false, error: null, success: null });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useMemo(() => singleFlight(async (operation, success) => {
    if (alive.current) setState({ busy: true, error: null, success: null });
    try {
      const result = await operation();
      if (alive.current) setState({ busy: false, error: null, success: success || null });
      return result;
    } catch (error) {
      if (alive.current) setState({ busy: false, error, success: null });
      return undefined;
    }
  }), []);
  return [state, run];
}

function Feedback({ state }) {
  return (
    <>
      {state.error ? <p className="aw-project__error" role="alert">{errorText(state.error)}</p> : null}
      {state.success ? <p className="aw-project__success" role="status">{state.success}</p> : null}
    </>
  );
}

function ResourceState({ state, refresh, rows = 3, children }) {
  if (state.loading) return <Skeleton variant="rows" rows={rows} />;
  return (
    <>
      {state.error ? (
        <div className="aw-project__error-bar" role="alert">
          <span>{state.value ? 'Showing the last successful response. ' : ''}{errorText(state.error)}</span>
          <Button size="sm" disabled={state.refreshing} onClick={refresh}>Retry</Button>
        </div>
      ) : null}
      {children}
    </>
  );
}

export function ProjectView({ id, initialTab = 'Overview' }) {
  const { api, data, host, setModal, reload } = useAdmin();
  const load = useCallback(async () => {
    const result = await api('GET', '/admin/projects');
    return { project: (result.projects ?? []).find(project => project.id === id) ?? null };
  }, [api, id]);
  const [remote, refresh] = useProjectResource(load);
  const lastInventory = useRef(data.projects);
  useEffect(() => {
    if (lastInventory.current !== data.projects) { lastInventory.current = data.projects; void refresh(); }
  }, [data.projects, refresh]);
  // A caller's tab wins; otherwise the last tab this project was left on (old keys mapped).
  const resolveTab = useCallback(() => initialTab && initialTab !== 'Overview' ? normalizeTab(initialTab) : storedTab(id), [id, initialTab]);
  const [tab, setTab] = useState(resolveTab);
  const [pendingAnchor, setPendingAnchor] = useState(null);
  useEffect(() => { setTab(resolveTab()); }, [id, resolveTab]);
  const switchTab = useCallback((next, anchor = null) => {
    setTab(next);
    writeTab(id, next);
    setPendingAnchor(anchor);
  }, [id]);

  useEffect(() => {
    if (!pendingAnchor || typeof document === 'undefined') return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(pendingAnchor)?.scrollIntoView({ block: 'start', behavior: 'auto' });
      setPendingAnchor(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, pendingAnchor]);

  // Inventory supplies immediate context; an authoritative missing result never falls back.
  const project = remote.value ? remote.value.project : (data.projects ?? []).find(project => project.id === id);
  const refreshAll = useCallback(async () => { await refresh(); await reload?.(); }, [refresh, reload]);

  if (!project) {
    return (
      <div className="aw-view aw-project">
        <InjectedStyles id="aw-project-styles" css={projectStyles} />
        <ResourceState state={remote} refresh={refresh}>
          {!remote.loading ? (
            <Empty
              title="Project unavailable"
              hint="This project no longer exists or is not available to your account. Refresh the project list or choose another project."
              action={<Button onClick={refreshAll}>Refresh projects</Button>}
            />
          ) : null}
        </ResourceState>
      </div>
    );
  }

  const primarySite = (Array.isArray(project.sites) && project.sites.length ? project.sites : project.site ? [project.site] : [])
    .find(s => s?.isPrimary) ?? project.sites?.[0] ?? project.site ?? null;
  const liveHref = resourceUrl(primarySite?.customDomain || primarySite?.productionUrl || primarySite?.url);
  const repoHref = resourceUrl(project.repo);

  const overflowItems = [
    {
      label: 'Edit project',
      run: () => setModal({
        kind: 'custom',
        render: close => <ProjectEditModal project={project} onClose={() => { close(); void refreshAll(); }} />,
      }),
    },
    liveHref ? { label: 'Open live site', href: liveHref } : null,
    repoHref ? { label: 'Open repository', href: repoHref } : null,
    { label: 'Refresh project', run: () => void refreshAll() },
  ];

  return (
    <div className="aw-view aw-project" key={id}>
      <InjectedStyles id="aw-project-styles" css={projectStyles} />
      <PageHeader
        title={project.name}
        subtitle={
          <>
            {project.solutions?.length ? <SolutionTags solutions={project.solutions} catalog={data.catalog?.solutions} /> : 'Website'}
            {' · '}
            {project.githubAccount ? 'GitHub connected' : 'GitHub not connected'}
            {' · '}
            {project.slug}
          </>
        }
        actions={
          <>
            <Button kind="primary" onClick={() => setModal({ kind: 'task', projectId: id })}>
              <Icon name="plus" /> Add work
            </Button>
            <AskSuperagentButton
              scope={`p:${project.id}`}
              label={project.name}
              ask="What is the state of this project, and what does it need next?"
              title="Start a conversation that can read this project, its work and its site"
            />
            <OverflowMenu items={overflowItems} label="Project actions" />
          </>
        }
      />
      {remote.error ? (
        <div role="alert" className="aw-project__error-bar">
          <span>Project refresh failed. {errorText(remote.error)}</span>
          <Button size="sm" onClick={refresh}>Retry</Button>
        </div>
      ) : null}
      <PageTabs ariaLabel="Project sections" value={tab} onChange={next => switchTab(next)} items={TABS.map(label => ({ value: label, label }))} />
      <div className="aw-project__body" key={`${id}:${tab}`}>
        {tab === 'Overview' ? <Overview project={project} refresh={refreshAll} setTab={switchTab} /> : null}
        {tab === 'Work' ? <Work project={project} /> : null}
        {tab === 'Setup' ? <Setup project={project} refresh={refreshAll} host={host} /> : null}
      </div>
    </div>
  );
}

/** One honest line from the world model: live state, unshipped preview changes, setup checks. */
function healthSummary({ project, sites, tickets, deploys }) {
  const stations = stationsFor({ project, sites, tickets, deploys });
  const hosting = stations.find(station => station.key === 'hosting');
  const drift = unshippedPreview({ project, sites, deploys, tickets: tickets ?? [] });
  const counts = operatorTicketCounts(project, tickets, Date.now());
  const checks = Array.isArray(project?.setup?.checks) ? project.setup.checks.filter(check => check && check.state && check.state !== 'unknown') : [];
  const parts = [hosting?.meta?.addressText || hosting?.stateText || 'Site state unknown'];
  if (drift) parts.push(`preview has ${drift.count === 1 ? '1 unshipped change' : `${drift.count} unshipped changes`}`);
  if (counts.stalled) parts.push(`${counts.stalled} stalled ${counts.stalled === 1 ? 'build' : 'builds'}`);
  if (checks.length) parts.push(`${checks.filter(check => check.state === 'ready').length}/${checks.length} checks ok`);
  return parts.join(' · ');
}

function Overview({ project, refresh, setTab }) {
  const { data, api, setModal } = useAdmin();
  const work = projectWork(data.tickets, project.id);
  // The map counts system work too (content, SEO, guide cycles); the lists never do.
  const mapTickets = useMemo(() => projectTickets(data.tickets, project.id, { includeSystem: true }), [data.tickets, project.id]);
  const sites = useMemo(
    () => (Array.isArray(project.sites) && project.sites.length ? project.sites : project.site ? [project.site] : []),
    [project.sites, project.site],
  );
  // The ready site's deploy history lets the map place preview vs live and list unshipped changes.
  const deploySiteId = sites.find(site => site?.state === 'ready' && site?.id)?.id ?? null;
  const loadDeploys = useCallback(
    () => (deploySiteId ? api('GET', `${pathFor(project)}/site/deploys?siteId=${encodeURIComponent(deploySiteId)}`) : Promise.resolve(null)),
    [api, project.id, deploySiteId],
  );
  const [deployState, refreshDeploys] = useProjectResource(loadDeploys);
  const deploys = Array.isArray(deployState.value?.deploys) ? deployState.value.deploys : null;
  const [mapOpen, setMapOpen] = useState(readMapOpen);
  const [focusStation, setFocusStation] = useState('hosting');
  const toggleMap = () => setMapOpen(open => { writeMapOpen(!open); return !open; });
  const openMapAt = useCallback((stationKey) => {
    setFocusStation(stationKey);
    writeMapOpen(true);
    setMapOpen(true);
  }, []);
  const health = useMemo(() => healthSummary({ project, sites, tickets: mapTickets, deploys }), [project, sites, mapTickets, deploys]);

  const handleMapAction = useCallback((action) => {
    if (action === 'work') setTab('Work');
    else if (action === 'activity') setTab('Work', 'project-activity');
    else if (action === 'add_work') setModal({ kind: 'task', projectId: project.id });
    else if (action === 'repo') setTab('Setup', 'project-repo');
    else if (action === 'link_repo') {
      setModal({
        kind: 'custom',
        render: close => <RepoModal project={project} onClose={() => { close(); void refresh(); }} />,
      });
    } else if (action === 'hosting') setTab('Setup', 'project-hosting');
  }, [project, refresh, setModal, setTab]);

  // Review rows first (they wait on a decision), then new ones, each newest first.
  const needs = work
    .filter(ticket => ['new', 'review'].includes(ticket.status))
    .sort((a, b) => (a.status === 'review' ? 0 : 1) - (b.status === 'review' ? 0 : 1) || (b.updated_at ?? 0) - (a.updated_at ?? 0));

  return (
    <>
      <section className="aw-project__section" aria-label="Needs attention">
        <div className="aw-row-h">
          <h3>Needs attention</h3>
          <span className="aw-toolbar__fill" />
          <Button size="sm" kind="ghost" onClick={() => setTab('Work')}>All work →</Button>
        </div>
        {needs.length ? (
          <WorkList tickets={needs.slice(0, 5)} />
        ) : (
          <Empty
            title="Nothing needs you"
            hint="Every open request is moving. New and review requests appear here."
            action={<Button size="sm" onClick={() => setModal({ kind: 'task', projectId: project.id })}>Add work</Button>}
          />
        )}
      </section>
      <section className="aw-project__section" aria-label="Project health">
        <div className="aw-row-h">
          <p className="aw-project__health">{health}</p>
          <span className="aw-toolbar__fill" />
          <Button size="sm" className="aw-world__toggle" aria-expanded={mapOpen} onClick={toggleMap}>{mapOpen ? 'Hide map' : 'Show map'}</Button>
        </div>
        {deploySiteId && deployState.error ? <ErrorNote error={deployState.error} onRetry={refreshDeploys} /> : null}
        {mapOpen ? (
          <div className="aw-project__world">
            <ProjectMap
              project={project}
              sites={sites}
              tickets={mapTickets}
              deploys={deploys}
              initialStation={focusStation}
              onAction={handleMapAction}
            />
          </div>
        ) : (
          <PipelineStrip
            project={project}
            sites={sites}
            tickets={mapTickets}
            deploys={deploys}
            onSelectStation={openMapAt}
          />
        )}
      </section>
      <section className="aw-project__section"><Brief project={project} refresh={refresh} setTab={setTab} /></section>
    </>
  );
}

function Brief({ project, refresh, setTab }) {
  const { api } = useAdmin();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.brief ?? { what: '', goal: '' });
  const [saved, setSaved] = useState(project.brief);
  const [state, write] = useWrite();
  useEffect(() => { setSaved(project.brief); if (!editing) setDraft(project.brief ?? { what: '', goal: '' }); }, [project.brief]);
  const payload = briefPayload(draft, project.kind);
  const save = event => {
    event.preventDefault();
    if (!payload) return;
    void write(async () => {
      const result = await api('PATCH', pathFor(project), { brief: payload });
      setSaved(result.project?.brief ?? payload);
      setEditing(false);
      // Persistence succeeded even if a later inventory refresh fails.
      void refresh();
    }, 'Brief saved.');
  };
  const notWritten = <span className="aw-muted">Not written yet</span>;
  const saveDisabledReason = state.busy
    ? 'Saving brief…'
    : !payload
      ? 'Fill in both "What it is" and "What done looks like" to save.'
      : undefined;

  return (
    <>
      <div className="aw-row-h">
        <h3>Project brief</h3>
        <span className="aw-toolbar__fill" />
        {!editing && !project.solutions?.length ? <Button size="sm" onClick={() => setTab('Setup')}>Add kind of work</Button> : null}
        {!editing ? <Button size="sm" onClick={() => { setDraft(saved ?? { what: '', goal: '' }); setEditing(true); }}>Edit</Button> : null}
      </div>
      {editing ? (
        <form onSubmit={save} className="aw-project__form">
          <Field label="What it is"><textarea aria-label="What it is" required rows={3} maxLength={1200} value={draft.what ?? ''} onChange={event => setDraft({ ...draft, what: event.target.value })} /></Field>
          <Field label="What done looks like"><textarea aria-label="What done looks like" required rows={3} maxLength={1200} value={draft.goal ?? ''} onChange={event => setDraft({ ...draft, goal: event.target.value })} /></Field>
          {project.kind === 'new'
            ? <Field label="Done by hand today" hint="Optional"><textarea rows={2} maxLength={1200} value={draft.manual ?? ''} onChange={event => setDraft({ ...draft, manual: event.target.value })} /></Field>
            : <Field label="Where the code lives" hint="Context only; connect the actual repository in Setup."><textarea rows={2} maxLength={1200} value={draft.where ?? ''} onChange={event => setDraft({ ...draft, where: event.target.value })} /></Field>}
          <div className="aw-project__actions">
            <Button disabled={state.busy} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" disabled={state.busy || !payload} title={saveDisabledReason}>
              {state.busy ? 'Saving…' : 'Save brief'}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="aw-project__brief">
          <dt>What it is</dt><dd>{saved?.what || notWritten}</dd>
          <dt>What done looks like</dt><dd>{saved?.goal || notWritten}</dd>
          {saved?.where ? <><dt>Code context</dt><dd>{saved.where}</dd></> : null}
          {saved?.manual ? <><dt>Done by hand today</dt><dd>{saved.manual}</dd></> : null}
        </dl>
      )}
      <Feedback state={state} />
    </>
  );
}

function Topology({ project, local, git }) {
  const topology = projectTopology(project, local, git);
  return (
    <ol className="aw-project__topology" aria-label="Development to deployment">
      <li>
        <Icon name="folder" />
        <div>
          <strong>Local checkout</strong>
          <span>{topology.local}</span>
        </div>
      </li>
      <li>
        <Icon name="branch" />
        <div>
          <strong>Repository & ref</strong>
          {topology.repoUrl
            ? <a href={topology.repoUrl} target="_blank" rel="noreferrer">{topology.repoUrl}</a>
            : <span>{project.repo ? 'Repository configured; open it with your Git client.' : 'No repository linked'}</span>}
          <span className="aw-mono">{topology.branch}</span>
          {git?.remotes?.length ? <span>Remotes: {git.remotes.map(remote => remote.name).join(', ')}</span> : null}
        </div>
      </li>
      <li>
        <Icon name="globe" />
        <div>
          <strong>Preview & production</strong>
          {topology.sites.length ? topology.sites.map(site => (
            <div className="aw-project__destination" key={site.id}>
              <span>{site.name || project.name} · {site.state || 'State unknown'}</span>
              <span>
                {site.previewUrl ? <a href={site.previewUrl} target="_blank" rel="noreferrer">Preview</a> : 'No preview address'}
                {' · '}
                {site.productionUrl ? <a href={site.productionUrl} target="_blank" rel="noreferrer">Production</a> : 'No production address'}
              </span>
              <span>{site.deployment}</span>
            </div>
          )) : <span>No hosted destinations yet</span>}
        </div>
      </li>
    </ol>
  );
}

/** Everything that makes the project work: kinds of work, owner, code, hosting, secrets. */
function Setup({ project, refresh, host }) {
  return (
    <>
      <section className="aw-project__section"><ProjectSolutions project={project} /></section>
      <People project={project} refresh={refresh} />
      <Code project={project} refresh={refresh} />
      <Hosting project={project} />
      <Resources project={project} refresh={refresh} host={host} />
      <Secrets project={project} />
    </>
  );
}

/**
 * The code: the repository the work happens in, reached through the project
 * owner's own GitHub — the GitHub App installation, never a pasted token or a
 * typed repo name (rule 3). The repo-URL editor stays, folded behind More.
 */
function Code({ project, refresh }) {
  const { api, setModal } = useAdmin();
  const [state, write] = useWrite();
  const repo = repoRef(project.repo);
  const href = resourceUrl(project.repo);
  const mutate = (operation, message) => void write(async () => { await operation(); void refresh(); }, message);
  return (
    <section className="aw-project__section" id="project-repo">
      <h3>Code</h3>
      {repo ? (
        <p>
          {href ? <a href={href} target="_blank" rel="noreferrer">{repo.host}/{repo.slug}</a> : `${repo.host}/${repo.slug}`}
          {project.githubAccount
            ? <span className="aw-muted"> · through @{project.githubAccount}’s GitHub</span>
            : repo.host === 'github.com' ? <span className="aw-muted"> · the owner has not connected GitHub yet, so fleet runs reach it with a node’s own Git access</span> : null}
        </p>
      ) : (
        <p className="aw-muted">
          {href
            ? <a href={href} target="_blank" rel="noreferrer">{href}</a>
            : project.repo
              ? 'Repository configured for Git access.'
              : 'No repository yet — the project owner connects GitHub on the portal’s Connections page, and the repository shows here.'}
        </p>
      )}
      {project.repo_error ? <p role="alert" className="aw-project__error">{project.repo_error}</p> : null}
      {project.repoStatus?.label ? <p className="aw-muted">{project.repoStatus.label}</p> : null}
      {!project.repo ? (
        <div className="aw-project__actions">
          <Button size="sm" disabled={state.busy} onClick={() => mutate(() => api('POST', `${pathFor(project)}/repo/create`, {}), 'Repository creation requested.')}>Create repository</Button>
          {project.githubInstallationId ? (
            <Button size="sm" disabled={state.busy} onClick={() => mutate(() => api('POST', `${pathFor(project)}/repo/github`, {}), 'GitHub repository creation requested.')}>
              Create in @{project.githubAccount || 'connected GitHub'}
            </Button>
          ) : null}
        </div>
      ) : null}
      <details>
        <summary>More</summary>
        <p className="aw-muted">Link an existing repository by its URL, or change the one above.</p>
        <div className="aw-project__actions">
          <Button size="sm" onClick={() => setModal({ kind: 'custom', render: close => <RepoModal project={project} onClose={() => { close(); void refresh(); }} /> })}>
            {project.repo ? 'Change repository' : 'Link repository'}
          </Button>
        </div>
      </details>
      <Feedback state={state} />
    </section>
  );
}

function Resources({ project, refresh, host }) {
  const { api, setModal } = useAdmin();
  const [state, write] = useWrite();
  const native = typeof host?.projectLocalInfo === 'function';
  const loadLocal = useCallback(async () => {
    if (!native) return null;
    const local = await host.projectLocalInfo({ projectId: project.id });
    let git = null, gitError = null;
    if (host.projectGitInfo && (local.found ?? local.exists)) {
      try { git = await host.projectGitInfo({ projectId: project.id }); } catch (error) { gitError = error; }
    }
    return { local, git, gitError };
  }, [host, native, project.id]);
  const [localState, refreshLocal] = useProjectResource(loadLocal);
  const topology = localState.value;
  const mutate = (operation, message) => void write(async () => { await operation(); void refresh(); }, message);
  return (
    <>
      <section className="aw-project__section">
        <h3>Development to deployment</h3>
        <Topology project={project} local={topology?.local} git={topology?.git} />
      </section>
      <section className="aw-project__section" id="project-local">
        <h3>Local checkout</h3>
        {native ? (
          <ResourceState state={localState} refresh={refreshLocal} rows={2}>
            {topology?.gitError ? (
              <div className="aw-project__error-bar" role="alert">
                <span>Git inspection failed: {errorText(topology.gitError)}</span>
                <Button size="sm" onClick={refreshLocal}>Retry</Button>
              </div>
            ) : null}
            <LocalDevelopment project={project} local={topology?.local} host={host} refresh={refreshLocal} />
          </ResourceState>
        ) : (
          <div className="aw-project__handoff">
            <p>This browser cannot access your local files. Open this project in PTech Admin to connect a checkout, edit files and continue a development conversation.</p>
            <p className="aw-muted">Repository links, work, recorded agent evidence and hosted deployments remain available here.</p>
            <div className="aw-project__actions">
              {resourceUrl(project.repo)
                ? <a className="aw-btn aw-btn--sm" href={resourceUrl(project.repo)} target="_blank" rel="noreferrer">Open repository ↗</a>
                : <Button size="sm" onClick={() => setModal({ kind: 'custom', render: close => <RepoModal project={project} onClose={() => { close(); void refresh(); }} /> })}>Link a repository</Button>}
            </div>
          </div>
        )}
      </section>
      <section className="aw-project__section" id="project-sites">
        <div className="aw-row-h">
          <h3>Hosted destinations</h3>
          <span className="aw-toolbar__fill" />
          <Button size="sm" disabled={state.busy} onClick={() => mutate(() => api('POST', `${pathFor(project)}/site`, {}), 'Hosting setup requested.')}>
            {project.sites?.length ? 'Add a site' : 'Set up hosting'}
          </Button>
        </div>
        <p className="aw-muted">Rebuild changes preview only. Publishing replaces the live site with preview; the publish action asks you to confirm the destination.</p>
        <SitePanel project={project} />
        {(project.sites ?? (project.site ? [project.site] : [])).map(site => (
          <DeployHistory key={site.id} project={project} site={site} refresh={refresh} />
        ))}
      </section>
    </>
  );
}

function LocalDevelopment({ project, local, host, refresh }) {
  const [path, setPath] = useState(local?.path ?? '');
  const [baseRef, setBaseRef] = useState(local?.baseRef ?? '');
  const [verify, setVerify] = useState(local?.verify ?? '');
  const [parentPath, setParentPath] = useState('');
  const [directoryName, setDirectoryName] = useState(project.slug);
  const [operationId, setOperationId] = useState(null);
  const [operation, setOperation] = useState(null);
  const [state, write] = useWrite();
  const [changing, setChanging] = useState(false);
  const found = local?.found ?? local?.exists;

  useEffect(() => {
    if (!operationId || !host.projectLocalOperation) return;
    let alive = true, timer;
    const poll = async () => {
      try {
        const next = await host.projectLocalOperation({ operationId });
        if (!alive) return;
        setOperation(next);
        if (next.status === 'running') timer = setTimeout(poll, 1200);
        else if (next.status === 'succeeded') void refresh();
      } catch (error) { if (alive) setOperation({ status: 'failed', error: errorText(error) }); }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [operationId, host, refresh]);

  const cloning = operationId && (!operation || operation.status === 'running');
  const configure = event => {
    event.preventDefault();
    if (!path.trim() || !host.projectConfigureLocal) return;
    void write(async () => {
      await host.projectConfigureLocal({ projectId: project.id, path: path.trim(), baseRef: baseRef.trim(), verify: verify.trim() });
      setChanging(false);
      void refresh();
    }, 'Local checkout connected.');
  };
  const clone = event => {
    event.preventDefault();
    if (!parentPath.trim() || cloning || !host.projectCloneLocal) return;
    void write(async () => {
      setOperation(null);
      const result = await host.projectCloneLocal({ projectId: project.id, parentPath: parentPath.trim(), directoryName: directoryName.trim() || undefined });
      setOperationId(result.operationId);
    });
  };

  // One block, one choice: point at a folder that already exists, or clone the repository.
  const connectExisting = Boolean(host.projectConfigureLocal);
  const connectClone = Boolean(project.repo && host.projectCloneLocal && host.projectLocalOperation);
  const [connectMode, setConnectMode] = useState('existing');
  useEffect(() => { if (connectMode === 'clone' && !connectClone) setConnectMode('existing'); }, [connectMode, connectClone]);

  return (
    <>
      {found && host.projectOpenLocal ? (
        <div className="aw-project__actions aw-project__local-actions">
          <Button disabled={state.busy} onClick={() => void write(() => host.projectOpenLocal({ projectId: project.id, mode: 'session' }), 'Development conversation opened.')}>Continue locally</Button>
          <Button kind="ghost" disabled={state.busy} onClick={() => void write(() => host.projectOpenLocal({ projectId: project.id, mode: 'reveal' }))}>Show folder</Button>
        </div>
      ) : null}
      {found && !changing ? (
        <Button size="sm" kind="ghost" onClick={() => setChanging(true)}>Change checkout</Button>
      ) : connectExisting || connectClone ? (
        <div className="aw-project__connect">
          <div className="aw-row-h">
            <h4>Connect a checkout</h4>
            <span className="aw-toolbar__fill" />
            <Segmented
              value={connectMode}
              onChange={setConnectMode}
              label="Connect a checkout"
              options={[
                { value: 'existing', label: 'Existing folder', disabled: !connectExisting, hint: !connectExisting ? 'Unavailable in this host' : undefined },
                { value: 'clone', label: 'Clone', disabled: !connectClone, hint: !project.repo ? 'Link a repository before cloning' : !connectClone ? 'Cloning unavailable in this host' : undefined },
              ]}
            />
          </div>
          {connectMode === 'existing' ? (
            <form onSubmit={configure} className="aw-project__form">
              <Field label="Local folder" hint="An existing folder on this device. Connecting does not clone or overwrite it.">
                <div className="aw-pick">
                  <input required value={path} onChange={event => setPath(event.target.value)} placeholder="/Users/you/Projects/site" />
                  {host.canPickDirectory ? (
                    <Button onClick={async () => {
                      try { const picked = await host.pickDirectory(); if (typeof picked === 'string' && picked) setPath(picked); } catch { /* cancelled or unavailable */ }
                    }}>Choose folder…</Button>
                  ) : null}
                </div>
              </Field>
              <div className="aw-project__fields">
                <Field label="Base ref" hint="Optional Git ref for review"><input value={baseRef} onChange={event => setBaseRef(event.target.value)} placeholder="main" /></Field>
                <Field label="Verification command" hint="Saved for deliberate local execution"><input value={verify} onChange={event => setVerify(event.target.value)} placeholder="npm test" /></Field>
              </div>
              <div className="aw-project__actions">
                <Button type="submit" disabled={state.busy || !path.trim() || Boolean(cloning)} title={!path.trim() ? 'Enter a local folder path first.' : undefined}>
                  {state.busy ? 'Connecting…' : 'Connect folder'}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={clone} className="aw-project__form">
              <p className="aw-muted">Creates a new folder; an existing destination is never overwritten. Private repositories use the project’s authorized Git connection.</p>
              <Field label="Parent folder">
                <div className="aw-pick">
                  <input required value={parentPath} onChange={event => setParentPath(event.target.value)} placeholder="/Users/you/Projects" />
                  {host.canPickDirectory ? (
                    <Button onClick={async () => {
                      try { const picked = await host.pickDirectory(); if (typeof picked === 'string' && picked) setParentPath(picked); } catch { /* cancelled or unavailable */ }
                    }}>Choose folder…</Button>
                  ) : null}
                </div>
              </Field>
              <Field label="New folder name"><input value={directoryName} onChange={event => setDirectoryName(event.target.value)} /></Field>
              <div className="aw-project__actions">
                <Button type="submit" disabled={state.busy || Boolean(cloning) || !parentPath.trim()} title={!parentPath.trim() ? 'Enter a parent folder path first.' : undefined}>
                  {cloning ? 'Cloning…' : 'Clone repository'}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
      {operation ? (
        <p className={operation.status === 'failed' ? 'aw-project__error' : 'aw-muted'} role={operation.status === 'failed' ? 'alert' : 'status'}>
          {operation.status === 'failed'
            ? `Clone failed: ${errorText(operation.error)}. Check the destination and Git connection, then retry.`
            : operation.status === 'succeeded'
              ? `Clone ready: ${operation.receipt?.path || 'checkout connected'}`
              : `Cloning: ${operation.phase || 'working'}`}
        </p>
      ) : null}
      <Feedback state={state} />
      {found && host.projectFiles ? <LocalFiles project={project} host={host} /> : null}
      {found && host.gitGraph ? <GitGraph project={project} host={host} /> : <p className="aw-muted">Git Graph is optional. Use your repository, local conversation or recorded work review without it.</p>}
    </>
  );
}

function LocalFiles({ project, host }) {
  const [path, setPath] = useState('');
  const [file, setFile] = useState(null);
  const readEpoch = useRef(0);
  useEffect(() => () => { readEpoch.current++; }, []);
  const navigate = nextPath => { readEpoch.current++; setPath(nextPath); setFile(null); };
  const load = useCallback(() => host.projectFiles({ projectId: project.id, action: 'list', path }), [host, project.id, path]);
  const [state, refresh] = useProjectResource(load);
  const [readState, write] = useWrite();
  return (
    <details>
      <summary>Browse checkout files</summary>
      <p className="aw-muted">Read-only file preview. Continue locally to edit with the project’s development conversation or your editor.</p>
      <div className="aw-project__actions">
        <Button size="sm" disabled={!path} title={!path ? 'Already at the checkout root.' : undefined} onClick={() => navigate(path.split('/').slice(0, -1).join('/'))}>Parent folder</Button>
        <code className="aw-mono">{path || '/'}</code>
        <Button size="sm" kind="ghost" onClick={refresh}>Refresh files</Button>
      </div>
      <ResourceState state={state} refresh={refresh} rows={3}>
        <ul className="aw-project__files">
          {(state.value?.entries ?? []).map(entry => (
            <li key={entry.path}>
              <button
                type="button"
                disabled={readState.busy}
                onClick={() => {
                  if (entry.type === 'directory') {
                    navigate(entry.path);
                  } else {
                    void write(async () => {
                      const epoch = ++readEpoch.current;
                      setFile(null);
                      const result = await host.projectFiles({ projectId: project.id, action: 'read', path: entry.path, range: { startLine: 1, endLine: 250 } });
                      if (readEpoch.current === epoch) setFile(result);
                    });
                  }
                }}
              >
                {entry.type === 'directory' ? <Icon name="folder" /> : <Icon name="file" />}
                {entry.name}{entry.type === 'directory' ? '/' : ''}
              </button>
            </li>
          ))}
        </ul>
        {!state.loading && !state.value?.entries?.length ? <p className="aw-muted">This folder is empty.</p> : null}
      </ResourceState>
      <Feedback state={readState} />
      {file ? (
        <div className="aw-project__file">
          <div className="aw-row-h">
            <strong className="aw-mono">{file.path}</strong>
            <span className="aw-toolbar__fill" />
            <Button size="sm" kind="ghost" onClick={() => { readEpoch.current++; setFile(null); }}>Close preview</Button>
          </div>
          <pre>{file.text}</pre>
          {file.truncated ? <p className="aw-muted">Showing lines {file.startLine}–{file.endLine}. Open locally to read the full file.</p> : null}
        </div>
      ) : null}
    </details>
  );
}

function GitGraph({ project, host }) {
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => ({ available: await host.gitGraph.available() }), [host]);
  const [state, refresh] = useProjectResource(load);
  const graph = host.gitGraph;
  const installed = state.value?.available && typeof graph.View === 'function' && typeof graph.focus === 'function' && typeof graph.sessionId === 'function';
  return (
    <ResourceState state={state} refresh={refresh} rows={1}>
      {installed ? (
        <>
          <div className="aw-project__actions"><Button size="sm" onClick={() => setOpen(true)}>Open Git Graph</Button></div>
          {open ? <ProjectGitGraph host={host} project={project} onClose={() => setOpen(false)} /> : null}
        </>
      ) : (
        <p className="aw-muted">Git Graph is not installed. Repository links, local development and work review remain available.</p>
      )}
    </ResourceState>
  );
}

function ProjectGitGraph({ host, project, onClose }) {
  const load = useCallback(async () => {
    const local = await host.projectLocalInfo({ projectId: project.id });
    if (!local?.found || !local.path) throw new Error('Connect a local checkout before opening Git Graph.');
    const sessionId = host.gitGraph.sessionId();
    if (!sessionId) throw new Error('Open a local session, then try Git Graph again.');
    await host.gitGraph.focus({ sessionId, repo: local.path });
    return { sessionId };
  }, [host, project.id]);
  const [state, refresh] = useProjectResource(load);
  const View = host.gitGraph.View;
  return (
    <Modal kind="confirm" title={`${project.name} · Git Graph`} onClose={onClose} full>
      <div className="aw-review">
        <ResourceState state={state} refresh={refresh}>
          {state.value ? <View sessionId={state.value.sessionId} /> : null}
        </ResourceState>
      </div>
    </Modal>
  );
}

function DeployHistory({ project, site, refresh }) {
  const { api, ask } = useAdmin();
  const load = useCallback(() => api('GET', `${pathFor(project)}/site/deploys?siteId=${encodeURIComponent(site.id)}`), [api, project.id, site.id]);
  const [state, refreshDeploys] = useProjectResource(load);
  const [writeState, write] = useWrite();
  return (
    <details>
      <summary>{site.name || project.name}: deployment history & rollback</summary>
      <ResourceState state={state} refresh={refreshDeploys} rows={2}>
        {(state.value?.deploys ?? []).length ? (
          <ul className="aw-project__work">
            {state.value.deploys.map(deploy => (
              <li key={deploy.id}>
                <div>
                  <strong className="aw-mono">{deploy.id}</strong>
                  <span className="aw-muted">{deploy.branch || deploy.kind || 'Recorded deploy'}{deploy.created_at ? ` · ${ago(deploy.created_at)}` : ''}</span>
                </div>
                <Button
                  disabled={writeState.busy}
                  size="sm"
                  onClick={() => ask({
                    title: 'Roll production back?',
                    text: `Replace ${site.productionUrl || site.name || project.name} with recorded deploy ${deploy.id}. This changes what visitors see.`,
                    confirm: 'Roll back',
                    run: () => write(async () => {
                      await api('POST', `${pathFor(project)}/site/rollback`, { deployId: deploy.id, siteId: site.id });
                      void refresh();
                      void refreshDeploys();
                    }, 'Production rolled back.'),
                  })}
                >
                  Roll back
                </Button>
              </li>
            ))}
          </ul>
        ) : <p className="aw-muted">No recorded deployments yet.</p>}
      </ResourceState>
      <Feedback state={writeState} />
    </details>
  );
}

const WORK_FILTERS = {
  open: ticket => !['done', 'declined'].includes(ticket.status),
  review: ticket => ticket.status === 'review',
  done: ticket => ['done', 'declined'].includes(ticket.status),
  all: () => true,
};
const WORK_FILTER_EMPTY = { open: 'Nothing open', review: 'Nothing waiting for review', done: 'Nothing finished yet', all: 'No work yet' };

/** The one ticket list, with the recorded agent activity under it. */
function Work({ project }) {
  const { data, setModal } = useAdmin();
  const tickets = projectWork(data.tickets, project.id);
  const [filter, setFilter] = useState('open');
  const shown = useMemo(() => tickets.filter(WORK_FILTERS[filter] ?? WORK_FILTERS.open), [tickets, filter]);
  return (
    <>
      <section className="aw-project__section">
        <div className="aw-row-h">
          <h3>Project work</h3>
          <span className="aw-toolbar__fill" />
          <Segmented value={filter} onChange={setFilter} label="Work filter" options={[{ value: 'open', label: 'Open' }, { value: 'review', label: 'Review' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />
        </div>
        <p className="aw-muted">Save a draft for later, queue an agent deliberately, or continue the same work locally. Open a request for its conversation and evidence.</p>
        {shown.length ? <WorkList tickets={shown} /> : (
          tickets.length
            ? <Empty title={WORK_FILTER_EMPTY[filter] ?? WORK_FILTER_EMPTY.open} hint="Switch the filter to see the rest of this project's work." action={filter !== 'all' ? <Button size="sm" onClick={() => setFilter('all')}>Show all work</Button> : null} />
            : <Empty title="No work yet" hint="Add the first outcome you want to deliver." action={<Button size="sm" onClick={() => setModal({ kind: 'task', projectId: project.id })}>Add work</Button>} />
        )}
      </section>
      <Activity project={project} />
    </>
  );
}

function WorkList({ tickets }) {
  const { openTicket } = useAdmin();
  return (
    <ul className="aw-project__work">
      {tickets.map(ticket => (
        <li key={ticket.id}>
          <button type="button" className="aw-project__worklink" onClick={() => openTicket(ticket.id)}>
            <span className="aw-mono">#{ticket.id}</span>
            <strong>{ticket.title}</strong>
            {ticket.updated_at ? <span className="aw-muted">{ago(ticket.updated_at)}</span> : null}
          </button>
          <StatusPill status={ticket.status} />
        </li>
      ))}
    </ul>
  );
}

function Activity({ project }) {
  const { data, openTicket } = useAdmin();
  const tickets = projectWork(data.tickets, project.id);
  const ids = new Set(tickets.map(ticket => String(ticket.id)));
  const runs = [...(data.running ?? []), ...(data.recent ?? [])]
    .filter((run, index, all) => ids.has(String(run.ticket_id)) && all.findIndex(other => other.id === run.id) === index)
    .sort((a, b) => (b.started_at ?? b.created_at ?? 0) - (a.started_at ?? a.created_at ?? 0));
  return (
    <section className="aw-project__section" id="project-activity">
      <h3>Activity & review</h3>
      <p className="aw-muted">Recent recorded attempts are listed below. Open a request to select any historical run and inspect its changes, checks and agent session. Missing checks mean unknown, not passing.</p>
      {runs.length ? (
        <ul className="aw-project__work">
          {runs.map(run => (
            <li key={run.id}>
              <div className="aw-project__run">
                <button type="button" className="aw-link" onClick={() => openTicket(run.ticket_id)}>
                  #{run.ticket_id} · {tickets.find(ticket => String(ticket.id) === String(run.ticket_id))?.title}
                </button>
                <span className="aw-muted">
                  <span className="aw-mono">Run {run.id}</span> · {run.executor || 'Agent'} · {run.started_at ? ago(run.started_at) : 'Start time unknown'} · checks in request review
                </span>
              </div>
              <StatusPill status={run.status} />
              <Button size="sm" onClick={() => openTicket(run.ticket_id)}>Inspect attempts</Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No recent agent attempts" hint="Older evidence, when available, remains inside each request." />
      )}
    </section>
  );
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const emailsIn = text => [...new Set(text.split(/[\s,;]+/).map(part => part.trim().toLowerCase()).filter(Boolean))];

function ProjectInviteModal({ project, onClose }) {
  const { api, act, notify } = useAdmin();
  const [text, setText] = useState('');
  const [copy, setCopy] = useState(true);
  const [locale, setLocale] = useState('en-US');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const emails = emailsIn(text);
  const bad = emails.filter(email => !EMAIL_RE.test(email));
  const already = new Set((project.clients ?? []).map(client => client.email.toLowerCase()));
  const fresh = emails.filter(email => EMAIL_RE.test(email) && !already.has(email));
  const send = async () => {
    setBusy(true);
    const failed = [];
    let unsent = 0;
    try {
      await act(async () => {
        for (const email of fresh) {
          try {
            const out = await api('POST', '/admin/clients', { email, locale, projectIds: [project.id], copy, note: note.trim() || undefined });
            if (out?.invite?.sent === false) unsent += 1;
          } catch { failed.push(email); }
        }
      });
      const added = fresh.length - failed.length;
      if (failed.length) notify(`Added ${added} of ${fresh.length}. Not added: ${failed.join(', ')}`, 'error');
      else notify(`Added ${added} to ${project.name}.${unsent ? ` ${unsent} email${unsent === 1 ? '' : 's'} not sent; use Resend on their card.` : ''}`);
      if (!failed.length) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal kind="create"
      title={`Add people to ${project.name}`}
      subtitle="Each address gets a link that signs them in (one use, 7 days). They see every request on this project; prices stay with whoever filed."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={busy || !fresh.length || bad.length > 0} onClick={() => void send()}>
            {busy ? 'Adding…' : `Add ${fresh.length || ''}`.trim()}
          </Button>
        </>
      }
    >
      <Field label="Emails" hint={bad.length ? `Not an address: ${bad.join(', ')}` : emails.length > fresh.length ? `${emails.length - fresh.length} already on the project.` : 'One or more, separated by commas, spaces or new lines.'}>
        <textarea rows={3} value={text} placeholder="owner@example.com, office@example.com" onChange={event => setText(event.target.value)} />
      </Field>
      <Field label="Emails about requests">
        <label className="aw-check"><input type="checkbox" checked={copy} onChange={event => setCopy(event.target.checked)} />Send them a copy of every request on this project (new requests, replies, status changes)</label>
      </Field>
      <Field label="Language" hint="For new accounts: the invite email and the portal. Existing accounts keep theirs.">
        <select value={locale} onChange={event => setLocale(event.target.value)}>{LOCALES.map(locale => <option key={locale.code} value={locale.code}>{locale.english}</option>)}</select>
      </Field>
      <Field label="Note" hint="Optional. Added under the link. Not translated."><textarea rows={2} value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></Field>
    </Modal>
  );
}

/**
 * One table for everyone attached to the project: clients and trusted developers,
 * told apart by role instead of repeating the same names across multiple blocks.
 * The owner is whoever `ownerUserId` names: their row is marked, and every
 * other attached client can be made the owner in place (rule 2 — the owner's
 * own connections then carry the project's deploys and repo access).
 */
function PeopleTable({ project, recipients, clients, memberships, ownerUserId, canManage, canSetOwner, onPeopleChanged, onRemoveDeveloper, busy }) {
  const { api, act, ask, open } = useAdmin();
  const byKey = new Map();
  for (const dev of Array.isArray(memberships) ? memberships : []) {
    if (!dev?.userId && !dev?.email) continue;
    const key = String(dev.userId ?? dev.email);
    byKey.set(key, { key, userId: dev.userId ?? null, name: dev.name || null, email: dev.email, role: 'Trusted developer', client: null, developer: dev });
  }
  for (const person of Array.isArray(recipients) ? recipients : []) {
    if (!person?.email && !person?.userId) continue;
    const key = String(person.userId ?? person.email);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.name && person.name) existing.name = person.name;
      continue;
    }
    byKey.set(key, { key, userId: person.userId ?? null, name: person.name || null, email: person.email, role: person.memberType === 'trusted_developer' ? 'Trusted developer' : 'Client', client: null, developer: null });
  }
  for (const client of Array.isArray(clients) ? clients : []) {
    if (!client?.id && !client?.email) continue;
    const key = String(client.id ?? client.email);
    const row = byKey.get(key);
    if (row) { row.client = client; if (!row.name) row.name = client.name || null; continue; }
    byKey.set(key, { key, userId: client.id ?? null, name: client.name || null, email: client.email, role: 'Client', client, developer: null });
  }
  const rows = [...byKey.values()];
  if (!rows.length) return <p className="aw-muted">Nobody yet. Only you see this project. An owner must first be added — invite a person, then make them the owner here.</p>;
  const makeOwner = row => ask({
    title: `Make ${row.client.email} the owner of ${project.name}?`,
    text: 'Their own Cloudflare and GitHub connections will be used for this project’s deploys and repo access. The previous owner stops providing them.',
    confirm: 'Make owner',
    run: () => act(() => api('PATCH', pathFor(project), { ownerUserId: row.client.id }), `${row.client.email} now owns ${project.name}; its deploys use their connections.`).then(onPeopleChanged).catch(() => undefined),
  });
  const removeClient = row => ask({
    title: `Remove ${row.client.email} from ${project.name}?`,
    text: row.client.id === ownerUserId
      ? 'They stop seeing its requests and stop getting its emails. They are the project owner: ownership is cleared, and deploys lose their credentials until a new owner is set.'
      : 'They stop seeing its requests and stop getting its emails. Their account and their own requests stay.',
    confirm: 'Remove',
    danger: true,
    run: () => act(() => api('DELETE', `/admin/clients/${row.client.id}/projects/${encodeURIComponent(project.id)}`), `Removed ${row.client.email}.`).then(onPeopleChanged).catch(() => undefined),
  });
  return (
    <DataTable
      className="aw-project__people"
      label="People on this project"
      rows={rows}
      rowKey={row => row.key}
      columns={[
        {
          key: 'who',
          header: 'Person',
          render: row => (
            <span className="aw-project__peoplewho">
              {row.userId && row.role === 'Client'
                ? <button type="button" className="aw-link aw-people__who" title={row.email} onClick={() => open(`c:${row.userId}`)}>{row.name ? `${row.name} · ` : ''}{row.email}</button>
                : <span className="aw-people__who" title={row.email}>{row.name ? `${row.name} · ` : ''}{row.email}</span>}
            </span>
          ),
        },
        {
          key: 'role',
          header: 'Role',
          fit: true,
          render: row => (
            <span className="aw-project__rolecell">
              {row.userId && row.userId === ownerUserId ? <Tag tone="ok">Owner</Tag> : null}
              <Tag tone={row.role === 'Trusted developer' ? undefined : 'dash'}>{row.role}</Tag>
              {row.client?.pending ? <Tag tone="warn">invited</Tag> : null}
            </span>
          ),
        },
        canManage ? {
          key: 'manage',
          header: <span className="aw-sr">Manage</span>,
          label: 'Manage',
          fit: true,
          render: row => (
            <span className="aw-project__peopleact">
              {row.client ? (
                <>
                  {row.client.id !== ownerUserId && canSetOwner ? (
                    <Button
                      size="sm"
                      kind="ghost"
                      title={`Make ${row.client.email} the project owner`}
                      onClick={() => makeOwner(row)}
                    >
                      Make owner
                    </Button>
                  ) : null}
                  <label className="aw-check" title="Mail them about every request on this project, not only the ones they filed">
                    <input
                      type="checkbox"
                      checked={Boolean(row.client.copy)}
                      onChange={event => void act(
                        () => api('PUT', `/admin/clients/${row.client.id}/projects/${encodeURIComponent(project.id)}`, { copy: event.target.checked }),
                        event.target.checked ? `${row.client.email} gets every request on ${project.name}.` : `${row.client.email} gets only their own requests.`,
                      ).then(onPeopleChanged)}
                    />
                    all emails
                  </label>
                  <Button
                    size="sm"
                    kind="ghost"
                    title="Take them off this project"
                    onClick={() => removeClient(row)}
                  >
                    ✕
                  </Button>
                </>
              ) : row.developer ? (
                <Button
                  size="sm"
                  kind="ghost"
                  disabled={busy}
                  onClick={() => onRemoveDeveloper(row.developer)}
                >
                  Remove access
                </Button>
              ) : null}
            </span>
          ),
        } : null,
      ].filter(Boolean)}
    />
  );
}

function People({ project, refresh }) {
  const { api, data, ask, setModal } = useAdmin();
  const load = useCallback(() => api('GET', `${pathFor(project)}/memberships`), [api, project.id]);
  const [state, refreshPeople] = useProjectResource(load);
  const loadRecipients = useCallback(() => api('GET', `${pathFor(project)}/recipients`), [api, project.id]);
  const [recipients, refreshRecipients] = useProjectResource(loadRecipients);
  const [email, setEmail] = useState('');
  const [writeState, write] = useWrite();
  const user = data.identity?.user ?? data.user;
  const admin = data.access?.superAdmin === true || data.identity?.access?.superAdmin === true || user?.role === 'admin';
  const owner = state.value?.ownerUserId && state.value.ownerUserId === user?.id;
  const ownerPerson = (state.value?.clients ?? project.clients ?? []).find(person => person.id === state.value?.ownerUserId);
  const attached = state.value?.clients ?? project.clients ?? [];
  const peopleChanged = useCallback(() => { void refreshPeople(); void refreshRecipients(); void refresh(); }, [refreshPeople, refreshRecipients, refresh]);
  const grant = event => {
    event.preventDefault();
    if (!email.trim() || !admin) return;
    void write(async () => {
      await api('POST', `${pathFor(project)}/memberships`, { email: email.trim() });
      setEmail('');
      void peopleChanged();
    }, 'Trusted project access granted.');
  };
  const removeDeveloper = person => {
    ask({
      title: `Remove ${person.email} from this project?`,
      text: 'Their trusted access ends immediately. Their account and access to other projects stay unchanged.',
      confirm: 'Remove access',
      danger: true,
      run: () => write(async () => {
        await api('DELETE', `${pathFor(project)}/memberships/${encodeURIComponent(person.userId)}`);
        void peopleChanged();
      }, 'Trusted access removed.'),
    });
  };
  return (
    <section className="aw-project__section" id="project-people">
      <div className="aw-row-h">
        <h3>People & access</h3>
        <span className="aw-toolbar__fill" />
        {admin ? (
          <Button size="sm" onClick={() => setModal({ kind: 'custom', render: close => <ProjectInviteModal project={project} onClose={() => { close(); void peopleChanged(); }} /> })}>
            Add people
          </Button>
        ) : null}
      </div>
      <p className="aw-project__ownership">
        <strong>{state.value?.ownerUserId ? `Owned by ${ownerPerson?.name || ownerPerson?.email || state.value.ownerUserId}.` : 'No owner set yet.'}</strong>{' '}
        <span className="aw-muted">
          {state.value?.ownerUserId
            ? 'Their own Cloudflare and GitHub connections carry this project’s deploys and repo access.'
            : attached.length
              ? 'Make one of the people below the owner: their connections then carry this project’s deploys and repo access.'
              : 'An owner must first be added to the project — invite a person below, then make them the owner.'}
          {' '}Select recipients in a work conversation to notify them — typed @names alone do not send notifications.
        </span>
      </p>
      <ResourceState state={recipients} refresh={refreshRecipients} rows={3}>
        <PeopleTable
          project={project}
          recipients={recipients.value?.recipients}
          clients={attached}
          memberships={state.value?.memberships ?? []}
          ownerUserId={state.value?.ownerUserId ?? null}
          canManage={admin || owner}
          canSetOwner={admin}
          onPeopleChanged={peopleChanged}
          onRemoveDeveloper={removeDeveloper}
          busy={writeState.busy}
        />
      </ResourceState>
      <div className="aw-project__connect">
        <h4>Grant trusted developer access</h4>
        <p className="aw-muted">Trusted developers can work across this project’s context, integrations, configuration, code and deployments without global admin access.</p>
        {admin ? (
          <form onSubmit={grant} className="aw-project__invite">
            <Field label="Existing account email">
              <input type="email" required maxLength={254} value={email} placeholder="dev@example.com" onChange={event => setEmail(event.target.value)} />
            </Field>
            <Button type="submit" disabled={writeState.busy || !email.trim()} title={!email.trim() ? 'Enter an existing account email first.' : undefined}>
              {writeState.busy ? 'Granting…' : 'Grant project access'}
            </Button>
          </form>
        ) : (
          <p className="aw-muted">A workspace administrator can grant trusted developer access.{owner ? ' As project owner, you can remove it.' : ''}</p>
        )}
        <Feedback state={writeState} />
      </div>
    </section>
  );
}

/**
 * Where the work goes live on the client's own Cloudflare: the portal reads
 * the account through the project owner's OAuth connection (they connect it
 * on the portal's Connections page; no one else's is ever used), and the
 * chosen Pages project or Worker becomes the fleet's deploy target.
 */
function Hosting({ project }) {
  const { api, ask } = useAdmin();
  const load = useCallback(
    () => api('GET', `/admin/projects/${encodeURIComponent(project.id)}/cloudflare`),
    [api, project.id],
  );
  const [state, reload] = useProjectResource(load);
  const [write, run] = useWrite();
  const info = state.value;
  const target = info?.target ?? null;
  const connections = info?.connections ?? [];
  const grant = connections.find((c) => c.id === info?.connectionId) ?? null;
  const accountName = grant?.accounts.find((a) => a.id === info?.accountId)?.name ?? info?.accountId;
  // What the account already builds from this project's repo, and what the
  // repo is called there — newer reads only; both stay null on old servers.
  const detected = info?.detected ?? null;
  const projectRepo = info?.projectRepo ?? repoRef(project.repo)?.slug ?? null;
  const isTarget = (kind, name) => target?.kind === kind && target?.name === name;
  const choose = (next, success) => run(async () => {
    await api('PUT', `/admin/projects/${encodeURIComponent(project.id)}/deploy-target`, {
      target: next && info?.via === 'oauth' ? { ...next, connectionId: info.connectionId, accountId: info.accountId } : next,
    });
    await reload();
  }, success);
  const fleetPick = (item) => ask({
    title: `Fleet deploys to ${item.name}?`,
    text: `Previews go up from each ticket branch; production from ${item.productionBranch || 'main'} goes live to the ${item.kind === 'pages' ? 'Pages project' : 'Worker'} ${item.name}.`,
    confirm: 'Fleet deploys here',
    run: () => choose({ provider: 'cloudflare', kind: item.kind, name: item.name, productionBranch: item.productionBranch || 'main', builds: 'fleet' }, `Deploys to ${item.name} now.`),
  });
  const useDetected = () => ask({
    title: `Use Cloudflare's builds for ${detected.name}?`,
    text: `Cloudflare already builds it from ${projectRepo ?? 'this project’s repo'}: each ticket branch gets a preview, ${detected.productionBranch || 'main'} goes live.`,
    confirm: 'Use it',
    run: () => choose({ provider: detected.provider ?? 'cloudflare', kind: detected.kind, name: detected.name, productionBranch: detected.productionBranch || 'main', builds: 'provider' }, `Cloudflare builds ${detected.name} now.`),
  });
  const clearTarget = () => ask({
    title: `Clear the deploy target for ${project.name}?`,
    text: 'Nothing deploys anywhere until a target is chosen again.',
    confirm: 'Clear target',
    run: () => choose(null, 'Deploy target cleared.'),
  });
  // Resources that can plausibly be this project's home: whatever already
  // answers one of the account's domains, plus a Pages project built from the
  // project's repo. Anything else — another site's script, a mail worker —
  // never gets a deploy button, so a click cannot retarget deploys onto it.
  const servedBy = (info?.domains?.ok ? info.domains.items : []).filter((d) => d.kind === 'pages' || d.kind === 'workers');
  const servedHosts = (kind, name) => servedBy.filter((d) => d.kind === kind && d.name === name).map((d) => d.host);
  const relevant = [];
  const seen = new Set();
  const push = (kind, name, productionBranch, note) => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    relevant.push({ kind, name, productionBranch, note });
  };
  for (const p of info?.pages?.ok ? info.pages.items : []) {
    const hosts = servedHosts('pages', p.name);
    const repoBuilt = Boolean(projectRepo) && p.source?.repo === projectRepo;
    if (!hosts.length && !repoBuilt) continue;
    push('pages', p.name, p.productionBranch || p.source?.productionBranch || 'main',
      [repoBuilt ? `builds from ${p.source.repo}` : null, hosts.length ? `serves ${hosts.join(', ')}` : (p.domains ?? []).length ? `serves ${p.domains.join(', ')}` : null, p.productionBranch && !repoBuilt ? `production ${p.productionBranch}` : null].filter(Boolean).join(' · '));
  }
  for (const w of info?.workers?.ok ? info.workers.items : []) {
    const hosts = servedHosts('workers', w.name);
    if (!hosts.length) continue;
    push('workers', w.name, 'main', [`serves ${hosts.join(', ')}`, w.modifiedOn ? `changed ${w.modifiedOn.slice(0, 10)}` : null].filter(Boolean).join(' · '));
  }
  // A resource the listings could not read still names itself in served-by.
  for (const d of servedBy) push(d.kind, d.name, 'main', `serves ${servedHosts(d.kind, d.name).join(', ')}`);
  const attachedClients = Array.isArray(project.clients) ? project.clients : [];
  // The owner is made in People & access, one section up on this tab.
  const goToPeople = () => {
    if (typeof document === 'undefined') return;
    document.getElementById('project-people')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };
  const listError = (section) => !section || section.ok ? null : (
    <p className="aw-warn">{section.error}{section.permission ? ` It needs ${section.permission}.` : ''}{section.permission && info?.via === 'oauth' ? " The client reconnects Cloudflare on the portal's Connections page to grant it." : ''}</p>
  );
  return (
    <section className="aw-project__section" id="project-hosting">
      <div className="aw-row-h">
        <h3>Where it goes live</h3>
        <span className="aw-toolbar__fill" />
        {target ? <Button size="sm" kind="ghost" busy={write.busy} onClick={clearTarget}>Clear target</Button> : null}
      </div>
      {state.loading && !info ? <Skeleton label="Reading the owner's Cloudflare…" /> : null}
      {state.error ? <ErrorNote error={state.error} /> : null}
      {info?.needsOwner ? (
        <Empty
          title="Set the project owner first"
          hint={attachedClients.length
            ? "Hosting reads only the owner's Cloudflare connection, and this project has no owner yet. Make one of its people the owner in People & access; then their Cloudflare shows here."
            : "Hosting reads only the owner's Cloudflare connection, and this project has no one attached yet. An owner must first be added to the project in People & access above."}
          action={<Button size="sm" onClick={goToPeople}>Go to People & access</Button>}
          inline
        />
      ) : null}
      {info && !info.needsOwner && !info.connected && info.lapsed ? (
        <p className="aw-warn">{grant?.email ?? 'The owner'}'s Cloudflare connection has lapsed. They reconnect it on the portal's Connections page.</p>
      ) : null}
      {info && !info.needsOwner && !info.connected && !info.lapsed ? (
        <Empty
          title="No Cloudflare connected"
          hint={`${info.owner ?? 'The project owner'} connects their account on the portal's Connections page; then its Workers show here.`}
          inline
        />
      ) : null}
      {info?.connected ? (
        <>
          <p className="aw-muted">
            {info.via === 'oauth' ? `Through the owner's Cloudflare connection (${grant?.email ?? info.owner ?? 'the owner'}), account ${accountName}.` : 'Through the Cloudflare credentials stored on this project.'}
          </p>
          {target?.builds === 'provider' ? (
            <div className="aw-project__hosting-list">
              <p>
                <strong>{target.name}</strong>{' '}
                <Tag tone="ok">Deploy target</Tag>
              </p>
              <p>Cloudflare builds {target.name} from {projectRepo ?? 'its repo'}: each ticket branch gets a preview, {target.productionBranch} goes live.</p>
            </div>
          ) : detected ? (
            <div className="aw-project__connect">
              <p><strong>Cloudflare already builds this project from its repo ({detected.name}).</strong></p>
              <p className="aw-muted">Each ticket branch gets a preview; {detected.productionBranch || 'main'} goes live.</p>
              {target ? <p className="aw-muted">Fleet currently deploys to {target.name} instead.</p> : null}
              <div className="aw-project__actions">
                <Button size="sm" kind="primary" busy={write.busy} onClick={useDetected}>Use it</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="aw-muted">
                {target
                  ? `Fleet deploys previews from ticket branches and production from ${target.productionBranch} to the ${target.kind === 'pages' ? 'Pages project' : 'Worker'} ${target.name}.`
                  : 'Pick where fleet runs deploy: previews from ticket branches, production from the production branch.'}
              </p>
              {listError(info.pages)}
              {listError(info.workers)}
              {relevant.length ? (
                <ul className="aw-project__hosting-items">
                  {relevant.map((item) => (
                    <li key={`${item.kind}:${item.name}`}>
                      <span><strong>{item.name}</strong> <span className="ui-note">{item.kind === 'pages' ? 'Pages project' : 'Worker'}{item.note ? ` · ${item.note}` : ''}</span></span>
                      {isTarget(item.kind, item.name)
                        ? <Tag tone="ok">Deploy target</Tag>
                        : <Button size="sm" busy={write.busy} onClick={() => fleetPick(item)}>Fleet deploys here</Button>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="aw-muted">No Pages project or Worker in this account serves one of its domains yet.</p>
              )}
            </>
          )}
          <details className="aw-project__hosting-list">
            <summary>Domains</summary>
            {info.domains?.ok && info.domains.items.length ? (
              <ul className="aw-project__hosting-items">
                {info.domains.items.map((d) => (
                  <li key={`${d.host} ${d.kind} ${d.name}`}>
                    <span><strong>{d.host}</strong> <span className="ui-note">{d.kind === 'workers' ? `Worker ${d.name}` : d.kind === 'pages' ? `Pages project ${d.name}` : d.name} · {d.via}</span></span>
                    {d.kind !== 'dns' && isTarget(d.kind, d.name) ? <Tag tone="ok">Deploy target</Tag> : null}
                  </li>
                ))}
              </ul>
            ) : info.domains && !info.domains.ok ? (
              <p className="aw-muted">{info.domains.error}</p>
            ) : (
              <p className="aw-muted">No domains in this account.</p>
            )}
          </details>
        </>
      ) : null}
      {write.error ? <ErrorNote error={write.error} /> : null}
      {write.success ? <p className="ui-note" role="status">{write.success}</p> : null}
    </section>
  );
}

function Secrets({ project }) {
  const { api, ask } = useAdmin();
  const [opened, setOpened] = useState(false);
  // Metadata loads only when this deliberate access surface is opened.
  return (
    <section className="aw-project__section" id="project-secrets">
      <div className="aw-row-h">
        <h3>Project secrets</h3>
        <span className="aw-toolbar__fill" />
        {opened ? <Button size="sm" kind="ghost" onClick={() => setOpened(false)}>Close secrets</Button> : null}
      </div>
      <p className="aw-muted">Values stay hidden until you deliberately reveal one. Never paste secrets into work briefs, agent conversations or screenshots.</p>
      {opened ? (
        <SecretManager key={project.id} project={project} api={api} ask={ask} />
      ) : (
        <div className="aw-project__actions"><Button size="sm" onClick={() => setOpened(true)}>Manage project secrets</Button></div>
      )}
    </section>
  );
}

function SecretManager({ project, api, ask }) {
  const load = useCallback(() => api('GET', `${pathFor(project)}/secrets`), [api, project.id]);
  const [state, refresh] = useProjectResource(load);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [revealed, setRevealed] = useState(null);
  const [writeState, write] = useWrite();
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  const hide = () => { clearTimeout(timer.current); setRevealed(null); };
  const save = event => {
    event.preventDefault();
    if (!name.trim() || !value) return;
    void write(async () => {
      await api('PUT', `${pathFor(project)}/secrets/${encodeURIComponent(name.trim())}`, { value });
      setValue('');
      setName('');
      hide();
      void refresh();
    }, 'Secret saved.');
  };
  return (
    <>
      <ResourceState state={state} refresh={refresh} rows={2}>
        {(state.value?.secrets ?? []).length ? (
          <ul className="aw-project__work">
            {state.value.secrets.map(secret => (
              <li key={secret.name}>
                <code className="aw-mono">{secret.name}</code>
                <span className="aw-toolbar__fill" />
                <Button
                  size="sm"
                  disabled={writeState.busy}
                  onClick={() => void write(async () => {
                    hide();
                    const result = await api('POST', `${pathFor(project)}/secrets/${encodeURIComponent(secret.name)}/reveal`, {});
                    if (!alive.current) return;
                    setRevealed({ name: secret.name, value: result.value });
                    timer.current = setTimeout(() => setRevealed(null), 30_000);
                  })}
                >
                  Reveal
                </Button>
                <Button
                  size="sm"
                  kind="ghost"
                  disabled={writeState.busy}
                  onClick={() => ask({
                    title: `Delete ${secret.name}?`,
                    text: 'Project operations that depend on this secret may stop working. This cannot be undone.',
                    confirm: 'Delete secret',
                    danger: true,
                    run: () => write(async () => {
                      await api('DELETE', `${pathFor(project)}/secrets/${encodeURIComponent(secret.name)}`);
                      hide();
                      void refresh();
                    }, 'Secret deleted.'),
                  })}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : <p className="aw-muted">No project secrets stored.</p>}
      </ResourceState>
      {revealed ? (
        <div className="aw-project__reveal">
          <div className="aw-row-h">
            <strong className="aw-mono">{revealed.name}</strong>
            <span className="aw-toolbar__fill" />
            <Button size="sm" onClick={hide}>Hide value</Button>
          </div>
          <p className="aw-muted">Visible for 30 seconds. Hide it before sharing this screen.</p>
          <pre>{revealed.value}</pre>
        </div>
      ) : null}
      <form onSubmit={save} className="aw-project__form">
        <div className="aw-project__fields">
          <Field label="Secret name"><input required autoComplete="off" maxLength={128} value={name} placeholder="API_TOKEN" onChange={event => setName(event.target.value)} /></Field>
          <Field label="New value" hint="An existing name replaces that secret’s value."><input type="password" required autoComplete="new-password" value={value} onChange={event => setValue(event.target.value)} /></Field>
        </div>
        <div className="aw-project__actions">
          <Button type="submit" disabled={writeState.busy || !name.trim() || !value} title={!name.trim() || !value ? 'Enter both secret name and value.' : undefined}>
            {writeState.busy ? 'Saving…' : 'Set secret'}
          </Button>
        </div>
      </form>
      <Feedback state={writeState} />
    </>
  );
}
