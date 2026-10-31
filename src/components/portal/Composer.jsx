/*
 * A new request, as a dialog: which project, what is needed, files, how much
 * of Ali, and an optional budget. The estimate follows the choices.
 */
import { useRef, useState } from 'react';
import { api, errorText } from '../../lib/portal';
import { ATTENTION, DEFAULT_ATTENTION, clock, money, timeCents } from '../../lib/pricing.js';
import { ACCEPT, checkPicked, sizeText } from '../../lib/attachments.js';
import { useT } from './store.js';
import { Button, Icon, Modal, cx } from './ui.jsx';
import { attentionText } from './copy.js';

export function Files({ files, setFiles, compact }) {
  const t = useT();
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
              <button type="button" aria-label={t('composer.files.remove', { name: f.name })} onClick={() => setFiles((all) => all.filter((_, k) => k !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length < 5 ? (
        <button type="button" className="cp-drop__pick" onClick={() => input.current?.click()}>
          <Icon name="clip" size={14} /> {compact ? t('composer.files.attach') : t('composer.files.drop')}
          {!compact ? <span> · {t('composer.files.limit')}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

export function Composer({ projects, preset, onClose, onSent }) {
  const t = useT();
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
    if (!title.trim() || !body.trim()) return setError(t('composer.error.missing'));
    const dollars = budget.trim() === '' ? null : Number(budget);
    if (dollars !== null && !(Number.isInteger(dollars) && dollars >= 1 && dollars <= 10000)) return setError(t('composer.error.budget'));
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
      setError(errorText(e, t));
      setSending(false);
    }
  };

  return (
    <Modal
      wide
      title={t('composer.title')}
      subtitle={t('composer.subtitle')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button kind="primary" disabled={sending} onClick={send}>
            {sending ? (files.length ? t('composer.uploading') : t('common.sending')) : t('composer.send')}
          </Button>
        </>
      }
    >
      <div className="cp-compose">
        <div className="cp-compose__main">
          {projects.length ? (
            <div className="cp-field">
              <span className="cp-label">{t('composer.project.label')}</span>
              <div className="cp-choices">
                {projects.map((p) => (
                  <button key={p.id} type="button" aria-pressed={projectId === p.id} onClick={() => setProjectId(p.id)}>
                    {p.name}
                  </button>
                ))}
                <button type="button" aria-pressed={projectId === ''} onClick={() => setProjectId('')}>
                  {t('composer.project.unsure')}
                </button>
              </div>
            </div>
          ) : null}
          <label className="cp-field">
            <span className="cp-label">{t('composer.field.title')}</span>
            <input data-autofocus type="text" maxLength={140} value={title} placeholder={t('composer.field.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="cp-field">
            <span className="cp-label">{t('composer.field.need')}</span>
            <textarea
              rows={7}
              maxLength={8000}
              value={body}
              placeholder={t('composer.field.needPlaceholder')}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
            />
          </label>
          <Files files={files} setFiles={setFiles} />
        </div>

        <aside className="cp-compose__side">
          <span className="cp-label">{t('composer.attention.label')}</span>
          <div className="cp-attn">
            {ATTENTION.map((a) => (
              <button key={a.key} type="button" aria-pressed={attention === a.key} onClick={() => setAttention(a.key)}>
                <strong>{attentionText(t, a, 'name')}</strong>
                <em>{a.typicalSeconds ? t('composer.attention.about', { cost: money(timeCents(a.typicalSeconds)) }) : t('composer.attention.hour', { rate: money(timeCents(3600)) })}</em>
                <span>{attentionText(t, a, 'what')}</span>
              </button>
            ))}
          </div>
          <label className="cp-field">
            <span className="cp-label">{t('composer.budget.label')}</span>
            <input type="number" min="1" max="10000" step="1" inputMode="numeric" placeholder={t('composer.budget.placeholder')} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <p className="cp-estimate">
            {picked.typicalSeconds
              ? budget
                ? t('composer.estimate.typicalCapped', { time: clock(picked.typicalSeconds), cost: money(timeCents(picked.typicalSeconds)), cap: money(Number(budget) * 100) })
                : t('composer.estimate.typical', { time: clock(picked.typicalSeconds), cost: money(timeCents(picked.typicalSeconds)) })
              : budget
                ? t('composer.estimate.clockCapped', { rate: money(timeCents(3600)), cap: money(Number(budget) * 100) })
                : t('composer.estimate.clock', { rate: money(timeCents(3600)) })}
          </p>
        </aside>
      </div>
    </Modal>
  );
}
