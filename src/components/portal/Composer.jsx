/*
 * A new request, as a dialog: which project, what is needed, files, how much
 * of Ali, and an optional budget. The estimate follows the choices.
 */
import { useRef, useState } from 'react';
import { api, errorText } from '../../lib/portal';
import { ATTENTION, DEFAULT_ATTENTION, clock, money, timeCents } from '../../lib/pricing.js';
import { ACCEPT, checkPicked, sizeText } from '../../lib/attachments.js';
import { Button, Icon, Modal, cx } from './ui.jsx';

export function Files({ files, setFiles, compact }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const add = (list) => setFiles((f) => [...f, ...Array.from(list)].slice(0, 5));
  return (
    <div
      className={cx('cp-drop', over && 'is-over', compact && 'cp-drop--compact')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        add(e.dataTransfer.files);
      }}
    >
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
      {files.length ? (
        <ul className="cp-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Icon name="clip" size={13} /> {f.name} <span>{sizeText(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((_, k) => k !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length < 5 ? (
        <button type="button" className="cp-drop__pick" onClick={() => input.current?.click()}>
          <Icon name="clip" size={14} /> {compact ? 'Attach' : 'Drop screenshots or files here, or pick them'}
          {!compact ? <span> · up to 5, 10 MB each</span> : null}
        </button>
      ) : null}
    </div>
  );
}

export function Composer({ projects, preset, onClose, onSent }) {
  const [projectId, setProjectId] = useState(preset ?? (projects.length === 1 ? projects[0].id : ''));
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attention, setAttention] = useState(DEFAULT_ATTENTION);
  const [budget, setBudget] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const picked = ATTENTION.find((a) => a.key === attention);

  const send = async () => {
    if (!title.trim() || !body.trim()) return setError('Give it a title and say what you need.');
    const dollars = budget.trim() === '' ? null : Number(budget);
    if (dollars !== null && !(Number.isInteger(dollars) && dollars >= 1 && dollars <= 10000)) return setError('A budget is a whole number of dollars, from 1 to 10,000.');
    const problem = files.length ? checkPicked(files) : null;
    if (problem) return setError(problem);
    const fields = {
      title: title.trim(),
      body: body.trim(),
      projectId: projectId || undefined,
      attention,
      budgetCents: dollars ? dollars * 100 : undefined,
    };
    let form;
    if (files.length) {
      form = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, String(v));
      for (const f of files) form.append('files', f);
    }
    setSending(true);
    setError('');
    try {
      const { id } = await api('/portal/tickets', form ? { form } : { body: fields });
      onSent(id);
    } catch (e) {
      setError(errorText(e));
      setSending(false);
    }
  };

  return (
    <Modal
      wide
      title="New request"
      subtitle="Write it the way you would say it. Nothing starts until Ali has read it."
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={sending} onClick={send}>
            {sending ? (files.length ? 'Uploading…' : 'Sending…') : 'Send request →'}
          </Button>
        </>
      }
    >
      <div className="cp-compose">
        <div className="cp-compose__main">
          {projects.length ? (
            <div className="cp-field">
              <span className="cp-label">Project</span>
              <div className="cp-choices">
                {projects.map((p) => (
                  <button key={p.id} type="button" aria-pressed={projectId === p.id} onClick={() => setProjectId(p.id)}>
                    {p.name}
                  </button>
                ))}
                <button type="button" aria-pressed={projectId === ''} onClick={() => setProjectId('')}>
                  Not sure / something new
                </button>
              </div>
            </div>
          ) : null}
          <label className="cp-field">
            <span className="cp-label">Title</span>
            <input data-autofocus type="text" maxLength={140} value={title} placeholder="e.g. Add our opening hours to the homepage" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="cp-field">
            <span className="cp-label">What do you need?</span>
            <textarea
              rows={7}
              maxLength={8000}
              value={body}
              placeholder="What should change, where, and why. Links and examples help."
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
            />
          </label>
          <Files files={files} setFiles={setFiles} />
        </div>

        <aside className="cp-compose__side">
          <span className="cp-label">How much of Ali</span>
          <div className="cp-attn">
            {ATTENTION.map((a) => (
              <button key={a.key} type="button" aria-pressed={attention === a.key} onClick={() => setAttention(a.key)}>
                <strong>{a.name}</strong>
                <em>{a.typicalSeconds ? `about ${money(timeCents(a.typicalSeconds))}` : `${money(timeCents(3600))} an hour`}</em>
                <span>{a.what}</span>
              </button>
            ))}
          </div>
          <label className="cp-field">
            <span className="cp-label">Budget in USD (optional)</span>
            <input type="number" min="1" max="10000" step="1" inputMode="numeric" placeholder="No limit" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <p className="cp-estimate">
            {picked.typicalSeconds
              ? `Typically ${clock(picked.typicalSeconds)} of Ali's time (${money(timeCents(picked.typicalSeconds))}), plus AI at cost.`
              : `By the clock at ${money(timeCents(3600))} an hour, plus AI at cost.`}{' '}
            You pay what the meter shows, by the second{budget ? `, and work pauses at ${money(Number(budget) * 100)}` : ''}.
          </p>
        </aside>
      </div>
    </Modal>
  );
}
