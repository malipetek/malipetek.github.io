/*
 * Settings → "This machine's tools".
 *
 * The agent skills and MCP servers on the admin's own machine — the ones fleet
 * agents (Claude Code, OpenCode, the Harness) actually read. Listing is the
 * main job; adding, disabling and removing each write through the Host half
 * (`/admin toolbox …`), which keeps a timestamped backup of the file.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from './store.js';
import { Button, Dot, Field, Modal, Segmented, Tag, cx } from './ui.jsx';

const TARGETS = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
];

const CONNECTIONS = [
  { value: 'command', label: 'Command' },
  { value: 'url', label: 'URL' },
];

const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const enabled = (server) => !server.disabled && server.enabled !== false;

/** One MCP server: where it is, whether it is on, and the two edits. */
function ServerRow({ server, target, busy, onToggle, onRemove }) {
  const on = enabled(server);
  const env = [...(server.envKeys ?? []), ...(server.headerKeys ?? [])];
  return (
    <li className={cx('aw-toolbox__row', !on && 'is-off')}>
      <Dot state={on ? 'ok' : 'warn'} />
      <div className="aw-toolbox__main">
        <div className="aw-toolbox__title">
          <strong>{server.name}</strong>
          <Tag tone="dash">{server.type}</Tag>
          {on ? null : <Tag tone="warn">off</Tag>}
        </div>
        <div className="aw-toolbox__meta aw-mono" title={server.command ?? server.url ?? ''}>
          {server.command ? `${server.command}${server.args?.length ? ` ${server.args.join(' ')}` : ''}` : server.url}
        </div>
        {env.length > 0 ? <div className="aw-toolbox__meta">secrets set: {env.join(', ')} (values stay off this page)</div> : null}
      </div>
      <div className="aw-toolbox__actions">
        <Button size="sm" disabled={busy} onClick={() => onToggle(target, server.name, !on)}>
          {on ? 'Disable' : 'Enable'}
        </Button>
        <Button size="sm" kind="ghost" disabled={busy} onClick={() => onRemove(target, server.name)}>
          Remove
        </Button>
      </div>
    </li>
  );
}

function ServerList({ servers, target, busy, onToggle, onRemove }) {
  if (!servers.length) return <p className="aw-muted">No MCP servers.</p>;
  return (
    <ul className="aw-toolbox__rows">
      {servers.map((server) => (
        <ServerRow key={server.name} server={server} target={target} busy={busy} onToggle={onToggle} onRemove={onRemove} />
      ))}
    </ul>
  );
}

/** A skill's name, where it comes from, and what it is for. */
function SkillList({ skills }) {
  if (!skills.length) return <p className="aw-muted">No skills.</p>;
  return (
    <ul className="aw-toolbox__skills">
      {skills.map((skill) => (
        <li key={skill.path} title={skill.path}>
          <div className="aw-toolbox__title">
            <strong>{skill.name}</strong>
            <Tag tone="dash">{skill.source}</Tag>
          </div>
          {skill.description ? (
            <p className="aw-toolbox__skilldesc">{skill.description}</p>
          ) : (
            <p className="aw-muted">No description.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The small "Add MCP server" form: a command+args, or a URL. */
function AddMcpModal({ busy, onClose, onSubmit }) {
  const [target, setTarget] = useState('claude');
  const [name, setName] = useState('');
  const [connection, setConnection] = useState('command');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const valid = NAME_RE.test(name.trim()) && (connection === 'command' ? command.trim().length > 0 : /^https?:\/\//.test(url.trim()));
  const submit = async () => {
    if (!valid || busy) return;
    const payload = { target, name: name.trim() };
    if (connection === 'command') {
      payload.command = command.trim();
      payload.args = args.trim() ? args.trim().split(/\s+/) : [];
    } else {
      payload.url = url.trim();
    }
    setError('');
    const ok = await onSubmit(payload);
    if (!ok) setError('The server was not added; the message above says why.');
  };

  return (
    <Modal
      title="Add MCP server"
      subtitle="Written to the config the fleet agents read on this machine."
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!valid || busy} onClick={submit}>
            Add
          </Button>
        </>
      }
    >
      <Field label="For">
        <Segmented value={target} options={TARGETS} onChange={setTarget} />
      </Field>
      <Field label="Name" hint="Letters, digits, dots, dashes and underscores; up to 64 characters.">
        <input value={name} placeholder="my-server" onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Connection">
        <Segmented value={connection} options={CONNECTIONS} onChange={setConnection} />
      </Field>
      {connection === 'command' ? (
        <>
          <Field label="Command">
            <input value={command} placeholder="npx" onChange={(event) => setCommand(event.target.value)} />
          </Field>
          <Field label="Arguments" hint="Space-separated.">
            <input value={args} placeholder="-y some-mcp-server" onChange={(event) => setArgs(event.target.value)} />
          </Field>
        </>
      ) : (
        <Field label="URL" hint="http or https.">
          <input value={url} placeholder="https://mcp.example.com/mcp" onChange={(event) => setUrl(event.target.value)} />
        </Field>
      )}
      {error ? <p className="aw-warn">{error}</p> : null}
    </Modal>
  );
}

/**
 * Settings panel for the desktop app’s local machine.
 */
export function ToolboxPanel() {
  const { host, platform, notify, ask } = useAdmin();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (platform !== 'dsh' || !host) return;
    try {
      setData(await host.json('toolbox list'));
      setError('');
    } catch (failure) {
      setError(failure.message);
    }
  }, [host, platform]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Send one toolbox edit; the answer carries the whole refreshed list. */
  const apply = async (line) => {
    if (!host) return false;
    setBusy(true);
    try {
      const result = await host.json(line);
      if (result?.list) setData(result.list);
      else await load();
      notify(result?.changed === false ? 'Already in that state.' : 'Saved.', 'ok');
      return true;
    } catch (failure) {
      notify(failure.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = (target, name, on) => void apply(`toolbox toggle-mcp ${JSON.stringify({ target, name, enabled: on })}`);
  const remove = (target, name) =>
    ask({
      title: `Remove ${name}?`,
      text: 'Fleet agents on this machine stop seeing it. The config keeps a timestamped backup.',
      confirm: 'Remove',
      danger: true,
      run: () => void apply(`toolbox remove-mcp ${JSON.stringify({ target, name })}`),
    });

  if (platform !== 'dsh' || !host) return null;

  return (
    <div className="aw-toolbox">
      <div className="aw-toolbox__head">
        <p className="aw-muted">Fleet agents on this machine use these.</p>
        <span className="aw-toolbar__fill" />
        <Button size="sm" kind="primary" disabled={busy || !data} onClick={() => setAdding(true)}>
          Add MCP server
        </Button>
      </div>
      {error ? <div className="aw-inline">
        <p className="aw-warn" role="alert">Could not read the toolbox: {error}</p>
        <Button size="sm" onClick={() => void load()}>Retry</Button>
      </div> : null}
      {!data && !error ? <p className="aw-muted">Reading…</p> : null}
      {data?.warnings?.length ? (
        <ul className="aw-toolbox__warnings">
          {data.warnings.map((warning) => (
            <li key={warning} className="aw-warn">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      {data ? (
        <>
          <section className="aw-toolbox__section">
            <h4>Claude Code</h4>
            <ServerList servers={data.claude?.mcp ?? []} target="claude" busy={busy} onToggle={toggle} onRemove={remove} />
            <h5 className="aw-toolbox__subhead">Skills</h5>
            <SkillList skills={data.claude?.skills ?? []} />
          </section>
          <section className="aw-toolbox__section">
            <h4>OpenCode</h4>
            {data.opencode?.configPath ? (
              <p className="aw-toolbox__meta aw-mono" title={data.opencode.configPath}>
                {data.opencode.configPath}
              </p>
            ) : (
              <p className="aw-muted">No config file yet; adding a server creates one.</p>
            )}
            <ServerList servers={data.opencode?.mcp ?? []} target="opencode" busy={busy} onToggle={toggle} onRemove={remove} />
          </section>
          <section className="aw-toolbox__section">
            <h4>Harness</h4>
            {data.harness?.plugins?.length ? (
              <ul className="aw-toolbox__plugins">
                {data.harness.plugins.map((plugin) => (
                  <li key={plugin.path} className="aw-toolbox__plugin" title={plugin.path}>
                    <strong>{plugin.name}</strong>
                    <Tag tone="dash">{plugin.linked ? 'symlink' : 'directory'}</Tag>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="aw-muted">No plugins in ~/.dsh/plugins.</p>
            )}
          </section>
        </>
      ) : null}
      {adding ? (
        <AddMcpModal
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={async (payload) => {
            const ok = await apply(`toolbox add-mcp ${JSON.stringify(payload)}`);
            if (ok) setAdding(false);
            return ok;
          }}
        />
      ) : null}
    </div>
  );
}
