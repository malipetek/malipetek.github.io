/*
 * PTech Admin v2 primitives (docs/admin-ui-refresh/06-design-system.md §7).
 * Every class is `ui-`; every value comes from ui/tokens.js. Feature code
 * imports these from `ui/index.js`, never from this file.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Menu, cx } from '../ui.jsx';
import { UI_CSS } from './css.js';
import { resolveState } from './state.js';
import { SIZE } from './tokens.js';
import { clampWidth, readWidth, resizeKey, tableKeyAction, writeWidth } from './behavior.js';

const storage = () => (typeof window === 'undefined' ? null : window.localStorage);

/** The v2 stylesheet. <Shell> renders it; render it yourself when mounting primitives without a Shell. */
export function UiStyles() {
  return <style data-ui-styles="v2">{UI_CSS}</style>;
}

/** Internal button: one shape, `data-primary="true"` on the primary kind so gate B1 can count it. */
function UiButton({ kind = 'secondary', size, busy = false, className, children, disabled, ...props }) {
  return (
    <button
      type="button"
      className={cx('ui-btn', kind !== 'secondary' && `ui-btn--${kind}`, size === 'sm' && 'ui-btn--sm', className)}
      data-primary={kind === 'primary' ? 'true' : undefined}
      disabled={Boolean(disabled || busy)}
      aria-busy={busy || undefined}
      {...props}
    >
      {children}
    </button>
  );
}

function MoreMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const list = (items ?? []).filter(Boolean);
  if (!list.length) return null;
  return (
    <>
      <UiButton ref={anchor} kind="ghost" className="ui-iconbtn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </UiButton>
      {open ? <Menu items={list} anchor={anchor} label={label} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/* ————— StateIndicator ————— */

/**
 * The only status display: a 6px dot and a sentence-case label on a
 * transparent background. `state` is a domain state (`review`, `stalled`,
 * `opted_out`, …) resolved through ui/state.js; unknown values are humanized,
 * never shown raw. `label` / `tone` / `live` override the map. `dotOnly`
 * hides the label visually (it stays for screen readers).
 */
export function StateIndicator({ state, label, tone, live, dotOnly = false, title, className }) {
  const s = resolveState(state, { label, tone, live });
  return (
    <span
      className={cx('ui-state', dotOnly && 'ui-state--dot-only', className)}
      data-state={s.key}
      data-tone={s.tone}
      data-live={s.live ? '' : undefined}
      data-ring={s.ring ? '' : undefined}
      data-dashed={s.dashed ? '' : undefined}
      title={title ?? (dotOnly ? s.label : undefined)}
    >
      <span className="ui-state__dot" aria-hidden="true" />
      <span className={dotOnly ? 'ui-sr' : undefined}>{s.label}</span>
    </span>
  );
}

/* ————— MetaChip ————— */

/** Non-status metadata (`P1`, `via ChatGPT`, `gpu`). Monochrome by contract: it takes no tone. */
export function MetaChip({ children, title, mono = false, className }) {
  return <span className={cx('ui-chip', mono && 'ui-chip--mono', className)} title={title}>{children}</span>;
}

/* ————— DataTable ————— */

/**
 * A dense, keyboard-first table.
 *
 * columns: `{ key, header, render?(row, i), numeric?, fit?, mono?, label? }` —
 *   `numeric` right-aligns with tabular figures; `fit` (implied by numeric)
 *   sizes the column to its content; the first column is the row title when
 *   rows stack at ≤720px container width.
 * rows, rowKey(row, i) → string (default `row.id`).
 * Selection: `selected` + `onSelect(row, key)` (controlled) or `defaultSelected`.
 * `onOpen(row, key)`: Enter or double-click.
 * `menu`: items or `(row) => items` (legacy Menu item shape); right-click,
 *   Shift+F10 or the ContextMenu key opens it on the row.
 * Sorting (optional): `sort: { key, dir }` (dir 1 ascending, -1 descending) and
 *   `onSort(key)`; columns with `sortable` get a header button and `aria-sort`.
 *   The table never reorders rows itself: the caller sorts.
 * `state`: 'ready' | 'loading' | 'error' (default: 'error' when `error`, else 'ready');
 *   `empty: { title, hint, action }` when ready with no rows; `onRetry` on error.
 * Keyboard: j/k/↑/↓ move, Home/End jump, Enter opens; one roving tab stop.
 */
export function DataTable({
  columns,
  rows = [],
  rowKey = (row) => row?.id,
  selected,
  defaultSelected = null,
  onSelect,
  onOpen,
  menu,
  sort,
  onSort,
  label,
  state,
  error,
  onRetry,
  empty,
  skeletonRows = 6,
  className,
}) {
  const status = state ?? (error ? 'error' : 'ready');
  const keys = rows.map((row, i) => String(rowKey(row, i)));
  const [own, setOwn] = useState(defaultSelected == null ? null : String(defaultSelected));
  const current = selected !== undefined ? (selected == null ? null : String(selected)) : own;
  const selIndex = current == null ? -1 : keys.indexOf(current);
  const body = useRef(null);
  const [menuState, setMenuState] = useState(null);

  const focusRow = (i) => body.current?.querySelectorAll('[data-row]')[i]?.focus();
  const select = (i, focus = false) => {
    if (i < 0 || i >= rows.length) return;
    if (selected === undefined) setOwn(keys[i]);
    if (keys[i] !== current) onSelect?.(rows[i], keys[i]);
    if (focus) focusRow(i);
  };
  const openMenu = (i, x, y) => {
    const items = (typeof menu === 'function' ? menu(rows[i]) : menu)?.filter(Boolean) ?? [];
    if (items.length) setMenuState({ x, y, items });
  };
  const onKey = (i) => (e) => {
    const action = tableKeyAction(e, i, rows.length);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action.type === 'move') select(action.index, true);
    else if (action.type === 'open') onOpen?.(rows[i], keys[i]);
    else if (action.type === 'menu') {
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(i, r.left + 16, r.top + Math.min(r.height, SIZE.row));
    }
  };

  const cols = columns.map((c) => ({ ...c, fit: c.fit ?? Boolean(c.numeric), label: c.label ?? (typeof c.header === 'string' ? c.header : c.key) }));
  const head = (
    <thead>
      <tr>
        {cols.map((c) => {
          const sortable = Boolean(c.sortable && onSort);
          const on = sortable && sort?.key === c.key;
          return (
            <th
              key={c.key}
              scope="col"
              data-numeric={c.numeric ? '' : undefined}
              data-fit={c.fit ? '' : undefined}
              aria-sort={sortable ? (on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none') : undefined}
            >
              {sortable ? (
                <button type="button" className="ui-table__sort" onClick={() => onSort(c.key)}>
                  {c.header}
                  <span className="ui-table__arrow" aria-hidden="true">{on ? (sort.dir > 0 ? '↑' : '↓') : ''}</span>
                </button>
              ) : c.header}
            </th>
          );
        })}
      </tr>
    </thead>
  );

  if (status === 'error') {
    const text = typeof error === 'string' ? error : error?.message ?? 'Something went wrong.';
    return (
      <div className={cx('ui-table-wrap', className)}>
        <div className="ui-table__note ui-table__note--error" role="alert">
          <strong>Could not load {label ? label.toLowerCase() : 'this list'}</strong>
          {text}
          {onRetry ? <div><UiButton size="sm" onClick={onRetry}>Retry</UiButton></div> : null}
        </div>
      </div>
    );
  }
  if (status === 'ready' && rows.length === 0) {
    return (
      <div className={cx('ui-table-wrap', className)}>
        <div className="ui-table__note" role="status">
          <strong>{empty?.title ?? 'Nothing here yet'}</strong>
          {empty?.hint ?? null}
          {empty?.action ? <div>{empty.action}</div> : null}
        </div>
      </div>
    );
  }
  const loading = status === 'loading';
  const tabStop = selIndex >= 0 ? selIndex : 0;
  return (
    <div className={cx('ui-table-wrap', className)}>
      <table className="ui-table" role="grid" aria-label={label} aria-busy={loading || undefined} aria-rowcount={loading ? undefined : rows.length + 1}>
        {head}
        <tbody ref={body}>
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk${i}`} className="ui-row ui-row--skeleton" aria-hidden="true">
                  {cols.map((c) => <td key={c.key} data-fit={c.fit ? '' : undefined} />)}
                </tr>
              ))
            : rows.map((row, i) => (
                <tr
                  key={keys[i]}
                  data-row=""
                  data-key={keys[i]}
                  className="ui-row"
                  aria-selected={i === selIndex}
                  aria-rowindex={i + 2}
                  tabIndex={i === tabStop ? 0 : -1}
                  onClick={() => select(i)}
                  onDoubleClick={() => onOpen?.(row, keys[i])}
                  onKeyDown={onKey(i)}
                  onContextMenu={menu ? (e) => { e.preventDefault(); select(i); openMenu(i, e.clientX, e.clientY); } : undefined}
                >
                  {cols.map((c) => (
                    <td key={c.key} data-label={c.label} data-numeric={c.numeric ? '' : undefined} data-fit={c.fit ? '' : undefined} data-mono={c.mono ? '' : undefined}>
                      {c.render ? c.render(row, i) : row?.[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {loading ? <span className="ui-sr" role="status">Loading…</span> : null}
      {menuState ? <Menu items={menuState.items} at={{ x: menuState.x, y: menuState.y }} label={`${label ?? 'Row'} actions`} onClose={() => setMenuState(null)} /> : null}
    </div>
  );
}

/* ————— Inspector ————— */

/**
 * The right-hand detail pane. Resizable between `minWidth` and `maxWidth`
 * (300–560px) by pointer or keyboard (←/→ 16px, Home/End), width persisted in
 * localStorage under `storageKey` (pass null to not persist). Escape inside
 * the pane calls `onClose`. At ≤900px it becomes full width below the list.
 */
export function Inspector({
  title,
  actions,
  onClose,
  children,
  label,
  storageKey = 'ui.inspector.width',
  defaultWidth = SIZE.inspector,
  minWidth = SIZE.inspectorMin,
  maxWidth = SIZE.inspectorMax,
  resizable = true,
  className,
}) {
  const limits = { min: minWidth, max: maxWidth, def: defaultWidth };
  const [width, setWidth] = useState(() => clampWidth(defaultWidth, limits));
  const [drag, setDrag] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (storageKey) setWidth(readWidth(storage(), storageKey, limits));
  }, [storageKey, minWidth, maxWidth, defaultWidth]);

  const commit = useCallback((w) => {
    setWidth(w);
    writeWidth(storage(), storageKey, w);
  }, [storageKey]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    setDrag(true);
    const move = (ev) => setWidth(clampWidth(startW + (startX - ev.clientX), limits));
    const up = () => {
      setDrag(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      commit(widthRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onSepKey = (e) => {
    const next = resizeKey(e.key, widthRef.current, { min: minWidth, max: maxWidth });
    if (next == null) return;
    e.preventDefault();
    commit(next);
  };
  const name = label ?? (typeof title === 'string' ? title : 'Inspector');
  return (
    <aside
      className={cx('ui-inspector', className)}
      aria-label={name}
      style={{ '--ui-inspector-w': `${width}px` }}
      onKeyDown={onClose ? (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); } } : undefined}
    >
      {resizable ? (
        <div
          className="ui-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${name}`}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          data-drag={drag ? '' : undefined}
          onPointerDown={onPointerDown}
          onKeyDown={onSepKey}
        />
      ) : null}
      {title || actions || onClose ? (
        <div className="ui-inspector__head">
          <h2 className="ui-inspector__title">{title}</h2>
          {actions}
          {onClose ? (
            <UiButton kind="ghost" className="ui-iconbtn" aria-label={`Close ${name}`} title="Close  Esc" onClick={onClose}>
              <Icon name="close" />
            </UiButton>
          ) : null}
        </div>
      ) : null}
      <div className="ui-inspector__body">{children}</div>
    </aside>
  );
}

/* ————— ContextBar ————— */

/**
 * The 38px bar on top of a collection or object: back, title, state, meta,
 * then at most ONE primary action (an object, so a second cannot be passed),
 * secondary actions, and an overflow menu.
 * primary: `{ label, onClick, disabled, busy, title }`.
 */
export function ContextBar({ title, back, state, meta, primary, actions, overflow, overflowLabel, label }) {
  return (
    <header className="ui-contextbar" aria-label={label}>
      {back ? (
        <UiButton kind="ghost" className="ui-iconbtn" aria-label={back.label ?? 'Back'} title={back.label ?? 'Back'} onClick={back.onClick}>
          <Icon name="chevronLeft" />
        </UiButton>
      ) : null}
      <h1 className="ui-contextbar__title">{title}</h1>
      {state != null ? (typeof state === 'string' ? <StateIndicator state={state} /> : state) : null}
      {meta ? <div className="ui-contextbar__meta">{meta}</div> : null}
      <span className="ui-contextbar__spacer" />
      <div className="ui-contextbar__actions">
        {actions}
        {primary ? (
          <UiButton kind="primary" onClick={primary.onClick} disabled={primary.disabled} busy={primary.busy} title={primary.title}>
            {primary.label}
          </UiButton>
        ) : null}
        {overflow ? <MoreMenu items={overflow} label={overflowLabel} /> : null}
      </div>
    </header>
  );
}

/* ————— forms ————— */

/** A form column capped at 720px so controls never stretch across the stage. */
export function FormPane({ children, className, ...props }) {
  return <div className={cx('ui-form', className)} {...props}>{children}</div>;
}

/**
 * The one sticky save footer. Shown while `dirty`, `saving` or `error`;
 * hidden otherwise. ⌘S / Ctrl+S saves while dirty. Save is the primary.
 */
export function SaveBar({ dirty = false, saving = false, error, onSave, onDiscard, saveLabel = 'Save changes', discardLabel = 'Discard', message }) {
  useEffect(() => {
    if (!dirty || saving || !onSave || typeof window === 'undefined') return undefined;
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dirty, saving, onSave]);
  if (!dirty && !saving && !error) return null;
  const errText = error ? (typeof error === 'string' ? error : error.message ?? 'Could not save.') : null;
  return (
    <div className="ui-savebar" role="region" aria-label="Unsaved changes">
      <span className="ui-savebar__msg" aria-live="polite" data-error={errText ? '' : undefined}>
        {errText ?? (saving ? 'Saving…' : message ?? 'You have unsaved changes.')}
      </span>
      {onDiscard ? <UiButton kind="ghost" onClick={onDiscard} disabled={saving}>{discardLabel}</UiButton> : null}
      <UiButton kind="primary" onClick={onSave} busy={saving} disabled={!dirty && !error} title="⌘S">
        {saving ? 'Saving…' : saveLabel}
      </UiButton>
    </div>
  );
}

/* ————— Shell ————— */

export const HOST_MODES = Object.freeze(['embedded', 'standalone']);

/**
 * The app frame. `hostMode="embedded"`: the desktop app owns sidebar,
 * titlebar and status bar, so Shell renders only the stage — `sidebar` and
 * `statusBar` are ignored (no shell-in-shell). `hostMode="standalone"`: the web
 * host gets the 220px sidebar slot and 24px status bar around the stage.
 * `theme`: 'light' | 'dark' to force one; omitted, the host decides.
 */
export function Shell({ hostMode = 'standalone', sidebar, statusBar, theme, children, className, navLabel = 'Admin' }) {
  const mode = hostMode === 'embedded' ? 'embedded' : 'standalone';
  const embedded = mode === 'embedded';
  return (
    <div className={cx('ui', 'ui-shell', className)} data-host={mode} data-theme={theme}>
      <UiStyles />
      <div className="ui-shell__body">
        {!embedded && sidebar ? <nav className="ui-shell__sidebar" aria-label={navLabel}>{sidebar}</nav> : null}
        {embedded ? <div className="ui-shell__stage">{children}</div> : <main className="ui-shell__stage">{children}</main>}
      </div>
      {!embedded && statusBar ? <footer className="ui-shell__status">{statusBar}</footer> : null}
    </div>
  );
}
