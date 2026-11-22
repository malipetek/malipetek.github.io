/*
 * Pure behaviour behind the v2 primitives: keyboard mapping, width clamping,
 * persisted sizes. No React, no DOM, so it is unit-tested directly.
 */
import { nextRowIndex } from '../row-navigation.mjs';
import { SIZE } from './tokens.js';

/**
 * What a key press on a DataTable row means.
 * Returns `{ type: 'move', index }`, `{ type: 'open' }`, `{ type: 'menu' }` or null.
 * j/k/↑/↓/Home/End move (clamped, no wrap); Enter opens; Shift+F10 or the
 * ContextMenu key opens the row menu. Modified keys (⌘/Ctrl/Alt) are ignored
 * so host shortcuts keep working.
 */
export function tableKeyAction(e, current, count) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) return { type: 'menu' };
  if (e.shiftKey) return null;
  if (e.key === 'Enter') return current >= 0 && current < count ? { type: 'open' } : null;
  const index = nextRowIndex(current, count, e.key);
  return index == null ? null : { type: 'move', index };
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Inspector width: a finite number clamped to [min, max], else the default. */
export function clampWidth(value, { min = SIZE.inspectorMin, max = SIZE.inspectorMax, def = SIZE.inspector } = {}) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return clamp(def, min, max);
  return clamp(Math.round(n), min, max);
}

/** Read a persisted width; a missing, broken or blocked store gives the default. */
export function readWidth(storage, key, limits = {}) {
  if (!key) return clampWidth(undefined, limits);
  try {
    const raw = storage?.getItem?.(key);
    return clampWidth(raw == null ? undefined : raw, limits);
  } catch {
    return clampWidth(undefined, limits);
  }
}

export function writeWidth(storage, key, width) {
  if (!key) return;
  try {
    storage?.setItem?.(key, String(width));
  } catch {
    /* private mode or quota: the width just is not remembered */
  }
}

/** Keyboard resize step for a separator: ←/→ by 16px, Home/End to the limits. */
export function resizeKey(key, width, { min = SIZE.inspectorMin, max = SIZE.inspectorMax, step = 16, invert = true } = {}) {
  const dir = invert ? -1 : 1;
  if (key === 'ArrowLeft') return clamp(width - step * dir, min, max);
  if (key === 'ArrowRight') return clamp(width + step * dir, min, max);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}
