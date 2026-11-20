import {useEffect, useState} from 'react';
import {Button} from './ui.jsx';
import {visibleRecipients} from './mention-delivery.js';

/** Explicit project identities only. No free-text addresses or global people search. */
export function MentionRecipients({api, projectId, onChange, disabled = false, internal = false}) {
  // Folded away until asked for: the composer stays short, and the people are
  // fetched on the first expand rather than on every page of the ticket.
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({projectId:null, internal:null, recipients:[], loading:true, error:false});
  const [selected, setSelected] = useState([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open) return () => {};
    let alive = true;
    setSelected([]);
    onChange([]);
    setState({projectId, internal, recipients:[], loading:true, error:false});
    if (!projectId) {setState({projectId, internal, recipients:[], loading:false, error:false}); return () => {alive=false;};}
    Promise.resolve().then(() => api('GET', `/admin/projects/${encodeURIComponent(projectId)}/recipients`)).then(result => {
      if (alive) setState({projectId, internal, recipients:visibleRecipients(result.recipients || [], internal), loading:false, error:false});
    }, () => {if (alive) setState({projectId, internal, recipients:[], loading:false, error:true});});
    return () => {alive=false;};
  }, [api, projectId, internal, version, open]);
  const current = state.projectId === projectId && state.internal === internal ? {...state, recipients:visibleRecipients(state.recipients, internal)} : {recipients:[], loading:true};
  const toggle = userId => {
    const next = selected.includes(userId) ? selected.filter(id => id !== userId) : [...selected, userId];
    setSelected(next); onChange(next);
  };
  if (!projectId) return null;
  if (!open) return <button type="button" className="aw-link aw-mentions__open" disabled={disabled} onClick={() => setOpen(true)}>Notify people…</button>;
  return <fieldset className="aw-mentions" disabled={disabled || current.loading}>
    <legend>Notify people about this note</legend>
    <p className="aw-muted">Email contains a link, not the note. {internal ? 'Only trusted developers can receive internal notes.' : 'Clients can receive public notes.'}</p>
    {current.loading ? <p className="aw-empty" role="status">Loading project people…</p> : null}
    {current.error ? <p className="aw-empty" role="alert">Could not load project people. <Button size="sm" onClick={() => setVersion(value => value + 1)}>Retry loading people</Button></p> : null}
    {!current.loading && !current.error && !current.recipients.length ? <p className="aw-empty">No eligible project people.</p> : null}
    {current.recipients.map(person => <label key={person.userId} className="aw-check">
      <input type="checkbox" checked={selected.includes(person.userId)} disabled={disabled || (!selected.includes(person.userId) && selected.length >= 25)} onChange={() => toggle(person.userId)} />
      <span>{person.name || person.email} <small className="aw-muted">{person.memberType === 'trusted_developer' ? 'Trusted developer' : 'Client'}</small></span>
    </label>)}
  </fieldset>;
}
