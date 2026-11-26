/*
 * Choose a ticket's project: a field-shaped button that opens a searchable
 * list grouped by client, the ticket's own client first. Replaces a native
 * <select> that listed every project flat, which stops working once there are
 * more than a handful. Arrows move, Return picks, Escape closes; focus goes
 * back to the button.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isTop, useLayer, useUid } from './ui/layer.js';
import { flatItems, groupProjects } from './project-picker-model.mjs';

const NONE = { id: null, name: 'No project' };

export function ProjectPicker({ projects = [], value = null, clientEmail = null, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const current = projects.find((p) => p.id === value);
  const owner = current?.clients?.find((c) => clientEmail && c.email?.toLowerCase() === clientEmail.toLowerCase()) ?? current?.clients?.[0];
  return (
    <div className="aw-picker">
      <button
        ref={button}
        type="button"
        className="aw-picker__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="aw-picker__value">{current ? current.name || current.slug : 'No project'}</span>
        {owner ? <small className="aw-picker__owner">{owner.name || owner.email}</small> : null}
        <span className="aw-picker__chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <PickerList
          projects={projects}
          value={value}
          clientEmail={clientEmail}
          anchor={button}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
          onPick={(id) => {
            setOpen(false);
            button.current?.focus();
            if (id !== value) onChange?.(id);
          }}
        />
      ) : null}
    </div>
  );
}

function PickerList({ projects, value, clientEmail, anchor, onClose, onPick }) {
  const layer = useLayer();
  const uid = useUid('aw-picker');
  const panel = useRef(null);
  const list = useRef(null);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupProjects(projects, { query, clientEmail }), [projects, query, clientEmail]);
  // "No project" leads the list while there is no search.
  const items = useMemo(() => [...(query ? [] : [NONE]), ...flatItems(groups)], [groups, query]);
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => i.id === value)));
  const [pos, setPos] = useState({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = panel.current;
    if (!a || !el) return;
    const width = Math.max(a.width, 320);
    const left = Math.max(8, Math.min(a.left, window.innerWidth - width - 8));
    const below = window.innerHeight - a.bottom - 12;
    const top = below >= 240 || below >= a.top ? a.bottom + 4 : Math.max(8, a.top - 4 - Math.min(el.offsetHeight, a.top - 12));
    setPos({ left, top, width, maxHeight: Math.max(200, below >= 240 || below >= a.top ? below : a.top - 12) });
  }, [anchor]);

  useEffect(() => {
    const down = (e) => {
      if (panel.current?.contains(e.target) || anchor.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [anchor, onClose]);

  useEffect(() => setActive((n) => Math.min(n, Math.max(0, items.length - 1))), [items.length]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const key = (e) => {
    if (e.key === 'Escape') {
      if (!isTop(layer)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((n) => Math.min(items.length - 1, n + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((n) => Math.max(0, n - 1)));
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) onPick(items[active].id);
    } else if (e.key === 'Tab') onClose();
  };

  let n = query ? 0 : 1;
  const option = (item, index) => (
    <li
      key={item.id ?? 'none'}
      id={`${uid}-${index}`}
      role="option"
      aria-selected={index === active}
      className={index === active ? 'is-active' : undefined}
      onMouseEnter={() => setActive(index)}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick(item.id);
      }}
    >
      <span>{item.name}</span>
      {item.hint ? <small>{item.hint}</small> : null}
      {item.id === value ? <span className="aw-picker__check" aria-label="current">✓</span> : null}
    </li>
  );

  return (
    <div ref={panel} className="aw-picker__panel" style={pos} role="dialog" aria-label="Choose a project">
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={`${uid}-list`}
        aria-autocomplete="list"
        aria-activedescendant={items[active] ? `${uid}-${active}` : undefined}
        aria-label="Search projects and clients"
        placeholder="Search projects or clients…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={key}
      />
      <ul ref={list} id={`${uid}-list`} role="listbox" aria-label="Projects">
        {query ? null : option(NONE, 0)}
        {groups.map((group) => (
          <li key={group.key} role="presentation" className="aw-picker__group">
            <div className="aw-picker__heading" role="presentation">
              {group.label}
              {group.own ? <small>this ticket’s client</small> : null}
            </div>
            <ul role="group" aria-label={group.label}>
              {group.items.map((item) => option(item, n++))}
            </ul>
          </li>
        ))}
        {!groups.length ? <li className="aw-picker__empty" role="presentation">No project or client matches “{query}”.</li> : null}
      </ul>
    </div>
  );
}
