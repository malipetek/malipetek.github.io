/* Small building blocks. Every class is prefixed `aw-` so neither host's CSS leaks in. */
import { useEffect, useRef } from 'react';
import { STATUS_LABEL } from './format.js';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export function Button({ kind = 'default', size, className, ...props }) {
  return <button type="button" className={cx('aw-btn', `aw-btn--${kind}`, size && `aw-btn--${size}`, className)} {...props} />;
}

export const StatusPill = ({ status }) => <span className={`aw-pill aw-pill--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
export const Dot = ({ state }) => <span className={`aw-dot aw-dot--${state}`} aria-hidden="true" />;
export const Tag = ({ children, tone, title }) => <span className={cx('aw-tag', tone && `aw-tag--${tone}`)} title={title}>{children}</span>;

/**
 * A vertical drag handle that resizes a pane by writing a pixel width into a
 * CSS var on the host element (found with `closest(host)`). `invert` for panes
 * that grow toward the left. Persists the width in localStorage under `storage`.
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
    el.addEventListener('pointerdown', down);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [host, cssVar, def, min, max, invert, storage]);
  return <div ref={ref} className={cx('aw-resize', className)} role="separator" aria-orientation="vertical" />;
}

export function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="aw-seg" role="group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled || o.disabled}
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

export function Chips({ value, options, onChange, disabled }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="aw-chips">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} title={o.hint} aria-pressed={value.includes(o.value)} onClick={() => toggle(o.value)}>
          {o.label}
        </button>
      ))}
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

export function Modal({ title, subtitle, onClose, children, actions, wide, full }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="aw-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('aw-modal', wide && 'aw-modal--wide', full && 'aw-modal--full')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="aw-modal__head">
          <div>
            <h2>{title}</h2>
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

export function Confirm({ ask, onClose }) {
  return (
    <Modal
      title={ask.title}
      subtitle={ask.text}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            kind={ask.danger ? 'danger' : 'primary'}
            onClick={() => {
              onClose();
              ask.run();
            }}
          >
            {ask.confirm}
          </Button>
        </>
      }
    />
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
};
export function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
