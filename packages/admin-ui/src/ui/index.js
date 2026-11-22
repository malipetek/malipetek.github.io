/*
 * The one import path for admin UI (06-design-system.md §7.2):
 *
 *   import { DataTable, Inspector, StateIndicator, Button } from './ui/index.js';
 *
 * v2 primitives live in this folder. The legacy primitives from ../ui.jsx are
 * re-exported unchanged so views can move to this path one import at a time;
 * each legacy export is replaced here, not renamed, when its v2 version lands.
 */
export * from '../ui.jsx';
export { StateIndicator, MetaChip, DataTable, Inspector, ContextBar, SaveBar, FormPane, Shell, UiStyles, HOST_MODES } from './primitives.jsx';
export { STATE_MAP, TONES, resolveState, humanize } from './state.js';
export { TOKENS, TOKEN_NAMES, TOKENS_CSS, TYPE, SPACE, RADII, MOTION, SIZE } from './tokens.js';
export { UI_CSS } from './css.js';
export { tableKeyAction, clampWidth, readWidth, writeWidth, resizeKey } from './behavior.js';
