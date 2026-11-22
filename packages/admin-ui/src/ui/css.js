/*
 * The v2 primitive stylesheet. Tokens only: no hex, no px font sizes, no
 * `!important` (scripts/ui-conformance.mjs gate A3). Every class is `ui-`.
 * Injected once by <Shell> or <UiStyles>.
 */
import { TOKENS_CSS } from './tokens.js';

const PRIMITIVES_CSS = `
.ui {
  font-family: var(--ui-font);
  font-size: var(--ui-fs-md);
  line-height: var(--ui-lh);
  color: var(--ui-ink);
  background: var(--ui-bg);
}
.ui-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
:where(.ui, .aw) :where(.ui-btn, .ui-row, .ui-resize, .ui-inspector, .ui-iconbtn, .ui-table__sort, .ui-disclosure > summary):focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: -2px;
}

/* —— buttons (internal to the primitives) —— */
.ui-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--ui-sp-1);
  height: var(--ui-ctl-h); padding: 0 var(--ui-sp-3);
  border: 1px solid var(--ui-border-strong); border-radius: var(--ui-r-md);
  background: var(--ui-bg-raised); color: var(--ui-ink);
  font: inherit; font-size: var(--ui-fs-md); font-weight: 500; white-space: nowrap;
  cursor: pointer; transition: background var(--ui-dur) var(--ui-ease);
}
.ui-btn:hover:not(:disabled) { background: var(--ui-bg-hover); }
.ui-btn:disabled { opacity: .5; cursor: not-allowed; }
.ui-btn--sm { height: var(--ui-ctl-h-sm); padding: 0 var(--ui-sp-2); font-size: var(--ui-fs-sm); }
.ui-btn--ghost { border-color: transparent; background: transparent; }
.ui-btn--primary { border-color: transparent; background: var(--ui-accent); color: var(--ui-accent-ink); }
.ui-btn--primary:hover:not(:disabled) { background: var(--ui-accent-hover); }
.ui-iconbtn { width: var(--ui-ctl-h); padding: 0; }

/* —— StateIndicator: 6px dot + label, transparent background —— */
.ui-state {
  display: inline-flex; align-items: center; gap: var(--ui-sp-1);
  font-size: var(--ui-fs-sm); font-weight: 500; line-height: var(--ui-lh-tight);
  color: var(--ui-ink-2); background: transparent; white-space: nowrap;
}
.ui-state__dot {
  --ui-tone: var(--ui-ink-3);
  width: 6px; height: 6px; border-radius: 50%; flex: none;
  background: var(--ui-tone);
}
.ui-state[data-tone='ok'] .ui-state__dot { --ui-tone: var(--ui-ok); }
.ui-state[data-tone='warn'] .ui-state__dot { --ui-tone: var(--ui-warn); }
.ui-state[data-tone='bad'] .ui-state__dot { --ui-tone: var(--ui-bad); }
.ui-state[data-tone='info'] .ui-state__dot { --ui-tone: var(--ui-info); }
.ui-state[data-ring] .ui-state__dot { background: transparent; box-shadow: inset 0 0 0 1.5px var(--ui-tone); }
.ui-state[data-dashed] .ui-state__dot { background: transparent; border: 1px dashed var(--ui-tone); }
.ui-state[data-live] .ui-state__dot { animation: ui-pulse 1.6s var(--ui-ease) infinite; }
.ui-state--dot-only { gap: 0; }
@keyframes ui-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .ui-state[data-live] .ui-state__dot { animation: none; } }

/* —— MetaChip: monochrome metadata, never a status colour —— */
.ui-chip {
  display: inline-flex; align-items: center; height: 18px; padding: 0 var(--ui-sp-1);
  border-radius: var(--ui-r-sm); background: var(--ui-bg-selected); color: var(--ui-ink-2);
  font-size: var(--ui-fs-xs); font-weight: 500; white-space: nowrap; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis;
}
.ui-chip--mono { font-family: var(--ui-mono); font-variant-numeric: tabular-nums; }

/* —— DataTable —— */
.ui-table-wrap { container-type: inline-size; min-width: 0; }
.ui-table { width: 100%; border-collapse: collapse; font-size: var(--ui-fs-md); }
.ui-table th {
  height: var(--ui-row-h); padding: 0 var(--ui-sp-3); text-align: left;
  font-size: var(--ui-fs-xs); font-weight: 500; color: var(--ui-ink-3);
  border-bottom: 1px solid var(--ui-border); white-space: nowrap;
}
.ui-table td {
  height: var(--ui-row-h); padding: 0 var(--ui-sp-3);
  border-bottom: 1px solid var(--ui-border); vertical-align: middle;
  max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ui-table :is(th, td)[data-fit] { width: 1%; max-width: none; }
.ui-table :is(th, td)[data-numeric] { text-align: right; font-variant-numeric: tabular-nums; }
.ui-table td[data-mono] { font-family: var(--ui-mono); font-variant-numeric: tabular-nums; }
.ui-row { cursor: default; outline: none; transition: background var(--ui-dur) var(--ui-ease); }
.ui-row:hover { background: var(--ui-bg-hover); }
.ui-row[aria-selected='true'] { background: var(--ui-bg-selected); box-shadow: inset 2px 0 0 var(--ui-accent); }
.ui-row--skeleton td::after {
  content: ''; display: block; height: 8px; border-radius: var(--ui-r-sm);
  background: var(--ui-bg-selected);
}
.ui-table__sort {
  display: inline-flex; align-items: center; gap: var(--ui-sp-1); height: 100%;
  padding: 0; border: 0; background: transparent; color: inherit;
  font: inherit; cursor: pointer;
}
.ui-table__sort:hover { color: var(--ui-ink); }
.ui-table__arrow { display: inline-block; min-width: 1ch; }
.ui-table__note { padding: var(--ui-sp-5) var(--ui-sp-4); color: var(--ui-ink-2); font-size: var(--ui-fs-md); }
.ui-table__note strong { display: block; color: var(--ui-ink); font-weight: 500; margin-bottom: var(--ui-sp-1); }
.ui-table__note--error strong { color: var(--ui-bad); }
.ui-table__note .ui-btn { margin-top: var(--ui-sp-2); }
@container (max-width: 720px) {
  .ui-table, .ui-table tbody, .ui-table tr, .ui-table td { display: block; width: auto; }
  .ui-table thead { display: none; }
  .ui-table tr.ui-row { padding: var(--ui-sp-2) var(--ui-sp-3); border-bottom: 1px solid var(--ui-border); }
  .ui-table td { height: auto; max-width: none; padding: 0; border: 0; white-space: normal; text-align: left; }
  .ui-table td[data-numeric] { text-align: left; }
  .ui-table td + td { margin-top: var(--ui-sp-1); font-size: var(--ui-fs-sm); color: var(--ui-ink-2); }
  .ui-table td + td[data-label]::before { content: attr(data-label) ' · '; color: var(--ui-ink-3); }
}

/* —— Inspector: resizable right pane —— */
.ui-inspector {
  position: relative; display: flex; flex-direction: column; min-width: 0;
  width: var(--ui-inspector-w); flex: none;
  border-left: 1px solid var(--ui-border); background: var(--ui-bg-subtle);
}
.ui-inspector__head {
  display: flex; align-items: center; gap: var(--ui-sp-2);
  height: var(--ui-bar-h); padding: 0 var(--ui-sp-2) 0 var(--ui-sp-4);
  border-bottom: 1px solid var(--ui-border); flex: none;
}
.ui-inspector__title {
  flex: 1; min-width: 0; margin: 0; font-size: var(--ui-fs-lg); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ui-inspector__body { flex: 1; min-height: 0; overflow: auto; padding: var(--ui-sp-4); }
.ui-resize {
  position: absolute; top: 0; bottom: 0; left: -3px; width: 6px; cursor: col-resize; z-index: 1;
  background: transparent; transition: background var(--ui-dur) var(--ui-ease);
}
.ui-resize:hover, .ui-resize[data-drag] { background: var(--ui-accent-wash); }
@media (max-width: 900px) {
  .ui-inspector { width: 100%; border-left: 0; border-top: 1px solid var(--ui-border); }
  .ui-resize { display: none; }
}

/* —— Workspace: a collection with its Inspector beside it, never over it —— */
.ui-workspace {
  display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0;
  padding: var(--ui-sp-4) var(--ui-sp-5) 0;
}
.ui-split { flex: 1; min-height: 0; min-width: 0; display: flex; gap: var(--ui-sp-3); }
.ui-split__main {
  flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  overflow: auto; padding-bottom: var(--ui-sp-4);
}
.ui-split > .ui-inspector { margin-bottom: var(--ui-sp-4); border: 1px solid var(--ui-border); border-radius: var(--ui-r-lg); }
.ui-selectable[data-selected] { border-color: var(--ui-accent); box-shadow: inset 2px 0 0 var(--ui-accent); }
@media (max-width: 900px) {
  .ui-workspace { height: auto; padding: var(--ui-sp-3) var(--ui-sp-3) 0; }
  .ui-split { flex-direction: column; flex: none; }
  .ui-split__main { flex: none; overflow: visible; }
}

/* —— Inspector content: properties, sections, one action row —— */
.ui-props {
  display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--ui-sp-1) var(--ui-sp-3);
  margin: 0; font-size: var(--ui-fs-sm);
}
.ui-props dt { color: var(--ui-ink-3); }
.ui-props dd { margin: 0; min-width: 0; color: var(--ui-ink); overflow-wrap: anywhere; }
.ui-section { margin-top: var(--ui-sp-4); }
.ui-section__title { margin: 0 0 var(--ui-sp-2); font-size: var(--ui-fs-xs); font-weight: 500; color: var(--ui-ink-3); }
.ui-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-sp-2); margin: var(--ui-sp-3) 0; }
.ui-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-sp-2); font-size: var(--ui-fs-xs); color: var(--ui-ink-3); }
.ui-meta strong { color: var(--ui-ink-2); font-weight: 500; }
.ui-quote {
  margin: var(--ui-sp-1) 0 0; font-size: var(--ui-fs-sm); color: var(--ui-ink-2); white-space: pre-wrap;
  overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
}
.ui-note { margin: 0; font-size: var(--ui-fs-sm); color: var(--ui-ink-3); }

/* —— Disclosure: a collapsible section, closed until asked —— */
.ui-disclosure { margin: var(--ui-sp-3) 0; border: 1px solid var(--ui-border); border-radius: var(--ui-r-lg); background: var(--ui-bg-subtle); }
.ui-disclosure > summary {
  display: flex; align-items: center; gap: var(--ui-sp-2); min-height: var(--ui-bar-h);
  padding: 0 var(--ui-sp-3); cursor: pointer; list-style: none;
  font-size: var(--ui-fs-md); font-weight: 500; color: var(--ui-ink);
  border-radius: var(--ui-r-lg);
}
.ui-disclosure > summary::-webkit-details-marker { display: none; }
.ui-disclosure > summary::before {
  content: '▸'; color: var(--ui-ink-3); transition: transform var(--ui-dur) var(--ui-ease);
}
.ui-disclosure[open] > summary::before { transform: rotate(90deg); }
.ui-disclosure__hint { margin-left: auto; font-size: var(--ui-fs-xs); font-weight: 400; color: var(--ui-ink-3); }
.ui-disclosure__body { padding: var(--ui-sp-3); border-top: 1px solid var(--ui-border); min-width: 0; }

/* —— ContextBar: 38px, one primary at most —— */
.ui-contextbar {
  display: flex; align-items: center; gap: var(--ui-sp-2); min-width: 0;
  height: var(--ui-bar-h); padding: 0 var(--ui-sp-3) 0 var(--ui-sp-4);
  border-bottom: 1px solid var(--ui-border); background: var(--ui-bg); flex: none;
}
.ui-contextbar__title {
  margin: 0; min-width: 0; font-size: var(--ui-fs-lg); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ui-contextbar__meta { display: flex; align-items: center; gap: var(--ui-sp-2); min-width: 0; color: var(--ui-ink-2); font-size: var(--ui-fs-sm); }
.ui-contextbar__spacer { flex: 1; }
.ui-contextbar__actions { display: flex; align-items: center; gap: var(--ui-sp-1); flex: none; }

/* —— forms and SaveBar —— */
.ui-form { max-width: var(--ui-form-max); }
.ui-savebar {
  position: sticky; bottom: 0; z-index: 2;
  display: flex; align-items: center; gap: var(--ui-sp-2);
  min-height: var(--ui-bar-h); padding: var(--ui-sp-1) var(--ui-sp-4);
  border-top: 1px solid var(--ui-border); background: var(--ui-bg);
}
.ui-savebar__msg { flex: 1; min-width: 0; font-size: var(--ui-fs-sm); color: var(--ui-ink-2); }
.ui-savebar__msg[data-error] { color: var(--ui-bad); }

/* —— Shell —— */
.ui-shell { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.ui-shell__body { flex: 1; min-height: 0; display: flex; }
.ui-shell__sidebar {
  width: var(--ui-sidebar-w); flex: none; overflow: auto;
  border-right: 1px solid var(--ui-border); background: var(--ui-bg-subtle); font-size: var(--ui-fs-sm);
}
.ui-shell__stage { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
.ui-shell__status {
  height: var(--ui-status-h); flex: none; display: flex; align-items: center; gap: var(--ui-sp-3);
  padding: 0 var(--ui-sp-3); border-top: 1px solid var(--ui-border);
  font-size: var(--ui-fs-xs); color: var(--ui-ink-2); background: var(--ui-bg-subtle);
}
@media (max-width: 900px) {
  .ui-shell__body { flex-direction: column; }
  .ui-shell__sidebar { width: auto; border-right: 0; border-bottom: 1px solid var(--ui-border); }
}
`;

export const UI_CSS = TOKENS_CSS + PRIMITIVES_CSS;
