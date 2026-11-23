/*
 * The one menu (role="menu"). Every action menu in the admin — row context
 * menus, the "…" overflow, header menus — renders this component, through
 * Menu, OverflowMenu or useContextMenu; feature views do not hand-roll one.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTop, useLayer, useUid } from './layer.js';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * A menu of actions at a point or under an anchor. Items:
 * `{ label, run, hint, shortcut, danger, disabled, disabledReason }`,
 * `{ label, href }` (a link: opens in a new tab, marked ↗),
 * `{ separator: true }` or `{ heading: 'Label' }`. Arrows/Home/End move,
 * typing jumps, Return or Space runs, Escape or Tab closes; focus returns to
 * whatever had it when the menu opened.
 */
export function Menu({ items, at, anchor, onClose, label = 'Actions' }) {
  const ref = useRef(null);
  const layer = useLayer();
  const list = items.filter(Boolean);
  const actionable = list.map((it, i) => (it.separator || it.heading || it.disabled ? -1 : i)).filter((i) => i >= 0);
  const [active, setActive] = useState(actionable[0] ?? -1);
  const [pos, setPos] = useState(() => ({ left: at?.x ?? 0, top: at?.y ?? 0, visibility: 'hidden' }));
  const opener = useRef(null);
  const typed = useRef({ text: '', at: 0 });

  useLayoutEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = at?.x ?? 0;
    let top = at?.y ?? 0;
    if (anchor?.current) {
      const a = anchor.current.getBoundingClientRect();
      left = a.right - r.width;
      top = a.bottom + 4;
      if (left < 8) left = a.left;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, (anchor?.current ? anchor.current.getBoundingClientRect().top - 4 : top) - r.height);
    setPos({ left, top, visibility: 'visible' });
    // A visibility:hidden element cannot take focus, and the state above lands
    // only on the next render: show it now, or focus stays on the opener and
    // Escape, the arrows and Return never reach the menu.
    el.style.visibility = 'visible';
    el.focus();
  }, []);

  const close = useCallback((restore = true) => {
    onClose();
    if (restore) opener.current?.focus?.();
  }, [onClose]);

  useEffect(() => {
    const down = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close(false);
    };
    const blur = () => close(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, [close]);

  const run = (item) => {
    if (!item || item.disabled || item.separator || item.heading) return;
    if (item.href) {
      // Synchronously, inside the user's gesture, so no popup blocker objects.
      window.open(item.href, '_blank', 'noopener,noreferrer');
      close(false);
      return;
    }
    close(true);
    // After focus has gone back, so a dialog the action opens returns there too.
    setTimeout(() => item.run?.(), 0);
  };
  const step = (dir) => {
    if (!actionable.length) return;
    const at0 = actionable.indexOf(active);
    const next = at0 < 0 ? (dir > 0 ? 0 : actionable.length - 1) : (at0 + dir + actionable.length) % actionable.length;
    setActive(actionable[next]);
  };
  const onKey = (e) => {
    if (!isTop(layer)) return;
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(actionable[0]); }
    else if (e.key === 'End') { e.preventDefault(); setActive(actionable[actionable.length - 1]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(list[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') { e.preventDefault(); close(true); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = actionable.find((i) => String(list[i].label).toLowerCase().startsWith(typed.current.text));
      if (hit != null) setActive(hit);
    }
  };
  const menuId = useUid('aw-menu');
  return (
    <ul
      ref={ref}
      id={menuId}
      className="aw-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      aria-activedescendant={active >= 0 ? `${menuId}-${active}` : undefined}
      style={pos}
      onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {list.map((item, i) =>
        item.separator ? (
          <li key={`s${i}`} className="aw-menu__sep" role="separator" />
        ) : item.heading ? (
          <li key={`h${i}`} className="aw-menu__label" role="presentation">{item.heading}</li>
        ) : (
          <li
            key={`${item.label}-${i}`}
            id={`${menuId}-${i}`}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            className={cx('aw-menu__item', item.danger && 'aw-menu__item--danger', i === active && 'is-active')}
            title={item.disabled ? item.disabledReason : item.hint}
            onMouseEnter={() => setActive(item.disabled ? -1 : i)}
            onClick={() => run(item)}
          >
            <span>{item.label}{item.href ? <span aria-hidden="true"> ↗</span> : null}{item.href ? <span className="aw-sr"> (opens in a new tab)</span> : null}{item.disabled && item.disabledReason ? <span className="aw-sr"> — {item.disabledReason}</span> : null}</span>
            {item.shortcut ? <small>{item.shortcut}</small> : null}
          </li>
        ),
      )}
    </ul>
  );
}
