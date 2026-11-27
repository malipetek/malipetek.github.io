/*
 * What kind of work a project is, and the client accounts that work needs.
 * The kinds (the Worker's "solutions") save as they are chosen; each
 * connection's state comes from GET /admin/projects/:id/integrations, and the
 * Worker verifies a connected one on demand. The catalog mirrors the Worker's
 * (solutions.js), so the chips render even before /admin/settings answers —
 * and for a trusted developer, who never gets the settings catalog at all.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAdmin } from './store.js';
import { SOLUTION_CATALOG, INTEGRATION_CATALOG } from './solutions.js';
import { ago, errorText } from './format.js';
import { Button, Chips, Dot, ErrorNote, Field, Modal, Tag } from './ui.jsx';

const pathFor = (project) => `/admin/projects/${encodeURIComponent(project.id)}`;

/** Where the client pastes the values; the copy steps point here. */
export const CLIENT_PORTAL_URL = 'https://ptechsolutions.net/portal';

/** Short names for the header tags, where the full labels are too wide. */
const SHORT = {
  web: 'Web', shopify: 'Shopify', 'mobile-ios': 'iOS', 'mobile-android': 'Android',
  'mobile-cross': 'Cross-platform', 'app-release': 'Store release', server: 'Server',
  aws: 'AWS', gcp: 'GCP', 'ai-workspace': 'AI workspace',
};

const list = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);

/**
 * Capabilities named the way a person says them, so the fleet note never leaks
 * machine ids like "os:macos". The live catalog's label wins when present.
 */
const REQUIRE_WORDS = {
  'os:macos': 'a Mac', 'os:linux': 'Linux', 'xcode': 'Xcode', 'android': 'Android',
  docker: 'Docker', gpu: 'a GPU', 'always-on': 'an always-on machine', sandbox: 'a sandbox',
};
const requirementWords = (requires, catalog) => {
  const catalogLabel = (id) => catalog?.capabilities?.find((c) => c.id === id)?.label;
  return requires.map((id) => REQUIRE_WORDS[id] ?? catalogLabel(id) ?? id);
};
const requirementText = (words) =>
  words.length > 1 ? `${words[0]} with ${words.slice(1).join(' and ')}` : String(words[0] ?? '');
const machineText = (nodes, state = 'online') => {
  const names = nodes.map((n) => n.id).join(' or ');
  return `${names} ${nodes.length > 1 ? 'are' : 'is'} ${state}`;
};

const VERIFY_ERRORS = {
  missing_fields: 'values are still missing',
  verification_failed: 'verification failed',
  credentials_changed: 'the values changed during the check',
  secrets_unavailable: 'the secret store is unavailable',
};
const verifyText = (error) => VERIFY_ERRORS[error] ?? error ?? 'verification failed';

/*
 * One snapshot per project, shared by every mount (the section on the People
 * tab today, anything else later): the rows load once, a verify refreshes
 * them, and a static render reads whatever is already there.
 */
const IDLE = { loaded: false, integrations: null, error: null };
const psolStore = {
  byProject: new Map(),
  listeners: new Set(),
  inflight: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  snapshot(id) {
    return this.byProject.get(String(id)) ?? IDLE;
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
  async load(api, id) {
    const key = String(id);
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const value = await api('GET', `/admin/projects/${encodeURIComponent(key)}/integrations`);
      this.byProject.set(key, { loaded: true, integrations: value?.integrations ?? [], error: null });
    } catch (error) {
      const previous = this.byProject.get(key) ?? IDLE;
      this.byProject.set(key, { ...previous, loaded: true, error });
    } finally {
      this.inflight.delete(key);
    }
    this.emit();
  },
};

/** The test seam: project-solutions.test.mjs seeds the rows to render each state. */
export const __psolStore = psolStore;

const dotState = (row) =>
  !row.connected && row.required ? 'bad'
    : row.verifiedAt && !row.verifyError ? 'ok'
      : row.verifyError || row.connected ? 'warn'
        : 'muted';

/**
 * The kinds of work, the fleet note, the connections and the client-facing
 * copy for one project. Compact by design: chips, one line about the fleet,
 * one row per connection, and the deliverables folded away.
 */
export function ProjectSolutions({ project }) {
  const { api, data, notify, reload } = useAdmin();
  const id = String(project.id);
  const catalog = data?.catalog;
  const solutionsCatalog = catalog?.solutions?.length ? catalog.solutions : SOLUTION_CATALOG;
  const integrationsCatalog = catalog?.integrations?.length ? catalog.integrations : INTEGRATION_CATALOG;
  const solutionById = new Map(solutionsCatalog.map((s) => [s.id, s]));
  const integrationById = new Map(integrationsCatalog.map((i) => [i.id, i]));

  const [selected, setSelected] = useState(() => list(project.solutions));
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(null);
  const [entering, setEntering] = useState(null);

  // The project object is re-fetched on every reload; follow the server's
  // kinds unless a save of ours is still in flight.
  const serverIds = list(project.solutions);
  const localKey = selected.join('\n');
  const serverKey = serverIds.join('\n');
  useEffect(() => {
    if (!busy && localKey !== serverKey) setSelected(serverIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, localKey, serverKey]);

  const subscribe = useCallback((listener) => psolStore.subscribe(listener), []);
  const read = useCallback(() => psolStore.snapshot(id), [id]);
  const status = useSyncExternalStore(subscribe, read, read);
  const refreshStatus = useCallback(() => void psolStore.load(api, id), [api, id]);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const choose = (next) => {
    if (busy) return;
    const previous = selected;
    setSelected(next);
    setBusy(true);
    api('PUT', `${pathFor(project)}/solutions`, { solutions: next })
      .then(() => {
        notify('Kinds of work saved.');
        void reload?.();
        void refreshStatus();
      }, (error) => {
        setSelected(previous);
        notify(errorText(error), 'error');
      })
      .finally(() => setBusy(false));
  };

  const verify = (row) => {
    if (verifying) return;
    setVerifying(row.id);
    api('POST', `${pathFor(project)}/integrations/${encodeURIComponent(row.id)}/verify`)
      .then((out) => notify(
        out?.ok ? `${row.label}: ${out.detail ?? 'verified'}` : `${row.label}: ${verifyText(out?.error)}`,
        out?.ok ? 'ok' : 'error',
      ))
      .catch((error) => notify(errorText(error), 'error'))
      .finally(() => {
        setVerifying(null);
        void refreshStatus();
      });
  };

  const copySteps = async (entry) => {
    try {
      await navigator.clipboard.writeText(clientStepsText(project, entry));
      notify(`${entry.label} client steps copied.`);
    } catch {
      notify('Could not copy. Open Connect values and read the steps from there.', 'error');
    }
  };

  const chosen = selected.map((sid) => solutionById.get(sid)).filter(Boolean);
  // OAuth-covered vendors (GitHub, Cloudflare) never appear here; only a
  // chosen kind of work that still needs a pasted credential shows a block.
  const needsManual = chosen.some((s) => (s.integrations ?? []).length);
  const requires = [...new Set(chosen.flatMap((s) => s.requires ?? []))];
  const fleetKnown = data?.access?.superAdmin === true;
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const canBuild = (node) => requires.every((r) => (node.capabilities ?? []).includes(r));
  const capable = requires.length ? nodes.filter((node) => node.online && canBuild(node)) : [];
  const offlineCapable = requires.length ? nodes.filter((node) => !node.online && canBuild(node)) : [];
  const needsText = requirementText(requirementWords(requires, catalog?.capabilities));
  const fleetNote = !requires.length ? null : capable.length
    ? <p className="aw-psol__fleet">Needs {needsText} · {machineText(capable)}.</p>
    : fleetKnown
      ? <p className="aw-psol__fleet aw-psol__fleet--warn">Needs {needsText} · no online machine can build it yet{offlineCapable.length ? ` — ${machineText(offlineCapable, 'offline')}` : ''}.</p>
      : <p className="aw-psol__fleet">Needs {needsText}.</p>;

  const rows = status.integrations;
  return <div className="aw-psol">
    <p className="aw-psol__h">Kind of work</p>
    <Chips value={selected} options={solutionsCatalog.map((s) => ({ value: s.id, label: s.label, hint: s.summary }))} onChange={choose} disabled={busy} />
    {fleetNote}
    {needsManual || rows?.length ? (
      <>
        <p className="aw-psol__h">Connections</p>
        {status.error
          ? <ErrorNote error={status.error} onRetry={refreshStatus} />
          : null}
        {rows === null || rows === undefined
          ? <div className="aw-psol__skel" role="status" aria-label="Loading connections…"><span className="aw-sr-only">Loading connections…</span><span aria-hidden="true" /><span aria-hidden="true" /></div>
          : !rows.length && !status.error
            ? <p className="aw-muted">No connections needed for the chosen kinds.</p>
            : <ul className="aw-psol__rows">
            {rows.map((row) => {
              const entry = integrationById.get(row.id);
              const needsAction = !row.connected && row.required;
              return <li className="aw-psol__row" key={row.id}>
                <Dot state={dotState(row)} />
                <div className="aw-psol__rowmain">
                  <strong>{row.label}</strong>
                  {entry?.vendor ? <span className="aw-muted">{entry.vendor}</span> : null}
                  <Tag tone={row.required ? undefined : 'dash'}>{row.required ? 'required' : 'optional'}</Tag>
                  {row.missing?.length ? <span className="aw-psol__miss">needs {row.missing.join(', ')}</span> : null}
                  {row.verifyError
                    ? <span className="aw-psol__err">{verifyText(row.verifyError)}</span>
                    : row.verifiedAt ? <span className="aw-muted">verified {ago(row.verifiedAt)} ago</span> : null}
                </div>
                <div className="aw-psol__rowact">
                  {entry ? <Button size="sm" kind={needsAction ? 'primary' : 'default'} onClick={() => setEntering(entry)}>Connect values</Button> : null}
                  <Button size="sm" disabled={verifying === row.id} onClick={() => verify(row)}>{verifying === row.id ? 'Verifying…' : 'Verify'}</Button>
                  {entry ? <button type="button" className="aw-link aw-psol__copy" onClick={() => void copySteps(entry)}>Copy client steps</button> : null}
                </div>
              </li>;
            })}
          </ul>}
      </>
    ) : null}
    {chosen.length ? (
      <details className="aw-psol__brief">
        <summary>What we deliver / ask the client</summary>
        {chosen.map((s) => <div className="aw-psol__briefitem" key={s.id}>
          <strong>{s.label}</strong>
          <p className="aw-psol__h">We deliver</p>
          <ul>{(s.deliverables ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
          <p className="aw-psol__h">We ask</p>
          <ul>{(s.questions ?? []).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>)}
      </details>
    ) : null}
    {entering ? <IntegrationFieldsModal project={project} entry={entering} onClose={() => setEntering(null)} onSaved={refreshStatus} /> : null}
  </div>;
}

/** The project's kinds of work as compact tags, for the header and list rows. */
export function SolutionTags({ solutions, catalog }) {
  const ids = list(solutions);
  if (!ids.length) return null;
  // The live catalog wins over the static one; labels and hints stay current.
  const entries = Array.isArray(catalog) && catalog.length ? catalog : SOLUTION_CATALOG;
  return <span className="aw-psol__tags">{ids.map((id) => {
    const entry = entries.find((s) => s.id === id);
    return <Tag key={id} title={entry?.label ?? id}>{SHORT[id] ?? entry?.label ?? id}</Tag>;
  })}</span>;
}

/** The plain-text message to send a client: the steps, then where to paste them. */
export function clientStepsText(project, entry) {
  return [
    `${entry.label} access for “${project.name}”`,
    '',
    ...entry.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    `Then open ${CLIENT_PORTAL_URL} and pick “${project.name}”: its ${entry.label} section takes these values. Paste each one where its label matches.`,
  ].join('\n');
}

/**
 * The admin's side of a connection: the setup steps, the vendor's docs, and
 * one input per field. Only the fields actually typed are written, each
 * through the existing project secrets API, exactly where the client's own
 * portal writes land.
 */
export function IntegrationFieldsModal({ project, entry, onClose, onSaved }) {
  const { api, notify } = useAdmin();
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const filled = entry.fields.filter((field) => String(values[field.name] ?? '').trim());
  const save = () => {
    if (busy || !filled.length) return;
    setBusy(true);
    Promise.all(filled.map((field) => api('PUT', `${pathFor(project)}/secrets/${encodeURIComponent(field.name)}`, { value: String(values[field.name]).trim() })))
      .then(() => {
        notify(`${entry.label} values saved.`);
        onSaved?.();
        onClose();
      })
      .catch((error) => {
        notify(errorText(error), 'error');
        setBusy(false);
      });
  };
  const edit = (field) => (event) => setValues({ ...values, [field.name]: event.target.value });
  return (
    <Modal kind="create"
      title={`Connect ${entry.label} values`}
      subtitle={entry.scope}
      onClose={onClose}
      actions={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="primary" disabled={busy || !filled.length} onClick={save}>
          {busy ? 'Saving…' : filled.length ? `Save ${filled.length} value${filled.length === 1 ? '' : 's'}` : 'Save'}
        </Button>
      </>}
    >
      <ol className="aw-psol__steps">{entry.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <p className="aw-muted"><a href={entry.docs} target="_blank" rel="noreferrer">{entry.docs}</a></p>
      {entry.fields.map((field) => (
        <Field key={field.name} label={`${field.label}${field.optional ? ' (optional)' : ''}`} hint={field.secret ? 'Stored encrypted with the project; never displayed again.' : null}>
          {field.multiline
            ? <textarea rows={4} placeholder={field.placeholder ?? ''} value={values[field.name] ?? ''} onChange={edit(field)} />
            : <input type={field.secret ? 'password' : 'text'} autoComplete="off" placeholder={field.placeholder ?? ''} value={values[field.name] ?? ''} onChange={edit(field)} />}
        </Field>
      ))}
    </Modal>
  );
}
