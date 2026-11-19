/* Project destination shared by the web workbench and the native host. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from './store.js';
import { Button, Field, Icon, Modal, StatusPill, Tag } from './ui.jsx';
import { RepoModal, ProjectEditModal, ProjectPeople } from './fleet.jsx';
import { SitePanel } from './ticket.jsx';
import { ago } from './format.js';
import { briefPayload, createProjectResource, projectTopology, projectWork, resourceUrl, singleFlight } from './project-model.js';
import { ProjectWorld } from './project-world.jsx';
import projectStyles from './project-styles.js';

const errorText = error => error?.message || String(error || 'Request failed');
const pathFor = project => `/admin/projects/${encodeURIComponent(project.id)}`;
const TABS = ['Overview', 'Resources', 'Work', 'Activity & review', 'People'];

function useProjectResource(load) {
  const [state, setState] = useState({load:null, value:null, loading:true, error:null});
  const resource = useRef(null);
  useEffect(() => {
    const current = createProjectResource(load, next => setState({...next, load}));
    resource.current = current;
    void current.refresh();
    return () => current.dispose();
  }, [load]);
  const refresh = useCallback(() => resource.current?.refresh(), []);
  return [state.load === load ? state : {value:null, loading:true, error:null}, refresh];
}

/** All writes use the same synchronous guard for form and pointer submission. */
function useWrite() {
  const [state, setState] = useState({busy:false, error:null, success:null});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => {alive.current = false;}; }, []);
  const run = useMemo(() => singleFlight(async (operation, success) => {
    if (alive.current) setState({busy:true, error:null, success:null});
    try {
      const result = await operation();
      if (alive.current) setState({busy:false, error:null, success:success || null});
      return result;
    } catch (error) {
      if (alive.current) setState({busy:false, error, success:null});
      return undefined;
    }
  }), []);
  return [state, run];
}

function Feedback({state}) {
  return <>{state.error ? <p className="aw-project__error" role="alert">{errorText(state.error)}</p> : null}{state.success ? <p className="aw-project__success" role="status">{state.success}</p> : null}</>;
}

function ResourceState({state, refresh, children}) {
  if (state.loading) return <p className="aw-muted" role="status">Loading…</p>;
  return <>{state.error ? <div className="aw-project__error" role="alert">{state.value ? 'Showing the last successful response. ' : ''}{errorText(state.error)} <Button size="sm" disabled={state.refreshing} onClick={refresh}>Retry</Button></div> : null}{children}</>;
}

export function ProjectView({id}) {
  const {api, data, host, setModal, reload} = useAdmin();
  const [tab, setTab] = useState('Overview');
  const load = useCallback(async () => {
    const result = await api('GET', '/admin/projects');
    return {project:(result.projects ?? []).find(project => project.id === id) ?? null};
  }, [api, id]);
  const [remote, refresh] = useProjectResource(load);
  const lastInventory = useRef(data.projects);
  useEffect(() => {
    if (lastInventory.current !== data.projects) {lastInventory.current = data.projects; void refresh();}
  }, [data.projects, refresh]);
  useEffect(() => setTab('Overview'), [id]);
  // Inventory supplies immediate context; an authoritative missing result never falls back.
  const project = remote.value ? remote.value.project : (data.projects ?? []).find(project => project.id === id);
  const refreshAll = useCallback(async () => { await refresh(); await reload?.(); }, [refresh, reload]);
  if (!project) return <div className="aw-view aw-project"><style>{projectStyles}</style><ResourceState state={remote} refresh={refresh}>{!remote.loading ? <><h2>Project unavailable</h2><p className="aw-muted">This project no longer exists or is not available to your account. Refresh the project list or choose another project.</p><Button onClick={refreshAll}>Refresh projects</Button></> : null}</ResourceState></div>;
  return <div className="aw-view aw-project" key={id}>
    <style>{projectStyles}</style>
    <header className="aw-project__header">
      <div><h2>{project.name}</h2><p className="aw-muted">{project.slug} · {project.kind === 'new' ? 'New project' : 'Existing project'}{project.githubAccount ? ` · GitHub @${project.githubAccount}` : ''}</p></div>
      <div className="aw-project__actions">
        <Button onClick={() => setModal({kind:'custom', render:close => <ProjectEditModal project={project} onClose={() => {close(); void refreshAll();}} />})}>Edit project</Button>
        <Button kind="primary" onClick={() => setModal({kind:'task',projectId:id})}><Icon name="plus" /> Add work</Button>
      </div>
    </header>
    {remote.error ? <div role="alert" className="aw-project__error">Project refresh failed. {errorText(remote.error)} <Button size="sm" onClick={refresh}>Retry</Button></div> : null}
    <nav className="aw-project__tabs" aria-label="Project sections">{TABS.map(label => <button type="button" key={label} aria-current={tab === label ? 'page' : undefined} onClick={() => setTab(label)}>{label}</button>)}</nav>
    <div className="aw-project__body" key={`${id}:${tab}`}>
      {tab === 'Overview' ? <Overview project={project} refresh={refreshAll} setTab={setTab} /> : null}
      {tab === 'Resources' ? <Resources project={project} refresh={refreshAll} host={host} /> : null}
      {tab === 'Work' ? <Work project={project} /> : null}
      {tab === 'Activity & review' ? <Activity project={project} /> : null}
      {tab === 'People' ? <People project={project} refresh={refreshAll} /> : null}
    </div>
  </div>;
}

function Overview({project, refresh, setTab}) {
  const {data} = useAdmin();
  const work = projectWork(data.tickets, project.id);
  const projectTickets = useMemo(
    () => (data.tickets ?? []).filter(ticket => ticket && ticket.project_id != null && String(ticket.project_id) === String(project.id)),
    [data.tickets, project.id],
  );
  const sites = useMemo(
    () => (Array.isArray(project.sites) && project.sites.length ? project.sites : project.site ? [project.site] : []),
    [project.sites, project.site],
  );
  const active = work.filter(ticket => !['done','declined'].includes(ticket.status));
  const review = active.filter(ticket => ticket.status === 'review');
  return <>
    <section className="aw-project__section aw-project__world" aria-label="Project world">
      <ProjectWorld project={project} sites={sites} tickets={projectTickets} />
    </section>
    <div className="aw-project__overview">
      <section className="aw-project__section"><Brief project={project} refresh={refresh} /></section>
      <section className="aw-project__section">
        <h3>Next actions</h3>
        {review.length ? <p>{review.length} {review.length === 1 ? 'request is' : 'requests are'} ready for review. Inspect the recorded changes and checks before deciding what to land.</p> : <p className="aw-muted">{active.length ? `${active.length} open ${active.length === 1 ? 'request' : 'requests'}. Continue locally or add a clear next step for an agent.` : 'No open work yet. Add your first request, save a draft, or continue in a local checkout.'}</p>}
        <WorkList tickets={(review.length ? review : active).slice(0, 4)} />
        <div className="aw-project__actions"><Button onClick={() => setTab('Work')}>All work</Button><Button onClick={() => setTab('Resources')}>Set up development</Button></div>
        <p className="aw-muted aw-project__note">You control this project. Agent help is optional; saving a draft never starts an agent.</p>
      </section>
    </div>
    <section className="aw-project__section"><h3>Project connections</h3><Topology project={project} /><Button onClick={() => setTab('Resources')}>Manage resources</Button></section>
  </>;
}

function Brief({project, refresh}) {
  const {api} = useAdmin();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.brief ?? {what:'',goal:''});
  const [saved, setSaved] = useState(project.brief);
  const [state, write] = useWrite();
  useEffect(() => {setSaved(project.brief); if (!editing) setDraft(project.brief ?? {what:'',goal:''});}, [project.brief]);
  const payload = briefPayload(draft, project.kind);
  const save = event => {
    event.preventDefault();
    if (!payload) return;
    void write(async () => {
      const result = await api('PATCH', pathFor(project), {brief:payload});
      setSaved(result.project?.brief ?? payload);
      setEditing(false);
      // Persistence succeeded even if a later inventory refresh fails.
      void refresh();
    }, 'Expectations saved.');
  };
  return <>
    <div className="aw-row-h"><h3>Expectations</h3><span className="aw-toolbar__fill" />{!editing ? <Button size="sm" onClick={() => {setDraft(saved ?? {what:'',goal:''});setEditing(true);}}>Edit expectations</Button> : null}</div>
    {editing ? <form onSubmit={save} className="aw-project__form">
      <Field label="What it is"><textarea aria-label="What it is" required rows={3} maxLength={1200} value={draft.what ?? ''} onChange={event => setDraft({...draft,what:event.target.value})} /></Field>
      <Field label="What done looks like"><textarea aria-label="What done looks like" required rows={3} maxLength={1200} value={draft.goal ?? ''} onChange={event => setDraft({...draft,goal:event.target.value})} /></Field>
      {project.kind === 'new' ? <Field label="Done by hand today" hint="Optional"><textarea rows={2} maxLength={1200} value={draft.manual ?? ''} onChange={event => setDraft({...draft,manual:event.target.value})} /></Field> : <Field label="Where the code lives" hint="Context only; configure the actual repository in Resources."><textarea rows={2} maxLength={1200} value={draft.where ?? ''} onChange={event => setDraft({...draft,where:event.target.value})} /></Field>}
      <div className="aw-project__actions"><Button disabled={state.busy} onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" kind="primary" disabled={state.busy || !payload}>{state.busy ? 'Saving…' : 'Save expectations'}</Button></div>
    </form> : <dl className="aw-project__brief"><dt>What it is</dt><dd>{saved?.what || 'Describe the project so the next person can pick it up.'}</dd><dt>What done looks like</dt><dd>{saved?.goal || 'Add an outcome and a clear definition of done.'}</dd>{saved?.where ? <><dt>Code context</dt><dd>{saved.where}</dd></> : null}{saved?.manual ? <><dt>Done by hand today</dt><dd>{saved.manual}</dd></> : null}</dl>}
    <Feedback state={state} />
  </>;
}

function ProjectIcon({name}) {
  const paths = {branch:'M6 3v12a3 3 0 1 0 3 3M6 9h8a4 4 0 0 0 4-4M18 3v4M4 3h4',globe:'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0M3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18',file:'M14 3H5v18h14V8l-5-5v5h5M8 12h8M8 16h8'};
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function Topology({project, local, git}) {
  const topology = projectTopology(project, local, git);
  return <ol className="aw-project__topology" aria-label="Development to deployment">
    <li><Icon name="folder" /><div><strong>Local checkout</strong><span>{topology.local}</span></div></li>
    <li><ProjectIcon name="branch" /><div><strong>Repository & ref</strong>{topology.repoUrl ? <a href={topology.repoUrl} target="_blank" rel="noreferrer">{topology.repoUrl}</a> : <span>{project.repo ? 'Repository configured; open it with your Git client.' : 'No repository linked'}</span>}<span className="aw-mono">{topology.branch}</span>{git?.remotes?.length ? <span>Remotes: {git.remotes.map(remote => remote.name).join(', ')}</span> : null}</div></li>
    <li><ProjectIcon name="globe" /><div><strong>Preview & production</strong>{topology.sites.length ? topology.sites.map(site => <div className="aw-project__destination" key={site.id}><span>{site.name || project.name} · {site.state || 'State unknown'}</span><span>{site.previewUrl ? <a href={site.previewUrl} target="_blank" rel="noreferrer">Preview</a> : 'No preview address'} · {site.productionUrl ? <a href={site.productionUrl} target="_blank" rel="noreferrer">Production</a> : 'No production address'}</span><span>{site.deployment}</span></div>) : <span>No hosted destinations yet</span>}</div></li>
  </ol>;
}

function Resources({project, refresh, host}) {
  const {api, setModal} = useAdmin();
  const [state, write] = useWrite();
  const native = typeof host?.projectLocalInfo === 'function';
  const loadLocal = useCallback(async () => {
    if (!native) return null;
    const local = await host.projectLocalInfo({projectId:project.id});
    let git = null, gitError = null;
    if (host.projectGitInfo && (local.found ?? local.exists)) {
      try {git = await host.projectGitInfo({projectId:project.id});} catch(error) {gitError = error;}
    }
    return {local, git, gitError};
  }, [host, native, project.id]);
  const [localState, refreshLocal] = useProjectResource(loadLocal);
  const topology = localState.value;
  const mutate = (operation, message) => void write(async () => {await operation(); void refresh();}, message);
  return <>
    <section className="aw-project__section"><h3>Development to deployment</h3><Topology project={project} local={topology?.local} git={topology?.git} /></section>
    <section className="aw-project__section"><h3>Local development</h3>
      {native ? <ResourceState state={localState} refresh={refreshLocal}>{topology?.gitError ? <p className="aw-project__error" role="alert">Git inspection failed: {errorText(topology.gitError)} <Button size="sm" onClick={refreshLocal}>Retry</Button></p> : null}<LocalDevelopment project={project} local={topology?.local} host={host} refresh={refreshLocal} /></ResourceState> : <div className="aw-project__handoff"><p>This browser cannot access your local files. Open this project in PTech Admin to connect a checkout, edit files and continue a development conversation.</p><p className="aw-muted">Repository links, work, recorded agent evidence and hosted deployments remain available here.</p>{resourceUrl(project.repo) ? <a href={resourceUrl(project.repo)} target="_blank" rel="noreferrer">Open repository</a> : <Button onClick={() => setModal({kind:'custom',render:close => <RepoModal project={project} onClose={() => {close();void refresh();}} />})}>Link a repository</Button>}</div>}
    </section>
    <section className="aw-project__section"><div className="aw-row-h"><h3>Repository & integrations</h3><span className="aw-toolbar__fill" /><Button onClick={() => setModal({kind:'custom', render:close => <RepoModal project={project} onClose={() => {close();void refresh();}} />})}>{project.repo ? 'Change repository' : 'Link repository'}</Button></div>
      <p>{resourceUrl(project.repo) ? <a href={resourceUrl(project.repo)} target="_blank" rel="noreferrer">{resourceUrl(project.repo)}</a> : project.repo ? 'Repository configured for Git access.' : 'Link existing code or create a repository for this project.'}</p>
      {project.repo_error ? <p role="alert" className="aw-project__error">{project.repo_error}</p> : null}
      <p className="aw-muted">{project.githubAccount ? `GitHub connected: @${project.githubAccount}` : 'No GitHub account linked to this project.'}{project.repoStatus?.label ? ` · ${project.repoStatus.label}` : ''}</p>
      {!project.repo ? <div className="aw-project__actions"><Button disabled={state.busy} onClick={() => mutate(() => api('POST', `${pathFor(project)}/repo/create`, {}), 'Repository creation requested.')}>Create repository</Button>{project.githubInstallationId ? <Button disabled={state.busy} onClick={() => mutate(() => api('POST', `${pathFor(project)}/repo/github`, {}), 'GitHub repository creation requested.')}>Create in @{project.githubAccount || 'connected GitHub'}</Button> : null}</div> : null}
      <Feedback state={state} />
    </section>
    <section className="aw-project__section"><div className="aw-row-h"><h3>Hosted destinations</h3><span className="aw-toolbar__fill" /><Button disabled={state.busy} onClick={() => mutate(() => api('POST', `${pathFor(project)}/site`, {}), 'Hosting setup requested.')}>{project.sites?.length ? 'Add a site' : 'Set up hosting'}</Button></div><p className="aw-muted">Rebuild changes preview only. Publishing replaces the live site with preview; the publish action asks you to confirm the destination.</p><SitePanel project={project} />{(project.sites ?? (project.site ? [project.site] : [])).map(site => <DeployHistory key={site.id} project={project} site={site} refresh={refresh} />)}</section>
    <Secrets project={project} />
  </>;
}

function LocalDevelopment({project, local, host, refresh}) {
  const [path, setPath] = useState(local?.path ?? '');
  const [baseRef, setBaseRef] = useState(local?.baseRef ?? '');
  const [verify, setVerify] = useState(local?.verify ?? '');
  const [parentPath, setParentPath] = useState('');
  const [directoryName, setDirectoryName] = useState(project.slug);
  const [operationId, setOperationId] = useState(null);
  const [operation, setOperation] = useState(null);
  const [state, write] = useWrite();
  const found = local?.found ?? local?.exists;
  useEffect(() => {
    if (!operationId || !host.projectLocalOperation) return;
    let alive = true, timer;
    const poll = async () => {
      try {
        const next = await host.projectLocalOperation({operationId});
        if (!alive) return;
        setOperation(next);
        if (next.status === 'running') timer = setTimeout(poll, 1200);
        else if (next.status === 'succeeded') void refresh();
      } catch(error) {if (alive) setOperation({status:'failed',error:errorText(error)});}
    };
    void poll();
    return () => {alive = false;clearTimeout(timer);};
  }, [operationId, host, refresh]);
  const cloning = operationId && (!operation || operation.status === 'running');
  const configure = event => {
    event.preventDefault();
    if (!path.trim() || !host.projectConfigureLocal) return;
    void write(async () => {await host.projectConfigureLocal({projectId:project.id,path:path.trim(),baseRef:baseRef.trim(),verify:verify.trim()});void refresh();}, 'Local checkout connected.');
  };
  const clone = event => {
    event.preventDefault();
    if (!parentPath.trim() || cloning || !host.projectCloneLocal) return;
    void write(async () => {setOperation(null);const result = await host.projectCloneLocal({projectId:project.id,parentPath:parentPath.trim(),directoryName:directoryName.trim() || undefined});setOperationId(result.operationId);});
  };
  return <>
    {found && host.projectOpenLocal ? <div className="aw-project__actions"><Button kind="primary" disabled={state.busy} onClick={() => void write(() => host.projectOpenLocal({projectId:project.id,mode:'session'}), 'Development conversation opened.')}>Continue locally</Button><Button disabled={state.busy} onClick={() => void write(() => host.projectOpenLocal({projectId:project.id,mode:'reveal'}))}>Show folder</Button></div> : null}
    {host.projectConfigureLocal ? <details open={!found}><summary>{found ? 'Change checkout & development settings' : 'Connect an existing checkout'}</summary><form onSubmit={configure} className="aw-project__form">
      <Field label="Local folder" hint="An existing folder on this device. Connecting does not clone or overwrite it."><input required value={path} onChange={event => setPath(event.target.value)} placeholder="/Users/you/Projects/site" /></Field>
      <div className="aw-project__fields"><Field label="Base ref" hint="Optional Git ref for review"><input value={baseRef} onChange={event => setBaseRef(event.target.value)} placeholder="main" /></Field><Field label="Verification command" hint="Saved for deliberate local execution"><input value={verify} onChange={event => setVerify(event.target.value)} placeholder="npm test" /></Field></div>
      <Button type="submit" disabled={state.busy || !path.trim() || Boolean(cloning)}>{state.busy ? 'Connecting…' : 'Connect folder'}</Button>
    </form></details> : null}
    {project.repo && host.projectCloneLocal && host.projectLocalOperation ? <details><summary>Clone the linked repository</summary><form onSubmit={clone} className="aw-project__form"><p className="aw-muted">Creates a new folder; an existing destination is never overwritten. Private repositories use the project’s authorized Git connection.</p><Field label="Parent folder"><input required value={parentPath} onChange={event => setParentPath(event.target.value)} placeholder="/Users/you/Projects" /></Field><Field label="New folder name"><input value={directoryName} onChange={event => setDirectoryName(event.target.value)} /></Field><Button type="submit" disabled={state.busy || Boolean(cloning) || !parentPath.trim()}>{cloning ? 'Cloning…' : 'Clone repository'}</Button></form></details> : null}
    {operation ? <p className={operation.status === 'failed' ? 'aw-project__error' : 'aw-muted'} role={operation.status === 'failed' ? 'alert' : 'status'}>{operation.status === 'failed' ? `Clone failed: ${errorText(operation.error)}. Check the destination and Git connection, then retry.` : operation.status === 'succeeded' ? `Clone ready: ${operation.receipt?.path || 'checkout connected'}` : `Cloning: ${operation.phase || 'working'}`}</p> : null}
    <Feedback state={state} />
    {found && host.projectFiles ? <LocalFiles project={project} host={host} /> : null}
    {found && host.gitGraph ? <GitGraph project={project} host={host} /> : <p className="aw-muted">Git Graph is optional. Use your repository, local conversation or recorded work review without it.</p>}
  </>;
}

function LocalFiles({project, host}) {
  const [path, setPath] = useState('');
  const [file, setFile] = useState(null);
  const readEpoch = useRef(0);
  useEffect(() => () => {readEpoch.current++;}, []);
  const navigate = nextPath => {readEpoch.current++;setPath(nextPath);setFile(null);};
  const load = useCallback(() => host.projectFiles({projectId:project.id,action:'list',path}), [host, project.id, path]);
  const [state, refresh] = useProjectResource(load);
  const [readState, write] = useWrite();
  return <details><summary>Browse checkout files</summary><p className="aw-muted">Read-only file preview. Continue locally to edit with the project’s development conversation or your editor.</p><div className="aw-project__actions"><Button size="sm" disabled={!path} onClick={() => navigate(path.split('/').slice(0,-1).join('/'))}>Parent folder</Button><code>{path || '/'}</code><Button size="sm" onClick={refresh}>Refresh files</Button></div>
    <ResourceState state={state} refresh={refresh}><ul className="aw-project__files">{(state.value?.entries ?? []).map(entry => <li key={entry.path}><button type="button" disabled={readState.busy} onClick={() => {if (entry.type === 'directory') {navigate(entry.path);} else {void write(async () => {const epoch = ++readEpoch.current;setFile(null);const result = await host.projectFiles({projectId:project.id,action:'read',path:entry.path,range:{startLine:1,endLine:250}});if (readEpoch.current === epoch) setFile(result);});}}}>{entry.type === 'directory' ? <Icon name="folder" /> : <ProjectIcon name="file" />}{entry.name}{entry.type === 'directory' ? '/' : ''}</button></li>)}</ul>{!state.loading && !state.value?.entries?.length ? <p className="aw-muted">This folder is empty.</p> : null}</ResourceState>
    <Feedback state={readState} />{file ? <div className="aw-project__file"><div className="aw-row-h"><strong>{file.path}</strong><span className="aw-toolbar__fill" /><Button size="sm" onClick={() => {readEpoch.current++;setFile(null);}}>Close preview</Button></div><pre>{file.text}</pre>{file.truncated ? <p className="aw-muted">Showing lines {file.startLine}–{file.endLine}. Open locally to read the full file.</p> : null}</div> : null}
  </details>;
}

function GitGraph({project, host}) {
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => ({available:await host.gitGraph.available()}), [host]);
  const [state, refresh] = useProjectResource(load);
  const graph = host.gitGraph;
  const installed = state.value?.available && typeof graph.View === 'function' && typeof graph.focus === 'function' && typeof graph.sessionId === 'function';
  return <ResourceState state={state} refresh={refresh}>{installed ? <><Button onClick={() => setOpen(true)}>Open Git Graph</Button>{open ? <ProjectGitGraph host={host} project={project} onClose={() => setOpen(false)} /> : null}</> : <p className="aw-muted">Git Graph is not installed. Repository links, local development and work review remain available.</p>}</ResourceState>;
}

function ProjectGitGraph({host, project, onClose}) {
  const load = useCallback(async () => {
    const local = await host.projectLocalInfo({projectId:project.id});
    if (!local?.found || !local.path) throw new Error('Connect a local checkout before opening Git Graph.');
    const sessionId = host.gitGraph.sessionId();
    if (!sessionId) throw new Error('Open a local session, then try Git Graph again.');
    await host.gitGraph.focus({sessionId,repo:local.path});
    return {sessionId};
  }, [host, project.id]);
  const [state, refresh] = useProjectResource(load);
  const View = host.gitGraph.View;
  return <Modal title={`${project.name} · Git Graph`} onClose={onClose} full><div className="aw-review"><ResourceState state={state} refresh={refresh}>{state.value ? <View sessionId={state.value.sessionId} /> : null}</ResourceState></div></Modal>;
}

function DeployHistory({project, site, refresh}) {
  const {api, ask} = useAdmin();
  const load = useCallback(() => api('GET', `${pathFor(project)}/site/deploys?siteId=${encodeURIComponent(site.id)}`), [api, project.id, site.id]);
  const [state, refreshDeploys] = useProjectResource(load);
  const [writeState, write] = useWrite();
  return <details><summary>{site.name || project.name}: deployment history & rollback</summary><ResourceState state={state} refresh={refreshDeploys}>{(state.value?.deploys ?? []).length ? <ul className="aw-project__work">{state.value.deploys.map(deploy => <li key={deploy.id}><div><strong>{deploy.id}</strong><span className="aw-muted">{deploy.branch || deploy.kind || 'Recorded deploy'}{deploy.created_at ? ` · ${ago(deploy.created_at)}` : ''}</span></div><Button disabled={writeState.busy} size="sm" onClick={() => ask({title:'Roll production back?',text:`Replace ${site.productionUrl || site.name || project.name} with recorded deploy ${deploy.id}. This changes what visitors see.`,confirm:'Roll back',run:() => write(async () => {await api('POST', `${pathFor(project)}/site/rollback`, {deployId:deploy.id,siteId:site.id});void refresh();void refreshDeploys();}, 'Production rolled back.')})}>Roll back</Button></li>)}</ul> : <p className="aw-muted">No recorded deployments yet.</p>}</ResourceState><Feedback state={writeState} /></details>;
}

function Work({project}) {
  const {data, setModal} = useAdmin();
  const tickets = projectWork(data.tickets, project.id);
  return <section className="aw-project__section"><div className="aw-row-h"><h3>Project work</h3><span className="aw-toolbar__fill" /><Button kind="primary" onClick={() => setModal({kind:'task',projectId:project.id})}>Add work</Button></div><p className="aw-muted">Save a draft for later, queue an agent deliberately, or continue the same work locally. Open a request for its conversation and evidence.</p><WorkList tickets={tickets} />{!tickets.length ? <p className="aw-project__empty">No work yet. Add the first outcome you want to deliver.</p> : null}</section>;
}

function WorkList({tickets}) {
  const {openTicket} = useAdmin();
  return <ul className="aw-project__work">{tickets.map(ticket => <li key={ticket.id}><button type="button" className="aw-project__worklink" onClick={() => openTicket(ticket.id)}><span className="aw-mono">#{ticket.id}</span><strong>{ticket.title}</strong>{ticket.updated_at ? <span className="aw-muted">{ago(ticket.updated_at)}</span> : null}</button><StatusPill status={ticket.status} /></li>)}</ul>;
}

function Activity({project}) {
  const {data, openTicket} = useAdmin();
  const tickets = projectWork(data.tickets, project.id);
  const ids = new Set(tickets.map(ticket => String(ticket.id)));
  const runs = [...(data.running ?? []),...(data.recent ?? [])].filter((run,index,all) => ids.has(String(run.ticket_id)) && all.findIndex(other => other.id === run.id) === index).sort((a,b) => (b.started_at ?? b.created_at ?? 0) - (a.started_at ?? a.created_at ?? 0));
  return <section className="aw-project__section"><h3>Activity & review</h3><p className="aw-muted">Recent recorded attempts are listed below. Open a request to select any historical run and inspect its changes, checks and agent session. Missing checks mean unknown, not passing.</p>{runs.length ? <ul className="aw-project__work">{runs.map(run => <li key={run.id}><div className="aw-project__run"><button type="button" className="aw-link" onClick={() => openTicket(run.ticket_id)}>#{run.ticket_id} · {tickets.find(ticket => String(ticket.id) === String(run.ticket_id))?.title}</button><span className="aw-mono">Run {run.id}</span><span className="aw-muted">{run.executor || 'Agent'} · {run.started_at ? ago(run.started_at) : 'Start time unknown'} · checks available in request review</span></div><StatusPill status={run.status} /><Button size="sm" onClick={() => openTicket(run.ticket_id)}>Inspect attempts</Button></li>)}</ul> : <p className="aw-project__empty">No recent agent attempts. Older evidence, when available, remains inside each request.</p>}<h3 className="aw-project__subheading">Requests with history</h3><WorkList tickets={tickets} /></section>;
}

function People({project, refresh}) {
  const {api, data, ask} = useAdmin();
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
  const grant = event => {event.preventDefault();if (!email.trim() || !admin) return;void write(async () => {await api('POST', `${pathFor(project)}/memberships`, {email:email.trim()});setEmail('');void refreshPeople();void refreshRecipients();void refresh();}, 'Trusted project access granted.');};
  return <>
    <section className="aw-project__section"><h3>Project ownership</h3><p>{state.value?.ownerUserId ? `Owned by ${ownerPerson?.name || ownerPerson?.email || state.value.ownerUserId}.` : 'An owner has not been verified for this project.'}</p><p className="aw-muted">The client owns the project and can act independently. Agent help and agency support are optional.</p></section>
    <section className="aw-project__section"><h3>Trusted developers</h3><p className="aw-muted">Trusted developers can work across the project: context, integrations, configuration, code and deployments. Access does not extend to other projects or global administration.</p><ResourceState state={state} refresh={refreshPeople}><ul className="aw-project__work">{(state.value?.memberships ?? []).map(person => <li key={person.userId}><div><strong>{person.name || person.email}</strong>{person.name ? <span className="aw-muted">{person.email}</span> : null}<Tag>Trusted developer</Tag></div>{admin || owner ? <Button size="sm" disabled={writeState.busy} onClick={() => ask({title:`Remove ${person.email} from this project?`,text:'Their trusted access ends immediately. Their account and access to other projects stay unchanged.',confirm:'Remove access',danger:true,run:() => write(async () => {await api('DELETE', `${pathFor(project)}/memberships/${encodeURIComponent(person.userId)}`);void refreshPeople();void refreshRecipients();}, 'Trusted access removed.')})}>Remove access</Button> : null}</li>)}</ul>{!state.value?.memberships?.length ? <p className="aw-muted">No trusted developers assigned.</p> : null}</ResourceState>
      {admin ? <form onSubmit={grant} className="aw-project__invite"><Field label="Existing account email"><input type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></Field><Button type="submit" disabled={writeState.busy || !email.trim()}>{writeState.busy ? 'Granting…' : 'Grant project access'}</Button></form> : <p className="aw-muted">A workspace administrator can grant trusted developer access.{owner ? ' As project owner, you can remove it.' : ''}</p>}<Feedback state={writeState} />
    </section>
    <section className="aw-project__section"><h3>Client participants</h3>{admin ? <ProjectPeople project={project} /> : <ul className="aw-project__work">{(state.value?.clients ?? project.clients ?? []).map(person => <li key={person.id}><div><strong>{person.name || person.email}</strong>{person.name ? <span className="aw-muted">{person.email}</span> : null}</div></li>)}</ul>}<p className="aw-muted">Client participation is separate from trusted developer access. Select recipients in a work conversation to notify them; typed @names alone do not send notifications.</p></section>
    <section className="aw-project__section"><h3>Conversation recipients</h3><ResourceState state={recipients} refresh={refreshRecipients}><ul className="aw-project__work">{(recipients.value?.recipients ?? []).map(person => <li key={person.userId}><div><strong>{person.name || person.email}</strong>{person.name ? <span className="aw-muted">{person.email}</span> : null}</div><Tag>{person.memberType === 'trusted_developer' ? 'Trusted developer' : 'Client'}</Tag></li>)}</ul>{!recipients.value?.recipients?.length ? <p className="aw-muted">No eligible recipients returned. Recipient selection is available inside a saved work conversation.</p> : null}</ResourceState></section>
  </>;
}

function Secrets({project}) {
  const {api, ask} = useAdmin();
  const [opened, setOpened] = useState(false);
  // Metadata loads only when this deliberate access surface is opened.
  return <section className="aw-project__section"><h3>Project secrets</h3><p className="aw-muted">Values stay hidden until you deliberately reveal one. Never paste secrets into work briefs, agent conversations or screenshots.</p>{opened ? <SecretManager key={project.id} project={project} api={api} ask={ask} onClose={() => setOpened(false)} /> : <Button onClick={() => setOpened(true)}>Manage project secrets</Button>}</section>;
}

function SecretManager({project, api, ask, onClose}) {
  const load = useCallback(() => api('GET', `${pathFor(project)}/secrets`), [api, project.id]);
  const [state, refresh] = useProjectResource(load);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [revealed, setRevealed] = useState(null);
  const [writeState, write] = useWrite();
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => {alive.current = true;return () => {alive.current = false;clearTimeout(timer.current);};}, []);
  const hide = () => {clearTimeout(timer.current);setRevealed(null);};
  const save = event => {event.preventDefault();if (!name.trim() || !value) return;void write(async () => {await api('PUT', `${pathFor(project)}/secrets/${encodeURIComponent(name.trim())}`, {value});setValue('');setName('');hide();void refresh();}, 'Secret saved.');};
  return <>
    <div className="aw-project__actions"><Button size="sm" onClick={onClose}>Close secrets</Button></div>
    <ResourceState state={state} refresh={refresh}><ul className="aw-project__work">{(state.value?.secrets ?? []).map(secret => <li key={secret.name}><code>{secret.name}</code><span className="aw-toolbar__fill" /><Button size="sm" disabled={writeState.busy} onClick={() => void write(async () => {hide();const result = await api('POST', `${pathFor(project)}/secrets/${encodeURIComponent(secret.name)}/reveal`, {});if (!alive.current) return;setRevealed({name:secret.name,value:result.value});timer.current = setTimeout(() => setRevealed(null), 30_000);})}>Reveal</Button><Button size="sm" disabled={writeState.busy} onClick={() => ask({title:`Delete ${secret.name}?`,text:'Project operations that depend on this secret may stop working. This cannot be undone.',confirm:'Delete secret',danger:true,run:() => write(async () => {await api('DELETE', `${pathFor(project)}/secrets/${encodeURIComponent(secret.name)}`);hide();void refresh();}, 'Secret deleted.')})}>Delete</Button></li>)}</ul>{!state.value?.secrets?.length ? <p className="aw-muted">No project secrets stored.</p> : null}</ResourceState>
    {revealed ? <div className="aw-project__reveal"><strong>{revealed.name}</strong><p className="aw-muted">Visible for 30 seconds. Hide it before sharing this screen.</p><pre>{revealed.value}</pre><Button size="sm" onClick={hide}>Hide value</Button></div> : null}
    <form onSubmit={save} className="aw-project__form"><Field label="Secret name"><input required autoComplete="off" maxLength={128} value={name} onChange={event => setName(event.target.value)} /></Field><Field label="New value" hint="An existing name replaces that secret’s value."><input type="password" required autoComplete="new-password" value={value} onChange={event => setValue(event.target.value)} /></Field><Button type="submit" disabled={writeState.busy || !name.trim() || !value}>{writeState.busy ? 'Saving…' : 'Set secret'}</Button></form>
    <Feedback state={writeState} />
  </>;
}
