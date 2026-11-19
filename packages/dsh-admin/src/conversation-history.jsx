import { useEffect, useState } from 'react';
import { useTicket } from '../../admin-ui/src/store.js';
import { errorText, when } from '../../admin-ui/src/format.js';
import { groupByDay, historyEntryType, loadProjectTicketHistory, taskHistoryEvents } from './conversation-history.mjs';

const clock = (unix) => (unix ? new Date(unix * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

export function ConversationHistory({ api, ticketId, openTicket }) {
  const [{ ticket, messages, runs, loading, error }, reload] = useTicket(api, ticketId);
  const [mode, setMode] = useState('task');
  const projectId = ticket?.project_id;
  const scope = projectId == null ? 'No project' : ticket.project_name || `Project #${projectId}`;
  return (
    <section aria-label="History" className="pta-hist">
      <div className="pta-hist__bar">
        <div role="group" aria-label="History scope" className="pta-seg">
          <button type="button" aria-pressed={mode === 'task'} onClick={() => setMode('task')}>Task #{ticketId}</button>
          <button type="button" aria-pressed={mode === 'project'} onClick={() => setMode('project')} title={scope}>Project</button>
        </div>
        {(mode === 'task' || loading || error) && <button type="button" className="pta-hist__reload" onClick={reload} title="Reload task history">↻ Reload</button>}
      </div>
      {error ? <p role="alert">Could not load task history. {errorText(error)}</p> : loading && !ticket ? (
        <p role="status">Loading task history…</p>
      ) : !ticket ? <p>No task history is available.</p> : mode === 'task' ? (
        <TaskEvents messages={messages} runs={runs} />
      ) : projectId == null || projectId === '' ? (
        <p>This task is not linked to a project.</p>
      ) : (
        <ProjectTickets key={String(projectId)} api={api} projectId={projectId} scope={scope} openTicket={openTicket} />
      )}
    </section>
  );
}

function TaskEvents({ messages, runs }) {
  const entries = taskHistoryEvents(messages, runs);
  if (!entries.length) return <p className="pta-hist__empty">No task events or runs yet.</p>;
  return groupByDay(entries).map(group => (
    <section key={group.label} className="pta-hist__day" aria-label={group.label}>
      <h3>{group.label}</h3>
      <ol>
        {group.entries.map(entry => {
          const { type, title, detail } = historyEntryType(entry);
          return (
            <li key={`${entry.kind}-${entry.item.id}`} className="pta-hist__item" data-type={type} data-status={type === 'status' ? title.toLowerCase() : undefined}>
              <time title={when(entry.at)}>{clock(entry.at)}</time>
              <span className="pta-hist__dot" aria-hidden="true" />
              <span className="pta-hist__text">
                {type === 'status' ? <>Status → <strong>{title}</strong></> : <strong>{title}</strong>}
                {detail ? <span className="pta-hist__detail">{type === 'run' ? ` · ${detail}` : ` ${detail}`}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  ));
}

function ProjectTickets({ api, projectId, scope, openTicket }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  useEffect(() => {
    let live = true;
    loadProjectTicketHistory(api, projectId).then(
      tickets => { if (live) setResult({ api, projectId, revision, tickets }); },
      error => { if (live) setResult({ api, projectId, revision, error }); },
    );
    return () => { live = false; };
  }, [api, projectId, revision]);
  const current = result?.api === api && result.projectId === projectId && result.revision === revision ? result : null;
  return (
    <>
      <div className="pta-hist__bar">
        <h3 className="pta-hist__scope">Recent tickets in {scope}</h3>
        <button type="button" className="pta-hist__reload" onClick={() => setRevision(value => value + 1)}>↻ Reload project</button>
      </div>
      {!current ? <p role="status">Loading project tickets…</p> : current.error ? (
        <p role="alert">Could not load project tickets. {errorText(current.error)}</p>
      ) : !current.tickets.length ? <p>No recent tickets in this project.</p> : (
        <ul className="pta-hist__tickets">
          {current.tickets.map(ticket => (
            <li key={ticket.id}>
              <button type="button" onClick={() => openTicket(ticket)}>
                <span className="pta-hist__tid">#{ticket.id}</span>
                <span className="pta-hist__ttitle">{ticket.title_en || ticket.title}</span>
                {ticket.status ? <span className="pta-hist__tstatus">{ticket.status.replace(/_/g, ' ')}</span> : null}
                <time>{when(ticket.updated_at)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
