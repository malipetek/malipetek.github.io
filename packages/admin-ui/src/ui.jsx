/* Small building blocks. Every class is prefixed `aw-` so neither host's CSS leaks in. */
import { useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, errorText } from './format.js';

let modalSeq = 0;

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export function Button({ kind = 'default', size, className, ...props }) {
  return <button type="button" className={cx('aw-btn', `aw-btn--${kind}`, size && `aw-btn--${size}`, className)} {...props} />;
}

export const StatusPill = ({ status }) => <span className={`aw-pill aw-pill--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
export const Dot = ({ state }) => <span className={`aw-dot aw-dot--${state}`} aria-hidden="true" />;
export const Tag = ({ children, tone, title }) => <span className={cx('aw-tag', tone && `aw-tag--${tone}`)} title={title}>{children}</span>;

/** A small tone pill: the tag recipe, fully rounded. */
const BADGE_TONES = { neutral: null, info: 'aw-tag--info', ok: 'aw-tag--ok', warn: 'aw-tag--warn', bad: 'aw-tag--bad', accent: 'aw-tag--accent' };
export function Badge({ tone = 'neutral', children }) {
  return <span className={cx('aw-tag', 'aw-tag--pill', BADGE_TONES[tone] ?? null)}>{children}</span>;
}

/** A "nothing here" box: quiet, centered, compact. */
export function Empty({ title, hint, action }) {
  return (
    <div className="aw-emptybox">
      <strong>{title}</strong>
      {hint ? <span className="aw-emptybox__hint">{hint}</span> : null}
      {action ? <div className="aw-emptybox__action">{action}</div> : null}
    </div>
  );
}

/** A quiet loading line with a spinner, announced politely once. */
export function Loading({ label = 'Loading…' }) {
  return <div className="aw-loading" role="status">{label}</div>;
}

/** A failure with its reason and a way out. */
export function ErrorNote({ error, onRetry }) {
  return (
    <div className="aw-errornote" role="alert">
      <span className="aw-errornote__text">{errorText(error)}</span>
      {onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

/** A titled, bordered section: header row, actions right, one padding. */
export function Panel({ title, subtitle, actions, children }) {
  return (
    <section className="aw-panel">
      {title || actions ? (
        <header className="aw-panel__head">
          <div className="aw-panel__titles">
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="aw-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The one page header: title and a one-line muted subtitle on the left,
 * badges then buttons on the right, vertically centred. No box, no border —
 * the page furniture stays quiet. Wraps under the title on narrow panes.
 */
export function PageHeader({ title, subtitle, meta, actions }) {
  return (
    <header className="aw-pagehead">
      <div className="aw-pagehead__titles">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {meta || actions ? (
        <div className="aw-pagehead__side">
          {meta ? <div className="aw-pagehead__meta">{meta}</div> : null}
          {actions ? <div className="aw-pagehead__actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

/** Compact horizontal stat tiles; `tone` colours the value. */
export function StatRow({ items }) {
  return (
    <div className="aw-statrow">
      {(items ?? []).map((it, i) => (
        <div key={i} className={cx('aw-statrow__item', it.tone && `aw-statrow__item--${it.tone}`)} title={it.hint}>
          <strong>{it.value}</strong>
          <small>{it.label}</small>
        </div>
      ))}
    </div>
  );
}

/**
 * A vertical drag handle that resizes a pane by writing a pixel width into a
 * CSS var on the host element (found with `closest(host)`). `invert` for panes
 * that grow toward the left. Persists the width in localStorage under `storage`.
 * Focusable: the arrow keys move the handle by 16px.
 */
export function Resizer({ host, cssVar, def, min, max, invert = false, storage, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const pane = el?.closest(host);
    if (!el || !pane) return undefined;
    const saved = storage ? Number(localStorage.getItem(storage)) : 0;
    if (saved >= min && saved <= max) pane.style.setProperty(cssVar, `${saved}px`);
    let startX = 0;
    let startW = def;
    const read = () => parseFloat(getComputedStyle(pane).getPropertyValue(cssVar)) || def;
    const move = (e) => {
      const w = Math.min(max, Math.max(min, startW + (e.clientX - startX) * (invert ? -1 : 1)));
      pane.style.setProperty(cssVar, `${Math.round(w)}px`);
    };
    const up = () => {
      el.classList.remove('is-drag');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const w = Math.round(read());
      if (storage && w >= min && w <= max) localStorage.setItem(storage, String(w));
    };
    const down = (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = read();
      el.classList.add('is-drag');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    const key = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const grow = (e.key === 'ArrowRight' ? 1 : -1) * (invert ? -1 : 1);
      const w = Math.min(max, Math.max(min, Math.round(read()) + grow * 16));
      pane.style.setProperty(cssVar, `${w}px`);
      if (storage && w >= min && w <= max) localStorage.setItem(storage, String(w));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('keydown', key);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [host, cssVar, def, min, max, invert, storage]);
  return <div ref={ref} className={cx('aw-resize', className)} role="separator" aria-orientation="vertical" aria-label="Resize pane" tabIndex={0} />;
}

/**
 * A single-choice control with radiogroup semantics: the arrows move and pick,
 * aria-checked marks the chosen option. aria-pressed stays alongside it until
 * the markup tests that still read it are retired.
 */
export function Segmented({ value, options, onChange, disabled, label }) {
  const ref = useRef(null);
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = ref.current ? [...ref.current.querySelectorAll('button:not(:disabled)')] : [];
    if (!btns.length) return;
    e.preventDefault();
    const idx = btns.indexOf(document.activeElement);
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = btns[idx === -1 ? (dir === 1 ? 0 : btns.length - 1) : (idx + dir + btns.length) % btns.length];
    next.focus();
    const opt = options.find((o) => String(o.value) === next.dataset.value);
    if (opt && opt.value !== value) onChange(opt.value);
  };
  return (
    <div className="aw-seg" role="radiogroup" aria-label={label} ref={ref} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          data-value={String(o.value)}
          disabled={disabled || o.disabled}
          aria-checked={o.value === value}
          aria-pressed={o.value === value}
          title={o.hint}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A multi-choice control: every chip toggles independently. */
export function Chips({ value, options, onChange, disabled, label }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="aw-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} title={o.hint} aria-pressed={value.includes(o.value)} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The one tab strip for a page's sections: underline tabs with roving focus
 * (the arrows move and pick, Home/End jump) and the chosen one inked with a
 * 2px accent underline. A filter or toggle inside a section stays Segmented.
 */
export function PageTabs({ value, onChange, items, ariaLabel }) {
  const ref = useRef(null);
  const list = items ?? [];
  const hasActive = list.some((it) => it.value === value);
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const btns = ref.current ? [...ref.current.querySelectorAll('button')] : [];
    if (!btns.length) return;
    e.preventDefault();
    const idx = btns.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (idx === -1 ? 0 : idx + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
    btns[next].focus();
    const item = list[next];
    if (item && item.value !== value) onChange(item.value);
  };
  return (
    <div className="aw-pagetabs" role="tablist" aria-label={ariaLabel} ref={ref} onKeyDown={onKey}>
      {list.map((it, i) => {
        const active = it.value === value;
        return (
          <button
            key={String(it.value)}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || (!hasActive && i === 0) ? 0 : -1}
            onClick={() => onChange(it.value)}
          >
            {it.label}
            {it.badge != null && it.badge !== '' ? <span className="aw-pagetabs__badge">{it.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="aw-field">
      <span className="aw-field__label">{label}</span>
      {children}
      {hint ? <span className="aw-field__hint">{hint}</span> : null}
    </label>
  );
}

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The one overlay: focus starts inside (`focus` names a selector to prefer),
 * Tab stays inside, Escape closes, and focus returns to whoever opened it.
 */
export function Modal({ title, subtitle, onClose, children, actions, wide, full, focus }) {
  const ref = useRef(null);
  // One id per mounted dialog; seeded once so re-renders keep it stable.
  const [titleId] = useState(() => `aw-modal-title-${++modalSeq}`);
  useEffect(() => {
    const root = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = (focus ? root?.querySelector(focus) : null) ?? root?.querySelector(FOCUSABLE);
    first?.focus();
    return () => opener?.focus();
    // Mount only: capture the opener once; re-renders must not re-capture it.
  }, []);
  useEffect(() => {
    const root = ref.current;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const inside = root.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === items[0])) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === items[items.length - 1])) {
        e.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="aw-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('aw-modal', wide && 'aw-modal--wide', full && 'aw-modal--full')} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="aw-modal__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <Button kind="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="aw-modal__body">{children}</div>
        {actions ? <footer className="aw-modal__foot">{actions}</footer> : null}
      </div>
    </div>
  );
}

/**
 * A question with consequences: the confirm button is focused (Enter confirms),
 * stays busy while the action runs, and on failure the dialog stays open with
 * the reason.
 */
export function Confirm({ ask, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (!busy) onClose();
  };
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await ask.run();
      close();
    } catch (err) {
      setBusy(false);
      setError(errorText(err));
    }
  };
  return (
    <Modal
      title={ask.title}
      subtitle={ask.text}
      onClose={close}
      focus=".aw-confirm"
      actions={
        <>
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button className="aw-confirm" kind={ask.danger ? 'danger' : 'primary'} disabled={busy} aria-busy={busy} onClick={() => { void run(); }}>
            {ask.confirm}
          </Button>
        </>
      }
    >
      {error ? <p className="aw-error" role="alert">{error}</p> : null}
    </Modal>
  );
}

const PATHS = {
  inbox: 'M3 13h4l2 3h6l2-3h4M5 5h14l2 8v6H3v-6z',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  fleet: 'M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01',
  clients: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5',
  ticket: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  play: 'M7 5l12 7-12 7z',
  megaphone: 'M3 10v4a1 1 0 0 0 1 1h2l4 3V6L6 9H4a1 1 0 0 0-1 1zM14 8a5 5 0 0 1 0 8M17 5a9 9 0 0 1 0 14',
  seo: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9z',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
};
export function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
