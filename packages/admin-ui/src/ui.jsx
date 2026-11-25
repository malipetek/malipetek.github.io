/*
 * Small building blocks. Every class is prefixed `aw-` so neither host's CSS
 * leaks in. The contract for every primitive here is
 * docs/admin-ui-refresh/01-ui-contract.md §4: one shape each, every state.
 * Props are additive: nothing that existed before M1 was renamed.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { STATUS_LABEL, errorText } from './format.js';
import { isTop, useLayer, useUid } from './ui/layer.js';
import { Menu } from './ui/menu.jsx';

let modalSeq = 0;

export const cx = (...parts) => parts.filter(Boolean).join(' ');

/** True while the media query matches; re-renders when it flips. */
export function useMedia(query) {
  const read = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
  const [match, setMatch] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const q = window.matchMedia(query);
    const sync = () => setMatch(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, [query]);
  return match;
}

/**
 * The one button. `kind`: default (= secondary) · secondary · primary · ghost ·
 * danger. `busy` disables it and shows a spinner in place of the label (the
 * label stays for screen readers). `disabledReason` says why it cannot be
 * pressed: a tooltip and the button's accessible description. `icon` puts an
 * icon before the label; `iconOnly` makes a square button whose label is the
 * tooltip. `shortcut` appears in the tooltip.
 */
export function Button({ kind = 'default', size, className, busy = false, disabledReason, icon, iconOnly = false, shortcut, tip, children, disabled, ...props }) {
  const reasonId = useUid('aw-why');
  const isDisabled = Boolean(disabled || busy);
  const label = props['aria-label'] ?? (typeof children === 'string' ? children : undefined);
  const tipText = tip ?? (iconOnly ? [label, shortcut].filter(Boolean).join('  ') : shortcut ? `${label ?? ''}  ${shortcut}`.trim() : undefined);
  const button = (
    <button
      type="button"
      className={cx('aw-btn', `aw-btn--${kind}`, size && `aw-btn--${size}`, iconOnly && 'aw-btn--icon', className)}
      disabled={isDisabled}
      aria-busy={busy || props['aria-busy'] || undefined}
      data-primary={kind === 'primary' ? 'true' : undefined}
      aria-describedby={disabled && disabledReason ? reasonId : props['aria-describedby']}
      data-tip={!(disabled && disabledReason) && tipText && !props.title ? tipText : undefined}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {iconOnly ? null : children}
    </button>
  );
  if (!(disabled && disabledReason)) return button;
  return (
    <span className="aw-btnwrap" data-tip={disabledReason}>
      {button}
      <span id={reasonId} className="aw-sr">{disabledReason}</span>
    </span>
  );
}

/** A square ghost button with a required label (its tooltip). */
export function IconButton({ icon, label, shortcut, size, kind = 'ghost', ...props }) {
  return <Button kind={kind} size={size} icon={icon} iconOnly aria-label={label} shortcut={shortcut} {...props} />;
}

export const StatusPill = ({ status }) => <span className={`aw-pill aw-pill--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
export const Dot = ({ state }) => <span className={`aw-dot aw-dot--${state}`} aria-hidden="true" />;
export const Tag = ({ children, tone, title }) => <span className={cx('aw-tag', tone && `aw-tag--${tone}`)} title={title}>{children}</span>;

/** A small tone pill: the tag recipe, fully rounded. Tone is always beside a word. */
const BADGE_TONES = { neutral: null, info: 'aw-tag--info', ok: 'aw-tag--ok', warn: 'aw-tag--warn', bad: 'aw-tag--bad', accent: 'aw-tag--accent', dash: 'aw-tag--dash' };
export function Badge({ tone = 'neutral', children, title }) {
  return <span className={cx('aw-tag', 'aw-tag--pill', BADGE_TONES[tone] ?? null)} title={title}>{children}</span>;
}

/** What this is and the next action. `inline` aligns it left inside a section. */
export function EmptyState({ title, hint, action, icon, inline = false }) {
  return (
    <div className={cx('aw-emptybox', inline && 'aw-emptybox--inline')}>
      {icon ? <span className="aw-emptybox__icon"><Icon name={icon} size={20} /></span> : null}
      <strong>{title}</strong>
      {hint ? <span className="aw-emptybox__hint">{hint}</span> : null}
      {action ? <div className="aw-emptybox__action">{action}</div> : null}
    </div>
  );
}
export const Empty = EmptyState;

/**
 * The loading shape: bars in the place the content will take. `variant`:
 * text (default), rows (a list), table, board (lanes), pane (a page header and
 * rows), ticket (a header and a thread).
 */
export function Skeleton({ variant = 'text', lines = 3, rows = 6, label = 'Loading…' }) {
  const bar = (w, extra) => <span className={cx('aw-skel__bar', extra)} style={{ width: w }} />;
  const widths = ['92%', '78%', '85%', '64%', '88%', '70%'];
  let body;
  if (variant === 'board') {
    body = (
      <div className="aw-skel__lanes">
        {[3, 2, 2, 1, 2].map((n, i) => (
          <div key={i} className="aw-skel__lane">
            {bar('40%')}
            {Array.from({ length: n }, (_, j) => <span key={j} className="aw-skel__card" />)}
          </div>
        ))}
      </div>
    );
  } else if (variant === 'rows' || variant === 'table') {
    body = Array.from({ length: rows }, (_, i) => (
      <div key={i} className="aw-skel__row">
        {bar('36px')}
        {bar(widths[i % widths.length].replace('%', '') * 4 + 'px')}
        {variant === 'table' ? bar('80px') : null}
        {variant === 'table' ? bar('64px') : null}
      </div>
    ));
  } else if (variant === 'pane' || variant === 'ticket') {
    body = (
      <>
        {bar('34%', 'aw-skel__bar--title')}
        {bar('52%')}
        <div style={{ height: 12 }} />
        {Array.from({ length: variant === 'ticket' ? 3 : rows }, (_, i) =>
          variant === 'ticket' ? (
            <div key={i} className="aw-skel aw-skel--ticket">
              {bar('18%')}
              {bar(widths[i])}
              {bar(widths[i + 2])}
            </div>
          ) : (
            <div key={i} className="aw-skel__row">{bar('36px')}{bar(widths[i % widths.length].replace('%', '') * 5 + 'px')}</div>
          ),
        )}
      </>
    );
  } else {
    body = Array.from({ length: lines }, (_, i) => <span key={i} className="aw-skel__bar" style={{ width: widths[i % widths.length] }} />);
  }
  return (
    <div className={cx('aw-skel', (variant === 'pane' || variant === 'ticket') && 'aw-skel--pane')} role="status" aria-live="polite">
      <span className="aw-sr">{label}</span>
      {body}
    </div>
  );
}

/** Loading, as a skeleton of rows with the label for screen readers. */
export function Loading({ label = 'Loading…', variant = 'rows' }) {
  return <div className="aw-loading"><Skeleton variant={variant} rows={4} label={label} /></div>;
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

/** A titled section: a hairline above, the title row, then content. Not a card. */
export function Panel({ title, subtitle, actions, children }) {
  return (
    <section className="aw-panel">
      {title || actions ? (
        <header className="aw-panel__head">
          <div className="aw-panel__titles">
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</p> : null}
          </div>
          {actions ? <div className="aw-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The one pane header: title and a one-line context on the left; meta (status
 * pills), actions (at most one primary) and the overflow menu on the right.
 * `secondary` is a list of menu-shaped actions shown as buttons on a wide pane
 * and folded into the overflow menu on a narrow one (≤600px), so nothing is
 * lost when the pane is small.
 */
export function PageHeader({ title, subtitle, meta, actions, secondary, overflow, back }) {
  const narrow = useMedia('(max-width: 600px)');
  const extra = secondary?.filter(Boolean) ?? [];
  const menu = [...(narrow ? extra : []), ...(overflow?.filter(Boolean) ?? [])];
  return (
    <header className="aw-pagehead">
      <div className="aw-pagehead__titles">
        {back ? <Button kind="ghost" size="sm" icon="chevronLeft" onClick={back.run}>{back.label}</Button> : null}
        <h2>{title}</h2>
        {subtitle ? <p title={typeof subtitle === 'string' ? subtitle : undefined}>{subtitle}</p> : null}
      </div>
      {meta || actions || extra.length || menu.length ? (
        <div className="aw-pagehead__side">
          {meta ? <div className="aw-pagehead__meta">{meta}</div> : null}
          {extra.length && !narrow ? (
            <div className="aw-pagehead__actions aw-pagehead__secondary">
              {extra.map((item) => (
                <Button key={item.label} disabled={item.disabled} disabledReason={item.disabledReason} busy={item.busy} kind={item.danger ? 'danger' : 'default'} onClick={item.run} title={item.hint}>
                  {item.label}
                </Button>
              ))}
            </div>
          ) : null}
          {actions ? <div className="aw-pagehead__actions">{actions}</div> : null}
          {menu.length ? <OverflowMenu items={menu} /> : null}
        </div>
      ) : null}
    </header>
  );
}


/** Figures in a line; `tone` colours the value and is always beside its label. */
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
  const hasChecked = options.some((o) => o.value === value);
  return (
    <div className="aw-seg" role="radiogroup" aria-label={label} ref={ref} onKeyDown={onKey}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          data-value={String(o.value)}
          disabled={disabled || o.disabled}
          aria-checked={o.value === value}
          aria-pressed={o.value === value}
          tabIndex={o.value === value || (!hasChecked && i === 0) ? 0 : -1}
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
 * The one subnav for a page's sections: underline tabs with roving focus
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
    btns[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
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
export const Subnav = PageTabs;

export function Field({ label, hint, error, children }) {
  return (
    <label className="aw-field">
      <span className="aw-field__label">{label}</span>
      {children}
      {error ? <span className="aw-field__error" role="alert">{error}</span> : hint ? <span className="aw-field__hint">{hint}</span> : null}
    </label>
  );
}

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export { layerOpen } from './ui/layer.js';

/**
 * The one dialog: focus starts inside (`focus` names a selector to prefer),
 * Tab stays inside, Escape closes, and focus returns to whoever opened it.
 * At ≤600px it is a bottom sheet (`sheet` is accepted for clarity; the
 * narrow rule applies to every dialog).
 */
export function Modal({ title, subtitle, onClose, children, actions, wide, full, focus, sheet }) {
  const ref = useRef(null);
  const layer = useLayer();
  const [titleId] = useState(() => `aw-modal-title-${++modalSeq}`);
  useEffect(() => {
    const root = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The named control, else the first field, else the first enabled footer
    // button, else the dialog itself — never the close button.
    const first =
      (focus ? root?.querySelector(focus) : null) ??
      root?.querySelector('.aw-modal__body :is(input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled))') ??
      root?.querySelector('.aw-modal__foot button:not(:disabled)') ??
      root;
    first?.focus();
    return () => opener?.focus?.();
    // Mount only: capture the opener once; re-renders must not re-capture it.
  }, []);
  useEffect(() => {
    const root = ref.current;
    const onKey = (e) => {
      if (!isTop(layer)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
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
  }, [onClose, layer]);
  return (
    <div className="aw-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('aw-modal', wide && 'aw-modal--wide', full && 'aw-modal--full', sheet && 'aw-modal--sheet')} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <header className="aw-modal__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <Button kind="ghost" size="sm" iconOnly icon="close" onClick={onClose} aria-label="Close" tip="Close  Esc" />
        </header>
        <div className="aw-modal__body">{children}</div>
        {actions ? <footer className="aw-modal__foot">{actions}</footer> : null}
      </div>
    </div>
  );
}

/**
 * A question with consequences: one line of consequence, Cancel and the
 * action. Initial focus is on the safe control for a destructive action and
 * on the action otherwise (Return confirms). It stays busy while the action
 * runs, and on failure it stays open with the reason.
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
    <Modal kind="confirm"
      title={ask.title}
      subtitle={ask.text}
      onClose={close}
      focus={ask.danger ? '.aw-confirm-cancel' : '.aw-confirm'}
      actions={
        <>
          <Button className="aw-confirm-cancel" onClick={close} disabled={busy}>Cancel</Button>
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

/** One result line: an error stays until dismissed, anything else times out (the caller's timer). */
export function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className={cx('aw-toast', toast.kind === 'error' && 'is-error')} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span>{toast.text}</span>
      <button type="button" className="aw-toast__close" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/* ————— menus ————— */

// Menu lives in ui/menu.jsx (the one role="menu"); re-exported here for old import paths.
export { Menu };

/** The "…" button that opens a menu of the actions that are not inline. */
export function OverflowMenu({ items, label = 'More actions', size }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <>
      <span ref={anchor} className="aw-overflow-anchor">
        <Button kind="ghost" size={size} iconOnly icon="more" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      </span>
      {open ? <Menu items={list} anchor={anchor} label={label} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * A context menu for a row, tab or station: right-click, the Menu key or
 * Shift+F10. `items` is a list or a function of the event target.
 * Spread `bind` on the element and render `menu` anywhere inside `.aw`.
 */
export function useContextMenu(items, label = 'Actions') {
  const [state, setState] = useState(null);
  const openAt = (x, y) => {
    const list = (typeof items === 'function' ? items() : items)?.filter(Boolean) ?? [];
    if (list.length) setState({ x, y, list });
  };
  const bind = {
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAt(e.clientX, e.clientY);
    },
    onKeyDown: (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        openAt(r.left + 16, r.top + Math.min(r.height, 28));
      }
    },
  };
  const menu = state ? <Menu items={state.list} at={{ x: state.x, y: state.y }} label={label} onClose={() => setState(null)} /> : null;
  return { bind, menu, open: openAt };
}

/* ————— icons: one 1.5px stroke set, currentColor ————— */
const PATHS = {
  inbox: 'M3 13h4l2 3h6l2-3h4M5 5h14l2 8v6H3v-6z',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v7h-4z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  fleet: 'M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01',
  clients: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5',
  ticket: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  play: 'M7 5l12 7-12 7z',
  megaphone: 'M3 10v4a1 1 0 0 0 1 1h2l4 3V6L6 9H4a1 1 0 0 0-1 1zM14 8a5 5 0 0 1 0 8M17 5a9 9 0 0 1 0 14',
  seo: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9z',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
  check: 'M5 12l5 5 9-10',
  pause: 'M9 5v14M15 5v14',
  branch: 'M6 3v12a3 3 0 1 0 3 3M6 9h8a4 4 0 0 0 4-4M18 3v4M4 3h4',
  globe: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0M3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18',
  file: 'M14 3H5v18h14V8l-5-5v5h5M8 12h8M8 16h8',
};
/** Glyphs drawn heavier than the 1.5 default so they read at small sizes. */
const WEIGHT = { more: 2.6, pause: 2.2 };
export function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={WEIGHT[name] ?? 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? PATHS.list} />
    </svg>
  );
}
