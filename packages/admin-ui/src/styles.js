/*
 * The workbench's CSS, injected by the app itself so both hosts get the same
 * styles with no build step for CSS. Colours follow the host: the Harness theme
 * tokens when present, the site's palette otherwise.
 *
 * Contract: docs/admin-ui-refresh/01-ui-contract.md. Tokens first; feature
 * rules use tokens only. Raw colour values come from ui/tokens.js (gate A3);
 * the pre-contract alias names (--aw-text, --aw-border, --aw-sp-*…) are gone.
 *
 * `:not(#aw-override)` is the one specificity bump that replaces `!important`
 * (gate A3): it lifts a declaration above every class-level rule, as
 * `!important` did, while keeping the order between the bumped rules.
 */
import { ACCENT, ACCENT_INK, LEGACY_LITERALS, PALETTE } from './ui/tokens.js';

const LIGHT = PALETTE.light;

export const STYLES = `
.aw {
  /* —— colour —— */
  --aw-surface: var(--dsw-alias-bg-base, var(--bone, ${LIGHT.bg}));
  --aw-surface-sidebar: var(--dsw-alias-bg-layer-1, var(--paper, ${LEGACY_LITERALS.paper}));
  --aw-surface-raised: var(--dsw-alias-bg-base, var(--bone, ${LIGHT.bg}));
  --aw-ink: var(--dsw-alias-label-primary, var(--ink, ${LIGHT.ink}));
  --aw-ink-2: var(--dsw-alias-label-secondary, var(--ink-soft, ${LIGHT['ink-2']}));
  --aw-ink-3: color-mix(in srgb, var(--aw-ink-2) 68%, var(--aw-surface));
  --aw-fill: var(--dsw-alias-bg-layer-2, color-mix(in srgb, var(--aw-ink) 6%, var(--aw-surface)));
  --aw-hover: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--aw-ink) 6%, transparent));
  --aw-selected: color-mix(in srgb, var(--aw-ink) 9%, transparent);
  --aw-hairline: var(--dsw-alias-border-l2, color-mix(in srgb, var(--aw-ink) 11%, var(--aw-surface)));
  --aw-hairline-strong: var(--dsw-alias-border-l3, color-mix(in srgb, var(--aw-ink) 20%, var(--aw-surface)));
  --aw-accent: var(--orange, ${ACCENT});
  --aw-accent-ink: ${ACCENT_INK};
  --aw-accent-wash: color-mix(in srgb, var(--aw-accent) 12%, transparent);
  --aw-ok: var(--dsw-alias-state-success-primary, ${LIGHT.ok});
  --aw-warn: var(--dsw-alias-state-warn-primary, ${LIGHT.warn});
  --aw-bad: var(--dsw-alias-state-error-primary, ${LIGHT.bad});
  --aw-info: var(--dsw-alias-state-business-primary, ${LIGHT.info});
  --aw-ok-wash: color-mix(in srgb, var(--aw-ok) 12%, transparent);
  --aw-warn-wash: color-mix(in srgb, var(--aw-warn) 14%, transparent);
  --aw-bad-wash: color-mix(in srgb, var(--aw-bad) 11%, transparent);
  --aw-info-wash: color-mix(in srgb, var(--aw-info) 11%, transparent);
  --aw-ok-ink: color-mix(in srgb, var(--aw-ok) 82%, var(--aw-ink));
  --aw-warn-ink: color-mix(in srgb, var(--aw-warn) 68%, var(--aw-ink));
  --aw-bad-ink: color-mix(in srgb, var(--aw-bad) 88%, var(--aw-ink));
  --aw-info-ink: color-mix(in srgb, var(--aw-info) 85%, var(--aw-ink));
  --aw-focus: var(--aw-accent);
  --aw-scrim: rgba(0, 0, 0, .32);
  /* —— shape, space, type —— */
  --aw-radius-sm: 4px;
  --aw-radius-md: 6px;
  --aw-radius-lg: 8px;
  --aw-radius-pill: 999px;
  --aw-space-1: 4px;
  --aw-space-2: 8px;
  --aw-space-3: 12px;
  --aw-space-4: 16px;
  --aw-space-5: 24px;
  --aw-space-6: 32px;
  --aw-font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, system-ui, sans-serif;
  --aw-mono: var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  --aw-type-xs: 11px;
  --aw-type-sm: 12px;
  --aw-type-md: 13px;
  --aw-type-lg: 15px;
  --aw-type-xl: 18px;
  --aw-measure: 72ch;
  --aw-measure-table: 1180px;
  /* —— geometry —— */
  --aw-row-h: 32px;
  --aw-row-h-tight: 28px;
  --aw-row-h-table: 36px;
  --aw-bar-h: 38px;
  --aw-status-h: 24px;
  --aw-activity-w: 48px;
  --aw-shadow-float: 0 0 0 1px color-mix(in srgb, var(--aw-ink) 10%, transparent), 0 12px 32px rgba(0, 0, 0, .18);
  --aw-dur: 140ms;
  --aw-ease: cubic-bezier(.2, 0, 0, 1);

  display: grid;
  grid-template-columns: var(--aw-activity-w) auto minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) var(--aw-status-h);
  grid-template-areas: "act exp main" "status status status";
  height: 100%;
  min-height: 0;
  background: var(--aw-surface);
  color: var(--aw-ink);
  font: var(--aw-type-md)/1.45 var(--aw-font);
  -webkit-font-smoothing: antialiased;
  position: relative;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) { .aw { --aw-dur: 0ms; } }
.aw *, .aw *::before, .aw *::after { box-sizing: border-box; }
.aw--fullscreen { position: fixed; inset: 0; z-index: 50; height: 100dvh; }
/* A standalone panel (Harness ticket, client, side panel): block layout, because .aw is also the shell's grid. */
.aw.aw--scroll { display: block; height: 100%; overflow-y: auto; }
.aw.aw--page { display: block; padding: 18px var(--ui-sp-5, 24px) 28px; max-width: 820px; margin: 0 auto; }
.aw h2, .aw h3, .aw h4 { font-family: inherit; margin: 0; letter-spacing: 0; }
.aw button { font: inherit; color: inherit; }
.aw a { color: inherit; }
.aw input, .aw select, .aw textarea {
  font: inherit; color: var(--aw-ink); background: var(--aw-surface);
  border: 1px solid var(--aw-hairline-strong); border-radius: var(--aw-radius-md); padding: 5px 8px; min-width: 0; min-height: 30px;
}
.aw select { padding-right: 24px; }
.aw input[type=checkbox], .aw input[type=radio] { min-height: 0; accent-color: var(--aw-accent); }
.aw textarea { width: 100%; resize: vertical; line-height: 1.5; }
.aw input::placeholder, .aw textarea::placeholder { color: var(--aw-ink-3); }
.aw input:disabled, .aw select:disabled, .aw textarea:disabled { opacity: .6; }
.aw input[aria-invalid=true] { border-color: var(--aw-bad); }
/* One focus ring: 2px focus colour outside controls, inset on fields. */
.aw :is(button, a, summary, [role=tab], [role=option], [role=menuitem], [tabindex]):focus-visible { outline: 2px solid var(--aw-focus); outline-offset: 2px; }
.aw :is(input, select, textarea):focus { outline: none; }
.aw :is(input, select, textarea):focus-visible, .aw :is(input, select, textarea):focus { outline: 2px solid color-mix(in srgb, var(--aw-focus) 55%, transparent); outline-offset: -1px; }
.aw [hidden]:not(#aw-override) { display: none; }
.aw-sr { width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.aw-sr:not(#aw-override) { position: absolute; }
.aw-mono { font-family: var(--aw-mono); font-size: var(--aw-type-sm); }
.aw-num, .aw-statrow, .aw-cost { font-variant-numeric: tabular-nums; }
.aw-muted { color: var(--aw-ink-2); }
.aw-faint { color: var(--aw-ink-3); }
.aw-warn { color: var(--aw-warn-ink); }
.aw-bad { color: var(--aw-bad-ink); }
.aw-center { text-align: center; }
.aw-link { background: none; border: 0; padding: 0; color: var(--aw-ink); text-decoration: underline; text-decoration-color: var(--aw-hairline-strong); text-underline-offset: 2px; cursor: pointer; }
.aw-link:hover { text-decoration-color: currentColor; }
.aw-link:disabled { color: var(--aw-ink-3); cursor: default; }
.aw-formset { border: 0; padding: 0; margin: 0; min-width: 0; }
.aw-muted.aw-unavailable { padding: var(--ui-sp-3, 12px); font-size: var(--ui-fs-sm, 12px); }
.aw-empty { padding: var(--aw-space-6) var(--aw-space-4); text-align: center; color: var(--aw-ink-2); }
.aw-callout { display: flex; align-items: flex-start; gap: var(--aw-space-2); padding: var(--aw-space-2) var(--aw-space-3); border-radius: var(--aw-radius-md); background: var(--aw-info-wash); margin: var(--aw-space-2) 0; overflow-wrap: anywhere; }
.aw-error { color: var(--aw-bad-ink); font-size: var(--aw-type-sm); }
.aw-toolbar__fill, .aw-tabs__fill, .aw-status__fill { flex: 1; }

/* ————— shell: activity bar ————— */
.aw-activity { grid-area: act; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: var(--aw-space-2) 0; background: var(--aw-surface-sidebar); border-right: 1px solid var(--aw-hairline); z-index: 9; }
.aw-activity button { position: relative; width: 36px; height: 36px; display: grid; place-items: center; border: 0; background: none; border-radius: var(--aw-radius-md); color: var(--aw-ink-3); cursor: pointer; transition: color var(--aw-dur) var(--aw-ease), background-color var(--aw-dur) var(--aw-ease); }
.aw-activity button:hover { background: var(--aw-hover); color: var(--aw-ink); }
.aw-activity button[aria-current=page], .aw-activity button[aria-pressed=true] { color: var(--aw-ink); }
.aw-activity button[aria-current=page]::before, .aw-activity button[aria-pressed=true]::before { content: ''; position: absolute; left: -6px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--aw-ink); }
.aw-activity__spacer { flex: 1; }
.aw--inset .aw-activity { padding-top: 40px; }
.aw--inset .aw-explorer { padding-top: 32px; }
.aw--inset.aw--noexplorer .aw-tabs { padding-left: 30px; }
.aw-badge { position: absolute; top: 3px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: var(--aw-radius-pill); background: var(--aw-ink); color: var(--aw-surface); font-size: var(--aw-type-xs); font-weight: 600; line-height: 15px; font-variant-numeric: tabular-nums; }

/* ————— tooltip: [data-tip], after 400ms; at once on keyboard focus ————— */
.aw [data-tip] { position: relative; }
/* Only drawn while hovered or focused, so a hidden tip never widens a pane. */
.aw [data-tip]:is(:hover, :focus-visible)::after { content: attr(data-tip); position: absolute; z-index: 40; pointer-events: none; white-space: pre; padding: 3px 8px; border-radius: var(--aw-radius-sm); background: var(--aw-ink); color: var(--aw-surface); font-size: var(--aw-type-xs); font-weight: 500; line-height: 1.5; right: 0; top: calc(100% + 6px); animation: aw-tip var(--aw-dur) var(--aw-ease) 400ms backwards; }
.aw [data-tip]:focus-visible::after { animation-delay: 0ms; }
.aw [data-tip-side=right]:is(:hover, :focus-visible)::after { left: calc(100% + 8px); right: auto; top: 50%; transform: translateY(-50%); }
.aw .aw-btnwrap[data-tip]:hover::after { left: 0; right: auto; }
@keyframes aw-tip { from { opacity: 0; } }
.aw-btnwrap { display: inline-flex; }

/* ————— shell: explorer ————— */
.aw-explorer { grid-area: exp; width: var(--aw-explorer-w, 260px); overflow: auto; background: var(--aw-surface-sidebar); border-right: 1px solid var(--aw-hairline); padding: 0 0 var(--aw-space-4); }
.aw-explorer h3, .aw-explorer__head { display: flex; align-items: center; gap: var(--aw-space-1); height: var(--aw-bar-h); padding: 0 var(--aw-space-2) 0 var(--aw-space-3); font-size: var(--aw-type-xs); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--aw-ink-3); }
.aw-explorer h3 .aw-btn { margin-left: auto; }
.aw-tree, .aw-tree ul { list-style: none; margin: 0; padding: 0; }
.aw-tree ul { padding-left: 0; }
.aw-tree__row { display: flex; align-items: center; height: var(--aw-row-h-tight); padding: 0 var(--aw-space-2) 0 var(--aw-space-1); border-radius: var(--aw-radius-sm); margin: 0 var(--aw-space-1); }
.aw-tree__row:hover { background: var(--aw-hover); }
.aw-tree__row.is-active { background: var(--aw-selected); }
.aw-tree__twist { flex: none; width: 18px; height: 18px; display: grid; place-items: center; border: 0; background: none; color: var(--aw-ink-3); cursor: pointer; padding: 0; border-radius: var(--aw-radius-sm); }
.aw-tree__twist svg { transition: transform var(--aw-dur) var(--aw-ease); }
.aw-tree__twist[aria-expanded=true] svg { transform: rotate(90deg); }
.aw-tree__name, .aw-tree__leaf { flex: 1; display: flex; align-items: center; gap: var(--aw-space-2); min-width: 0; height: 100%; border: 0; background: none; padding: 0 var(--aw-space-1); text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--aw-ink); }
.aw-tree__name { font-weight: 500; }
.aw-tree__name > span, .aw-tree__leaf > .aw-tree__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.aw-tree__name svg { flex: none; color: var(--aw-ink-3); }
.aw-tree__leafrow { display: flex; align-items: center; height: var(--aw-row-h-tight); margin: 0 var(--aw-space-1); padding: 0 var(--aw-space-2) 0 26px; border-radius: var(--aw-radius-sm); }
.aw-tree__leafrow:hover { background: var(--aw-hover); }
.aw-tree__leafrow.is-active { background: var(--aw-selected); }
.aw-tree__leaf { padding: 0; color: var(--aw-ink-2); }
.aw-tree__leafrow:hover .aw-tree__leaf, .aw-tree__leafrow.is-active .aw-tree__leaf { color: var(--aw-ink); }
.aw-tree__id { flex: none; color: var(--aw-ink-3); font-size: var(--aw-type-xs); font-variant-numeric: tabular-nums; }
.aw-tree__none { height: var(--aw-row-h-tight); display: flex; align-items: center; padding-left: 30px; color: var(--aw-ink-3); font-size: var(--aw-type-sm); }
.aw-count { margin-left: auto; padding-left: var(--aw-space-2); color: var(--aw-ink-3); font-size: var(--aw-type-xs); font-weight: 500; font-variant-numeric: tabular-nums; }
/* One status marker for the explorer: monochrome; filled = needs you, ring = open. */
.aw-mark { flex: none; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--aw-ink-3); }
.aw-mark--needs { background: var(--aw-ink-2); border-color: var(--aw-ink-2); }
.aw-mark--live { border-color: var(--aw-info); background: var(--aw-info); animation: aw-breathe 1.6s ease-in-out infinite; }
@keyframes aw-breathe { 50% { opacity: .35; } }

/* ————— shell: main, tab strip ————— */
.aw-main { grid-area: main; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.aw-tabs { flex: none; display: flex; align-items: stretch; height: var(--aw-bar-h); background: var(--aw-surface-sidebar); border-bottom: 1px solid var(--aw-hairline); }
.aw-tablist { display: flex; flex: 1; align-items: stretch; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { .aw-tablist { scroll-behavior: auto; } }
.aw-tablist::-webkit-scrollbar { display: none; }
.aw-tab { position: relative; flex: none; display: flex; align-items: center; gap: var(--aw-space-2); max-width: 220px; padding: 0 var(--aw-space-1) 0 var(--aw-space-3); border-right: 1px solid var(--aw-hairline); color: var(--aw-ink-2); cursor: default; white-space: nowrap; user-select: none; font-size: var(--aw-type-sm); }
.aw-tab svg { flex: none; color: var(--aw-ink-3); }
.aw-tab:hover { color: var(--aw-ink); }
.aw-tab.is-active { background: var(--aw-surface); color: var(--aw-ink); margin-bottom: -1px; }
.aw-tab.is-active::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--aw-accent); }
.aw-tab:focus-visible { outline: 2px solid var(--aw-focus); outline-offset: -2px; }
.aw-tab__label { overflow: hidden; text-overflow: ellipsis; }
.aw-tab__close { flex: none; display: grid; place-items: center; border: 0; background: none; width: 20px; height: 20px; padding: 0; border-radius: var(--aw-radius-sm); color: var(--aw-ink-3); cursor: pointer; opacity: 0; }
.aw-tab:hover .aw-tab__close, .aw-tab.is-active .aw-tab__close, .aw-tab__close:focus-visible { opacity: 1; }
.aw-tab__close:hover { background: var(--aw-hover); color: var(--aw-ink); }
.aw-tab__close:focus-visible { outline: 2px solid var(--aw-focus); outline-offset: -1px; }
.aw-tabs__toggle, .aw-tabs__end { flex: none; display: flex; align-items: center; gap: 2px; padding: 0 var(--aw-space-1); }
.aw-tabs__toggle { border-right: 1px solid var(--aw-hairline); }
.aw-tabs .aw-tabs__toggle.aw-btn { height: 100%; border: 0; border-right: 1px solid var(--aw-hairline); border-radius: 0; padding: 0 10px; color: var(--aw-ink-3); }
.aw-tabs__end { border-left: 1px solid var(--aw-hairline); }
.aw-content { flex: 1; min-height: 0; position: relative; }
.aw-pane { position: absolute; inset: 0; overflow: auto; container-type: size; }
.aw-view { padding: var(--aw-space-4) var(--aw-space-5) var(--aw-space-6); max-width: calc(var(--aw-measure-table) + 2 * var(--aw-space-5)); }
.aw-hero { margin-bottom: var(--aw-space-3); }
.aw-hero h2 { font-size: var(--aw-type-xl); font-weight: 600; }

/* ————— shell: status bar ————— */
.aw-status { grid-area: status; display: flex; align-items: center; gap: var(--aw-space-1); padding: 0 var(--aw-space-2); background: var(--aw-surface-sidebar); border-top: 1px solid var(--aw-hairline); color: var(--aw-ink-2); font-size: var(--aw-type-xs); white-space: nowrap; overflow: hidden; z-index: 9; }
.aw-status > * { flex: none; }
.aw-status > .aw-status__fill { flex: 1; }
.aw-status button { border: 0; background: none; padding: 0 var(--aw-space-2); height: var(--aw-status-h); display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: inherit; font-size: inherit; border-radius: 0; }
.aw-status button:hover { background: var(--aw-hover); color: var(--aw-ink); }
.aw-status__item { display: inline-flex; align-items: center; gap: 6px; padding: 0 var(--aw-space-2); }
.aw-status__err { color: var(--aw-bad-ink); }
.aw-status kbd, .aw-kbd { font: inherit; font-size: var(--aw-type-xs); color: var(--aw-ink-2); padding: 0 5px; border: 1px solid var(--aw-hairline); border-radius: var(--aw-radius-sm); background: var(--aw-surface); line-height: 16px; display: inline-block; min-width: 18px; text-align: center; }

/* ————— controls: buttons ————— */
.aw-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: var(--aw-radius-md); border: 1px solid var(--aw-hairline-strong); background: var(--aw-surface); color: var(--aw-ink); cursor: pointer; white-space: nowrap; font-weight: 500; font-size: var(--aw-type-md); line-height: 1; transition: background-color var(--aw-dur) var(--aw-ease), border-color var(--aw-dur) var(--aw-ease); }
.aw-btn:hover:not(:disabled) { background: var(--aw-hover); }
.aw-btn:active:not(:disabled) { background: var(--aw-selected); }
.aw-btn:disabled { color: var(--aw-ink-3); border-color: var(--aw-hairline); background: var(--aw-surface); cursor: default; }
.aw-btn--sm { height: 24px; padding: 0 8px; font-size: var(--aw-type-sm); gap: 4px; }
.aw-btn--primary { background: var(--aw-accent); border-color: transparent; }
.aw-btn--primary:not(#aw-override) { color: var(--aw-accent-ink); }
.aw-btn--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--aw-accent) 88%, ${LEGACY_LITERALS.shade}); }
.aw-btn--primary:active:not(:disabled) { background: color-mix(in srgb, var(--aw-accent) 80%, ${LEGACY_LITERALS.shade}); }
.aw-btn--primary:disabled { background: var(--aw-fill); border-color: transparent; opacity: 1; }
.aw-btn--primary:disabled:not(#aw-override) { color: var(--aw-ink-3); }
.aw-btn--danger:not(#aw-override) { color: var(--aw-bad-ink); }
.aw-btn--danger:hover:not(:disabled) { background: var(--aw-bad-wash); border-color: color-mix(in srgb, var(--aw-bad) 40%, transparent); }
.aw-btn--ghost { border-color: transparent; background: none; color: var(--aw-ink-2); }
.aw-btn--ghost:hover:not(:disabled) { color: var(--aw-ink); }
.aw-btn--ghost:disabled { border-color: transparent; background: none; }
.aw-btn--icon { width: 28px; padding: 0; }
.aw-btn--sm.aw-btn--icon { width: 24px; }
.aw-btn[aria-busy=true]:not(#aw-override) { color: transparent; }
.aw-btn[aria-busy=true]::before { content: ''; position: absolute; inset: 0; margin: auto; width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--aw-ink-3); border-top-color: var(--aw-ink); animation: aw-spin .7s linear infinite; }
.aw-btn--primary[aria-busy=true] { background: var(--aw-accent); }
.aw-btn--primary[aria-busy=true]::before { border-color: rgba(255,255,255,.45); border-top-color: var(--aw-accent-ink); }
.aw-btn__kbd { margin-left: 4px; color: inherit; opacity: .6; font-size: var(--aw-type-xs); }

/* ————— controls: segmented, chips, fields ————— */
.aw-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: var(--aw-radius-md); background: var(--aw-fill); align-self: flex-start; max-width: 100%; }
.aw-seg button { border: 0; background: none; height: 24px; padding: 0 10px; border-radius: var(--aw-radius-sm); cursor: pointer; font-size: var(--aw-type-sm); color: var(--aw-ink-2); white-space: nowrap; }
.aw-seg button:hover:not(:disabled) { color: var(--aw-ink); }
.aw-seg button:is([aria-pressed="true"], [aria-checked="true"]) { background: var(--aw-surface); color: var(--aw-ink); font-weight: 600; box-shadow: 0 0 0 1px var(--aw-hairline), 0 1px 2px rgba(0,0,0,.06); }
.aw-seg button:disabled { cursor: default; opacity: .55; }
.aw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.aw-chips button { border: 1px solid var(--aw-hairline-strong); background: none; border-radius: var(--aw-radius-pill); height: 24px; padding: 0 10px; font-size: var(--aw-type-sm); cursor: pointer; color: var(--aw-ink-2); }
.aw-chips button:hover:not(:disabled) { color: var(--aw-ink); }
.aw-chips button[aria-pressed="true"] { border-color: var(--aw-ink); color: var(--aw-ink); background: var(--aw-fill); }
.aw-field { display: flex; flex-direction: column; gap: var(--aw-space-1); margin-bottom: var(--aw-space-3); min-width: 0; }
.aw-field__label { font-size: var(--aw-type-sm); font-weight: 500; color: var(--aw-ink-2); }
.aw-field__hint { font-size: var(--aw-type-xs); color: var(--aw-ink-3); line-height: 1.4; }
.aw-field__error { font-size: var(--aw-type-xs); color: var(--aw-bad-ink); }
.aw-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 0 var(--aw-space-5); }
.aw-inline { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; }
.aw-inline input { flex: 1; min-width: 120px; }
.aw-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.aw-check input { flex: none; width: auto; min-width: 0; margin: 0; }
.aw-people { margin: 6px 0; }
.aw-people ul { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 2px; }
.aw-people li { display: flex; align-items: center; gap: 8px; min-width: 0; }
.aw-people__who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.aw-people .aw-check { font-size: var(--aw-type-sm); color: var(--aw-ink-2); white-space: nowrap; }
.aw-search { width: 220px; max-width: 100%; }

/* ————— status: pills, tags, dots ————— */
.aw-pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: var(--aw-radius-pill); font-size: var(--aw-type-xs); font-weight: 600; background: var(--aw-fill); color: var(--aw-ink-2); white-space: nowrap; }
.aw-pill--new, .aw-pill--in_progress { background: var(--aw-info-wash); color: var(--aw-info-ink); }
.aw-pill--approved { background: var(--aw-fill); color: var(--aw-ink); }
.aw-pill--review { background: var(--aw-warn-wash); color: var(--aw-warn-ink); }
.aw-pill--done { background: var(--aw-ok-wash); color: var(--aw-ok-ink); }
.aw-pill--declined { background: none; color: var(--aw-ink-3); box-shadow: inset 0 0 0 1px var(--aw-hairline); }
/* The status square is a neutral marker now; the word carries the status. */
.aw-sq { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; border: 1.5px solid var(--aw-ink-3); }
.aw-sq--new, .aw-sq--in_progress { border-color: var(--aw-info); }
.aw-sq--review { border-color: var(--aw-warn); background: var(--aw-warn); }
.aw-sq--done { border-color: var(--aw-ok); background: var(--aw-ok); }
.aw-sq--approved { border-color: var(--aw-ink-2); }
.aw-sq--declined { border-color: var(--aw-hairline-strong); }
.aw-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; background: var(--aw-ink-3); }
.aw-dot--ok { background: var(--aw-ok); } .aw-dot--warn { background: var(--aw-warn); } .aw-dot--bad { background: var(--aw-bad); } .aw-dot--info { background: var(--aw-info); }
.aw-live { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; background: var(--aw-info); animation: aw-breathe 1.6s ease-in-out infinite; }
@keyframes aw-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .aw-live:not(#aw-override), .aw-mark--live:not(#aw-override), .aw *:not(#aw-override)::before { animation: none; } .aw [data-tip]:hover::after { animation: aw-tip 0s linear 400ms backwards; } }
.aw-tag { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: var(--aw-radius-sm); background: var(--aw-fill); font-size: var(--aw-type-xs); font-weight: 500; color: var(--aw-ink-2); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.aw-tag--dash { background: none; box-shadow: inset 0 0 0 1px var(--aw-hairline); }
.aw-tag--client, .aw-tag--info { background: var(--aw-info-wash); color: var(--aw-info-ink); }
.aw-tag--hot, .aw-tag--accent { background: var(--aw-accent-wash); color: color-mix(in srgb, var(--aw-accent) 80%, var(--aw-ink)); }
.aw-tag--warn { background: var(--aw-warn-wash); color: var(--aw-warn-ink); }
.aw-tag--ok { background: var(--aw-ok-wash); color: var(--aw-ok-ink); }
.aw-tag--bad { background: var(--aw-bad-wash); color: var(--aw-bad-ink); }
.aw-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.aw-running { display: inline-flex; align-items: center; gap: 6px; font-size: var(--aw-type-sm); color: var(--aw-ink-2); }

/* ————— board: lanes (one tint) holding cards (one hairline) ————— */
.aw-view--board { display: flex; flex-direction: column; height: 100%; padding-bottom: 0; max-width: none; }
.aw-board { flex: 1; min-height: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(248px, 1fr); gap: var(--aw-space-3); overflow-x: auto; padding-bottom: var(--aw-space-4); scroll-snap-type: x proximity; }
.aw-col { display: flex; flex-direction: column; min-height: 0; background: var(--aw-surface-sidebar); border-radius: var(--aw-radius-lg); scroll-snap-align: start; transition: background-color var(--aw-dur) var(--aw-ease); }
.aw-col.is-over { background: var(--aw-accent-wash); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--aw-accent) 45%, transparent); }
.aw-col > header { display: flex; align-items: center; gap: var(--aw-space-2); height: 36px; padding: 0 var(--aw-space-3); font-weight: 600; font-size: var(--aw-type-sm); }
.aw-col > header .aw-count { margin-left: 0; padding-left: 0; }
.aw-col__body { flex: 1; overflow-y: auto; padding: 0 var(--aw-space-2) var(--aw-space-2); display: flex; flex-direction: column; gap: 6px; }
.aw-col__empty { margin: var(--aw-space-1) var(--aw-space-1) var(--aw-space-2); font-size: var(--aw-type-sm); color: var(--aw-ink-3); }
.aw-card { background: var(--aw-surface); border: 1px solid var(--aw-hairline); border-radius: var(--aw-radius-md); padding: var(--aw-space-2) 10px; cursor: pointer; transition: border-color var(--aw-dur) var(--aw-ease); }
.aw-card:hover { border-color: var(--aw-hairline-strong); }
.aw-card:focus-visible { outline: 2px solid var(--aw-focus); outline-offset: 1px; }
.aw-card__top { display: flex; align-items: center; gap: 6px; min-height: 18px; }
.aw-card__id { font-size: var(--aw-type-xs); color: var(--aw-ink-3); font-variant-numeric: tabular-nums; }
.aw-card__age { margin-left: auto; font-size: var(--aw-type-xs); color: var(--aw-ink-3); }
.aw-card h4 { font-size: var(--aw-type-md); font-weight: 500; margin: 3px 0 2px; line-height: 1.35; }
.aw-card__meta { display: flex; gap: 0 6px; flex-wrap: wrap; font-size: var(--aw-type-xs); color: var(--aw-ink-2); }
.aw-card__meta > span + span::before { content: '·'; margin-right: 6px; color: var(--aw-ink-3); }
.aw-card__foot { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 6px; font-size: var(--aw-type-xs); }
.aw-card__foot:empty { display: none; }
.aw-card__warn { display: flex; gap: 6px; align-items: baseline; margin: 6px 0 0; font-size: var(--aw-type-xs); color: var(--aw-bad-ink); }

/* ————— tables: 36px rows, hairlines, numeric right ————— */

/* ————— rows: the list pattern (hairlines, no box) ————— */
.aw-inbox { max-width: var(--aw-measure-table); }
.aw-group { margin: var(--aw-space-5) 0; }
.aw-group > h3, .aw-group > header > h3 { font-size: var(--aw-type-md); font-weight: 600; display: flex; align-items: baseline; gap: var(--aw-space-2); }
.aw-group > h3 .aw-count, .aw-group > header .aw-count { margin-left: 0; padding-left: 0; }
.aw-group > p { margin: 2px 0 var(--aw-space-2); }
.aw-row-h { display: flex; align-items: center; gap: var(--aw-space-2); }
.aw-group > h3 + .aw-rows, .aw-group > header + .aw-rows { margin-top: var(--aw-space-2); }
.aw-rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--aw-hairline); }
.aw-rows > li { border-bottom: 1px solid var(--aw-hairline); }
.aw-row { display: flex; align-items: center; gap: var(--aw-space-3); min-height: var(--aw-row-h-table); padding: 4px var(--aw-space-2); cursor: pointer; flex-wrap: wrap; }
.aw-row:hover { background: var(--aw-hover); }
.aw-row__title { font-weight: 500; min-width: 0; }
.aw-banner { display: flex; align-items: center; flex-wrap: wrap; gap: var(--aw-space-2); padding: var(--aw-space-2) var(--aw-space-3); border-radius: var(--aw-radius-md); margin: var(--aw-space-2) 0; background: var(--aw-fill); }
.aw-banner--bad { background: var(--aw-bad-wash); }
.aw-banner--warn { background: var(--aw-warn-wash); }
.aw-banner--ok { background: var(--aw-ok-wash); }
.aw-banner__text { flex: 1; min-width: 0; }
.aw-snippet { display: block; font-weight: 400; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 520px; }
.aw-files { list-style: none; margin: var(--aw-space-2) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.aw-file { font: inherit; font-size: var(--aw-type-sm); display: inline-flex; gap: 6px; align-items: baseline; padding: 2px 8px; border: 1px solid var(--aw-hairline-strong); border-radius: var(--aw-radius-md); background: transparent; color: inherit; cursor: pointer; max-width: 100%; overflow-wrap: anywhere; }
button.aw-file:hover { background: var(--aw-hover); }

/* ————— ticket: thread + inspector ————— */
.aw-ticket { display: grid; grid-template-columns: minmax(0, 1fr) var(--aw-details-w, 300px); min-height: 100%; position: relative; }
.aw-ticket--solo { grid-template-columns: minmax(0, 1fr); }
.aw-evidence-more { border-top: 1px solid var(--aw-hairline); margin-top: var(--aw-space-3); padding-top: var(--aw-space-2); }
.aw-evidence-more > summary { cursor: pointer; font-size: var(--aw-type-sm); color: var(--aw-ink-2); }
.aw-evidence-more > summary:hover { color: var(--aw-ink); }
.aw-ticket__quick { margin-top: var(--aw-space-3); }
.aw-ticket__quick .aw-ticket__actions { padding-bottom: 0; border-bottom: 0; }
.aw-ticket__main { padding: var(--aw-space-4) var(--aw-space-5) var(--aw-space-4); min-width: 0; display: flex; flex-direction: column; }
.aw-ticket__main > * { width: 100%; max-width: 860px; }
.aw-ticket__head { padding-bottom: var(--aw-space-3); border-bottom: 1px solid var(--aw-hairline); }
.aw-ticket__head h2 { font-size: var(--aw-type-xl); font-weight: 600; margin: 4px 0 0; line-height: 1.3; overflow-wrap: anywhere; }
.aw-ticket__crumbs { display: flex; gap: 0 var(--aw-space-2); flex-wrap: wrap; align-items: center; font-size: var(--aw-type-sm); color: var(--aw-ink-2); }
.aw-ticket__crumbs > span + span::before { content: '·'; margin-right: var(--aw-space-2); color: var(--aw-ink-3); }
.aw-ticket__head .aw-banner { margin: var(--aw-space-3) 0 0; }
.aw-ticket__actions { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; padding-bottom: var(--aw-space-3); border-bottom: 1px solid var(--aw-hairline); }
.aw-timeline { list-style: none; margin: 0; padding: var(--aw-space-2) 0 var(--aw-space-4); display: flex; flex-direction: column; flex: 1; }
.aw-timeline > li + li { border-top: 1px solid var(--aw-hairline); }
.aw-event { display: flex; gap: var(--aw-space-2); align-items: baseline; font-size: var(--aw-type-sm); color: var(--aw-ink-2); padding: var(--aw-space-2) 0; }
.aw-event::before { content: ''; flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--aw-ink-3); transform: translateY(-2px); }
.aw-event time { margin-left: auto; white-space: nowrap; color: var(--aw-ink-3); }
.aw-msg { padding: var(--aw-space-3) 0; }
.aw-msg.is-private { background: color-mix(in srgb, var(--aw-warn) 7%, var(--aw-surface)); padding: var(--aw-space-3); border-radius: var(--aw-radius-md); margin: 2px 0; }
.aw-msg.is-private:not(#aw-override) { border-top-color: transparent; }
.aw-msg.is-private + li { border-top-color: transparent; }
.aw-msg header, .aw-run header { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; margin-bottom: 4px; font-size: var(--aw-type-sm); }
.aw-msg header strong, .aw-run header strong { font-weight: 600; font-size: var(--aw-type-md); }
.aw-msg header time, .aw-run header time { margin-left: auto; color: var(--aw-ink-3); }
.aw-msg__body { white-space: pre-wrap; overflow-wrap: anywhere; max-width: var(--aw-measure); line-height: 1.55; }
.aw-msg__body.is-clipped, .aw-run__summary.is-clipped { max-height: 7.5em; overflow: hidden; mask-image: linear-gradient(${LEGACY_LITERALS.shade} 55%, transparent); -webkit-mask-image: linear-gradient(${LEGACY_LITERALS.shade} 55%, transparent); }
.aw-fold { cursor: pointer; user-select: none; }
.aw-fold__chev { display: inline-grid; place-items: center; width: 18px; height: 18px; margin-left: -4px; border: 0; padding: 0; background: none; color: var(--aw-ink-3); cursor: pointer; border-radius: var(--aw-radius-sm); transition: transform var(--aw-dur) var(--aw-ease); }
.aw-fold__chev:hover { background: var(--aw-hover); color: var(--aw-ink); }
.aw-fold__chev.is-open { transform: rotate(90deg); }
.aw-fold__more { margin-top: 4px; font-size: var(--aw-type-sm); }
.aw-run { padding: var(--aw-space-3) 0; }
.aw-run__summary { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--aw-type-sm); max-width: var(--aw-measure); line-height: 1.55; margin-top: 4px; }
/* Superagent — laid out like the app's chat: a centred column, the thread scrolls, the composer card stays at the foot. */
.aw-mk-nolink { display: flex; align-items: center; justify-content: space-between; gap: var(--aw-space-3); flex-wrap: wrap; }
.aw-sa { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.aw-sa__bar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: var(--aw-space-3); min-height: 48px; padding: 0 var(--aw-space-5); border-bottom: 1px solid var(--aw-hairline); }
.aw-sa__bar-title { display: flex; align-items: center; gap: var(--aw-space-2); min-width: 0; color: var(--aw-ink); }
.aw-sa__bar-title h1 { margin: 0; font-size: var(--aw-type-lg); font-weight: 600; }
.aw-sa__bar-title .aw-muted { font-size: var(--aw-type-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aw-sa__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.aw-sa__col, .aw-sa__dock { width: 100%; max-width: 860px; margin: 0 auto; padding: 0 var(--aw-space-5); box-sizing: border-box; }
.aw-sa__col { display: flex; flex-direction: column; gap: var(--aw-space-6); padding-top: var(--aw-space-6); padding-bottom: var(--aw-space-5); }
.aw-sa__turn { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: var(--aw-space-3); align-items: start; }
.aw-sa__avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--aw-radius-pill); background: var(--aw-accent-wash); color: var(--aw-accent); }
.aw-sa__body { display: flex; flex-direction: column; gap: var(--aw-space-2); min-width: 0; font-size: var(--aw-type-lg); line-height: 1.6; color: var(--aw-ink); }
.aw-sa__body p { margin: 0; }
.aw-sa__who { font-size: var(--aw-type-sm); font-weight: 600; line-height: 28px; color: var(--aw-ink-2); }
.aw-sa__lines { display: flex; flex-direction: column; list-style: none; margin: 0; padding: 0; }
.aw-sa__line { display: flex; align-items: center; gap: var(--aw-space-2); width: 100%; margin: 0 calc(-1 * var(--aw-space-2)); padding: var(--aw-space-1) var(--aw-space-2); border: 0; border-radius: var(--aw-radius-lg); background: none; color: var(--aw-ink); font: inherit; cursor: pointer; text-align: left; }
.aw-sa__line > span:not(.aw-dot) { flex: 1; }
.aw-sa__line > svg { color: var(--aw-ink-3); opacity: 0; transition: opacity .12s; }
.aw-sa__line:hover { background: var(--aw-hover); }
.aw-sa__line:hover > svg, .aw-sa__line:focus-visible > svg { opacity: 1; }
.aw-sa__actions { display: flex; gap: var(--aw-space-2); padding-top: var(--aw-space-1); }
.aw-sa__recent { display: flex; flex-direction: column; list-style: none; margin: 0; padding: 0; }
.aw-sa__recent-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--aw-space-4); width: 100%; margin: 0 calc(-1 * var(--aw-space-2)); padding: var(--aw-space-2); border: 0; border-radius: var(--aw-radius-lg); background: none; color: var(--aw-ink); font: inherit; font-size: var(--aw-type-md); cursor: pointer; text-align: left; }
.aw-sa__recent-row:hover { background: var(--aw-hover); }
.aw-sa__recent-row > .aw-muted, .aw-sa__live { flex: none; font-size: var(--aw-type-sm); }
.aw-sa__live { display: inline-flex; align-items: center; gap: var(--aw-space-1); color: var(--aw-ink-2); }
.aw-sa__recent-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-sa__note { font-size: var(--aw-type-sm); }
.aw-sa__abilities { margin-left: 40px; }
.aw-sa__abilities > summary { cursor: pointer; font-size: var(--aw-type-sm); color: var(--aw-ink-2); }
.aw-sa__ability-grid { display: grid; gap: var(--aw-space-3); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); margin-top: var(--aw-space-3); }
.aw-sa__ability { display: flex; gap: var(--aw-space-3); align-items: flex-start; padding: var(--aw-space-3); border: 1px solid var(--aw-hairline); border-radius: var(--aw-radius-lg); }
.aw-sa__ability p { margin: 2px 0 0; font-size: var(--aw-type-sm); }
.aw-sa__dock { flex: none; display: flex; flex-direction: column; gap: var(--aw-space-2); padding-bottom: var(--aw-space-3); }
.aw-sa__prompts { display: flex; flex-wrap: wrap; gap: var(--aw-space-2); }
.aw-sa__prompt { padding: 6px var(--aw-space-3); border: 1px solid var(--aw-hairline); border-radius: var(--aw-radius-pill); background: transparent; color: var(--aw-ink-2); font: inherit; font-size: var(--aw-type-sm); cursor: pointer; }
.aw-sa__prompt:hover:not(:disabled) { background: var(--aw-hover); color: var(--aw-ink); }
.aw-sa__prompt:disabled { opacity: .55; cursor: default; }
.aw-sa__card { display: flex; flex-direction: column; padding-top: var(--aw-space-2); border-radius: 28px; background: color-mix(in srgb, var(--aw-ink) 8%, var(--aw-surface)); box-shadow: 0 0 0 .5px color-mix(in srgb, var(--aw-ink) 14%, transparent), 0 4px 16px color-mix(in srgb, black 4%, transparent); }
.aw-sa__card:focus-within { box-shadow: 0 0 0 1px color-mix(in srgb, var(--aw-ink) 24%, transparent), 0 4px 16px color-mix(in srgb, black 4%, transparent); }
.aw-sa__card textarea { field-sizing: content; min-height: 48px; max-height: 240px; padding: var(--aw-space-1) var(--aw-space-4) 0; border: 0; outline: 0; background: transparent; color: var(--aw-ink); font: inherit; font-size: var(--aw-type-lg); line-height: 1.6; resize: none; box-shadow: none; }
.aw-sa__card textarea::placeholder { color: var(--aw-ink-3); }
.aw-sa__tools { display: flex; align-items: center; gap: var(--aw-space-2); padding: var(--aw-space-1) var(--aw-space-2) var(--aw-space-2) var(--aw-space-3); }
.aw-sa__scope { display: inline-flex; align-items: center; gap: var(--aw-space-1); min-width: 0; height: 28px; padding: 0 var(--aw-space-2); border-radius: var(--aw-radius-lg); color: var(--aw-ink-2); }
.aw-sa__scope:hover { background: var(--aw-hover); }
.aw-sa__scope select { max-width: 220px; min-width: 0; height: 28px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: var(--aw-type-md); text-overflow: ellipsis; cursor: pointer; box-shadow: none; }
.aw-sa__mode { font-size: var(--aw-type-sm); color: var(--aw-ink-3); white-space: nowrap; }
.aw-sa__send { display: grid; place-items: center; flex: none; width: 34px; height: 34px; margin-left: auto; border: 0; border-radius: var(--aw-radius-pill); background: var(--aw-accent); color: var(--aw-accent-ink); cursor: pointer; }
.aw-sa__send:disabled { opacity: .4; cursor: default; }
.aw-sa__send:not(:disabled):hover { filter: brightness(1.08); }
.aw-sa__foot { margin: 0; text-align: center; font-size: var(--aw-type-xs); color: var(--aw-ink-3); }
@media (max-width: 640px) {
  .aw-sa__bar-title .aw-muted, .aw-sa__mode, .aw-sa__foot { display: none; }
  .aw-sa__col, .aw-sa__dock { padding-left: var(--aw-space-3); padding-right: var(--aw-space-3); }
  .aw-sa__abilities { margin-left: 0; }
  .aw-sa__prompts { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .aw-sa__prompt { flex: none; white-space: nowrap; }
}
.aw-pick { display: flex; align-items: center; gap: var(--ui-sp-2, 8px); }
.aw-pick > input { flex: 1; min-width: 0; }
.aw-pick > .ui-btn { flex: none; }
.aw-steps { list-style: none; margin: 6px 0 4px; padding: 6px var(--aw-space-2); display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; border-radius: var(--aw-radius-md); background: var(--aw-surface-sidebar); font-size: var(--aw-type-sm); }
.aw-steps li { display: flex; gap: var(--aw-space-2); align-items: baseline; min-width: 0; }
.aw-steps time { flex: none; color: var(--aw-ink-3); font-family: var(--aw-mono); font-size: var(--aw-type-xs); }
.aw-steps span { min-width: 0; overflow-wrap: anywhere; }
.aw-link.aw-steps-toggle { font-size: var(--ui-fs-sm, 12px); }
.aw-link.aw-steps-toggle--show { margin: 2px 0 var(--ui-sp-1, 4px); }
.aw-muted.aw-land-ref { font-size: var(--ui-fs-sm, 12px); }
.aw-step--tool span { font-family: var(--aw-mono); font-size: var(--aw-type-xs); }
.aw-step--node span { color: var(--aw-ink-2); }
.aw-step--error span { color: var(--aw-bad-ink); }
.aw-step__mark { flex: none; width: 1em; text-align: center; color: var(--aw-ink-3); }
.aw-run footer { display: flex; align-items: center; gap: var(--aw-space-3); flex-wrap: wrap; margin-top: 6px; font-size: var(--aw-type-sm); }
.aw-diff, .aw-log { font-family: var(--aw-mono); font-size: var(--aw-type-xs); line-height: 1.5; white-space: pre; overflow: auto; max-height: 65vh; background: var(--aw-surface-sidebar); border: 1px solid var(--aw-hairline); border-radius: var(--aw-radius-md); padding: 10px; margin: 0; }
.aw-log { max-height: 220px; margin-top: 10px; }
.aw-composer { position: sticky; bottom: var(--aw-space-3); border: 1px solid var(--aw-hairline-strong); border-radius: var(--aw-radius-lg); background: var(--aw-surface); padding: var(--aw-space-2) var(--aw-space-3); box-shadow: 0 0 0 var(--aw-space-3) var(--aw-surface), 0 -14px 24px var(--aw-surface); }
.aw-composer.is-note { background: color-mix(in srgb, var(--aw-warn) 5%, var(--aw-surface)); }
.aw-composer:focus-within { border-color: color-mix(in srgb, var(--aw-focus) 60%, var(--aw-hairline-strong)); }
.aw-composer__head, .aw-composer__foot { display: flex; align-items: center; gap: var(--aw-space-2) var(--aw-space-3); flex-wrap: wrap; font-size: var(--aw-type-sm); }
.aw-composer__head { margin-bottom: 4px; }
.aw-composer__foot { margin-top: 4px; }
.aw-composer textarea { border: 0; padding: 4px 2px; background: none; min-height: calc(3 * 1.5em + 8px); resize: none; }
.aw-composer textarea:not(#aw-override) { outline: none; }
.aw-details { border-left: 1px solid var(--aw-hairline); background: var(--aw-surface-sidebar); padding: var(--aw-space-4); overflow-y: auto; position: sticky; top: 0; height: 100cqh; align-self: start; }
.aw-details select, .aw-details input { width: 100%; }
.aw-site { display: flex; flex-direction: column; gap: 6px; padding: 0; }
.aw-site p { margin: 0; }
.aw-site__links { display: flex; gap: 14px; font-weight: 500; }
.aw-site__one { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.aw-details .aw-ticket__actions { flex-direction: column; align-items: stretch; gap: 6px; padding-bottom: var(--aw-space-4); margin-bottom: var(--aw-space-4); }
.aw-details .aw-ticket__actions > button, .aw-details .aw-ticket__actions > .aw-btnwrap, .aw-details .aw-ticket__actions > .aw-btnwrap > button { width: 100%; justify-content: center; }
.aw-details .aw-ticket__actions > :first-child { align-self: flex-start; }
.aw-details .aw-ticket__actions .aw-btn--ghost { border-color: var(--aw-hairline-strong); background: var(--aw-surface); color: var(--aw-ink); }
.aw-details .aw-ticket__actions > .aw-running, .aw-details .aw-ticket__actions > .aw-muted { justify-content: center; text-align: center; }
.aw-details--page { border-left: 0; background: none; padding: 0; position: static; height: auto; overflow: visible; }
.aw-details--page .aw-ticket__actions { flex-direction: row; flex-wrap: wrap; align-items: center; }
.aw-details--page .aw-ticket__actions > button { width: auto; }
.aw-details--page .aw-field { max-width: 520px; }
.aw-cost { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--aw-space-2); padding: var(--aw-space-3) 0; }
.aw-cost > div { display: flex; flex-direction: column; gap: 2px; }
.aw-cost strong { font-size: var(--aw-type-lg); font-weight: 600; }
.aw-cost small { font-size: var(--aw-type-xs); }
.aw-cost .aw-link { grid-column: 1 / -1; justify-self: start; font-size: var(--aw-type-sm); }
.aw-runlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; font-size: var(--aw-type-sm); }
.aw-runlist li { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid var(--aw-hairline); }
.aw-runlist li:first-child { border-top: 0; }
.aw-predict { display: flex; align-items: flex-start; gap: var(--aw-space-2); font-size: var(--aw-type-sm); margin: 0 0 var(--aw-space-3); color: var(--aw-ink-2); line-height: 1.45; }
.aw-predict .aw-dot { margin-top: 5px; }
.aw-predict--bad { color: var(--aw-bad-ink); }

/* ————— fleet + directory ————— */
.aw-nodes { display: block; border-top: 1px solid var(--aw-hairline); }
.aw-node { padding: var(--aw-space-3) 0; border-bottom: 1px solid var(--aw-hairline); min-width: 0; }
.aw-node > header { display: flex; align-items: center; gap: var(--aw-space-2); min-width: 0; margin-bottom: 4px; }
.aw-node h3 { flex: none; font-size: var(--aw-type-md); font-weight: 600; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-node > header .aw-btn { flex: none; }
.aw-node__os { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--aw-type-sm); }
.aw-node__lines { display: grid; gap: 1px; padding-left: 15px; }
.aw-node__line { margin: 0; font-size: var(--aw-type-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aw-node__bar { display: inline-block; width: 56px; height: 4px; margin: 0 var(--aw-space-2); vertical-align: 1px; border-radius: 2px; background: var(--aw-fill); overflow: hidden; }
.aw-node__bar i { display: block; height: 100%; background: var(--aw-ink-2); }
.aw-node .aw-rows { margin: var(--aw-space-2) 0 0 15px; }
.aw-node .aw-rows .aw-row { min-height: var(--aw-row-h); padding: 0 var(--aw-space-2); flex-wrap: nowrap; gap: var(--aw-space-2); font-size: var(--aw-type-sm); }
.aw-node .aw-row > .aw-live, .aw-node .aw-row > .aw-mono, .aw-node .aw-row > .aw-muted { flex: none; white-space: nowrap; }
.aw-node .aw-row__title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-kv { display: grid; grid-template-columns: 80px 1fr; gap: 5px 10px; margin: 0 0 var(--aw-space-2); font-size: var(--aw-type-sm); }
.aw-kv dt { color: var(--aw-ink-2); }
.aw-kv dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.aw-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 0 var(--aw-space-6); }
.aw-cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--aw-space-2); }
/* Panel: a titled section, not a card. One hairline above, space below. */
.aw-panel { border-top: 1px solid var(--aw-hairline); padding: var(--aw-space-3) 0 var(--aw-space-2); margin-bottom: var(--aw-space-4); min-width: 0; }
.aw-panel > header { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; }
.aw-panel > h3 { font-size: var(--aw-type-md); font-weight: 600; margin-bottom: var(--aw-space-3); }
.aw-panel p { margin: 6px 0; }

/* ————— this Mac as a worker ————— */
.aw-mpillbar { display: inline-flex; align-items: center; gap: 0; }
.aw-mpill { display: inline-flex; align-items: center; gap: 6px; height: var(--aw-status-h); padding: 0 var(--aw-space-2); border: 0; background: none; color: inherit; font-size: inherit; white-space: nowrap; cursor: pointer; }
.aw-mpill:hover { background: var(--aw-hover); color: var(--aw-ink); }
.aw-mpillbar .aw-btn--ghost { height: var(--aw-status-h); width: 24px; padding: 0; border-radius: 0; }
.aw-mstate { margin: 0 0 var(--aw-space-2); font-size: var(--aw-type-sm); }
.aw-mexes { display: flex; flex-direction: column; gap: 2px; }
.aw-mexe { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; font-size: var(--aw-type-sm); cursor: pointer; min-height: 24px; }
.aw-mexe__name { font-weight: 600; }
.aw-mlog { margin-top: var(--aw-space-2); }
.aw-mlog summary { cursor: pointer; color: var(--aw-ink-2); font-size: var(--aw-type-sm); }
.aw-mlog[open] summary { margin-bottom: 4px; }
.aw-machine p > .aw-btn { margin-left: var(--aw-space-2); }
.aw-toolbox__head { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; margin-bottom: var(--aw-space-2); }
.aw-toolbox__head p { margin: 0; }
.aw-toolbox__warnings { list-style: none; margin: 4px 0 8px; padding: 0; display: grid; gap: 2px; font-size: var(--aw-type-sm); }
.aw-toolbox__section { border-top: 1px solid var(--aw-hairline); margin-top: var(--aw-space-3); padding-top: var(--aw-space-3); }
.aw-toolbox__section > h4 { font-size: var(--aw-type-md); font-weight: 600; margin: 0 0 6px; }
.aw-toolbox__subhead { font-size: var(--aw-type-sm); font-weight: 600; color: var(--aw-ink-2); margin: 10px 0 4px; }
.aw-toolbox__rows, .aw-toolbox__skills, .aw-toolbox__plugins { list-style: none; margin: 0; padding: 0; display: grid; border-top: 1px solid var(--aw-hairline); }
.aw-toolbox__row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--aw-space-2); padding: 6px 0; border-bottom: 1px solid var(--aw-hairline); }
.aw-toolbox__row.is-off { opacity: .72; }
.aw-toolbox__main { min-width: 0; }
.aw-toolbox__title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.aw-toolbox__meta { color: var(--aw-ink-2); font-size: var(--aw-type-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-toolbox__actions { display: flex; gap: 4px; }
.aw-toolbox__skills > li, .aw-toolbox__plugin { padding: 6px 0; border-bottom: 1px solid var(--aw-hairline); }
.aw-toolbox__plugin { display: flex; align-items: center; gap: 6px; }
.aw-toolbox__skilldesc { margin: 2px 0 0; color: var(--aw-ink-2); font-size: var(--aw-type-sm); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ————— layers: scrim, dialog, sheet, palette, menu, toast ————— */
.aw-scrim { position: absolute; inset: 0; z-index: 20; background: var(--aw-scrim); display: grid; place-items: center; padding: var(--aw-space-5); animation: aw-fade var(--aw-dur) var(--aw-ease); }
.aw-scrim--top { place-items: start center; padding-top: 12vh; }
@keyframes aw-fade { from { opacity: 0; } }
@keyframes aw-rise { from { opacity: 0; transform: translateY(6px) scale(.99); } }
.aw-modal { width: min(520px, 100%); max-height: 88%; display: flex; flex-direction: column; background: var(--aw-surface-raised); color: var(--aw-ink); border-radius: 10px; box-shadow: var(--aw-shadow-float); animation: aw-rise var(--aw-dur) var(--aw-ease); }
.aw-modal:focus { outline: none; }
.aw-modal--wide { width: min(760px, 100%); }
.aw-modal--full { width: 96%; height: 92%; max-height: 92%; }
.aw-modal--full .aw-modal__body { flex: 1; min-height: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.aw-review { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.aw-review > * { flex: 1; min-height: 0; }
.aw-modal__head { display: flex; align-items: flex-start; gap: var(--aw-space-3); padding: var(--aw-space-4) var(--aw-space-4) var(--aw-space-2); }
.aw-modal__head > div { flex: 1; min-width: 0; }
.aw-modal__head h2 { font-size: var(--aw-type-lg); font-weight: 600; }
.aw-modal__head p { margin: 4px 0 0; color: var(--aw-ink-2); font-size: var(--aw-type-sm); }
.aw-modal__body { padding: var(--aw-space-2) var(--aw-space-4) var(--aw-space-3); overflow-y: auto; }
.aw-modal__foot { display: flex; align-items: center; justify-content: flex-end; gap: var(--aw-space-2); padding: var(--aw-space-3) var(--aw-space-4); border-top: 1px solid var(--aw-hairline); flex-wrap: wrap; }
.aw-modal__foot .aw-predict { margin: 0 auto 0 0; }
.aw-palette { width: min(620px, 100%); background: var(--aw-surface-raised); border-radius: 10px; box-shadow: var(--aw-shadow-float); overflow: hidden; animation: aw-rise var(--aw-dur) var(--aw-ease); }
.aw-palette input { width: 100%; background: none; }
.aw-palette input:not(#aw-override) { border: 0; border-bottom: 1px solid var(--aw-hairline); border-radius: 0; padding: 14px 16px; font-size: var(--aw-type-lg); outline: none; }
.aw-palette ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
.aw-palette li { display: flex; align-items: center; gap: var(--aw-space-3); height: 32px; padding: 0 10px; border-radius: var(--aw-radius-md); cursor: pointer; }
.aw-palette li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-palette li small { color: var(--aw-ink-3); white-space: nowrap; font-size: var(--aw-type-xs); }
.aw-palette li.is-active { background: var(--aw-selected); }
.aw-toast { position: absolute; z-index: 30; right: var(--aw-space-4); bottom: calc(var(--aw-status-h) + var(--aw-space-3)); max-width: 420px; display: flex; align-items: flex-start; gap: var(--aw-space-3); padding: 10px 12px 10px 14px; border-radius: var(--aw-radius-lg); background: var(--aw-ink); color: var(--aw-surface); box-shadow: var(--aw-shadow-float); font-size: var(--aw-type-md); animation: aw-rise var(--aw-dur) var(--aw-ease); }
.aw-toast.is-error { background: var(--aw-bad); color: var(--aw-accent-ink); }

/* ————— pane resize handles ————— */
.aw-resize { position: absolute; top: 0; bottom: 0; width: 9px; cursor: col-resize; z-index: 8; touch-action: none; }
.aw-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; transition: background-color var(--aw-dur) var(--aw-ease); }
.aw-resize:hover::after, .aw-resize.is-drag::after, .aw-resize:focus-visible::after { background: var(--aw-focus); }
.aw-resize:focus-visible { outline: none; }
.aw-resize--explorer { bottom: var(--aw-status-h); left: calc(var(--aw-activity-w) + var(--aw-explorer-w, 260px) - 5px); }
.aw-resize--details { right: calc(var(--aw-details-w, 300px) - 5px); }

@media (max-width: 900px) {
  .aw-explorer { display: none; }
  .aw-resize { display: none; }
  .aw-ticket { grid-template-columns: 1fr; }
  .aw-details { border-left: 0; border-top: 1px solid var(--aw-hairline); position: static; height: auto; }
  .aw-view { padding-inline: var(--aw-space-4); }
  .aw-ticket__main { padding-inline: var(--aw-space-4); }
  /* Below 900px the map is the route list; a "Hide map" button would hide the
     primary content, so the toggle is not offered there. */
  .aw-world__toggle { display: none; }
}

/* ————— details panel sections ————— */
.aw-details > .aw-field, .aw-details > .aw-predict { margin-bottom: var(--aw-space-3); }
.aw-details .aw-field { gap: var(--aw-space-1); }
.aw-details .aw-field__label { font-size: var(--aw-type-xs); color: var(--aw-ink-3); }
.aw-details .aw-chips button[aria-pressed="true"] { border-color: var(--aw-ink); }
.aw-details .aw-cost strong { font-variant-numeric: tabular-nums; }

/* ————— health ————— */
.aw-health { max-width: var(--aw-measure-table); }
.aw-health__intro { margin: 0 0 var(--aw-space-3); }
.aw-health__list { list-style: none; margin: var(--aw-space-2) 0 0; padding: 0; border-top: 1px solid var(--aw-hairline); }
.aw-health__row { display: flex; align-items: center; gap: var(--aw-space-2); min-height: var(--aw-row-h); padding: 0 var(--aw-space-2); border-bottom: 1px solid var(--aw-hairline); font-size: var(--aw-type-sm); }
.aw-health__row--bad { background: color-mix(in srgb, var(--aw-bad) 5%, transparent); }
.aw-health__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.aw-health__name { flex: none; font-size: var(--aw-type-sm); font-weight: 600; white-space: nowrap; }
.aw-health__detail { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-health__meta { flex: none; display: flex; align-items: center; gap: var(--aw-space-2); white-space: nowrap; font-size: var(--aw-type-xs); }

/* ————— pre-review, evidence, markdown ————— */
.aw-prereview { margin: var(--aw-space-3) 0 0; padding: var(--aw-space-3); border-radius: var(--aw-radius-md); background: var(--aw-surface-sidebar); }
.aw-prereview header, .aw-prereview footer { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; }
.aw-prereview__headline { margin: var(--aw-space-2) 0 4px; font-size: var(--aw-type-lg); font-weight: 500; max-width: var(--aw-measure); }
.aw-prereview ul { margin: 4px 0 var(--aw-space-2); padding-left: 20px; font-size: var(--aw-type-md); max-width: var(--aw-measure); }
.aw-prereview footer { margin-top: 6px; }
.aw-evidence { padding: var(--aw-space-2) var(--aw-space-3); }
.aw-evidence header { align-items: baseline; }
.aw-evidence__line { font-size: var(--aw-type-sm); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-evidence__toggle { flex: none; font-size: var(--aw-type-sm); }
.aw-evidence__body { margin-top: var(--aw-space-2); }
.aw-evidence__hint { margin: 0 0 var(--aw-space-2); font-size: var(--aw-type-sm); }
.aw-evidence__cols { display: flex; flex-wrap: wrap; gap: var(--ui-sp-4, 16px); }
.aw-evidence__col { flex: 1 1 280px; min-width: 0; }
.aw-md { margin: 6px 0 8px; overflow-wrap: anywhere; max-width: var(--aw-measure); }
.aw-md p { margin: 0 0 6px; }
.aw-md p:last-child, .aw-md ul:last-child, .aw-md ol:last-child, .aw-md pre:last-child { margin-bottom: 0; }
.aw-md__heading { margin: 10px 0 4px; font-size: var(--aw-type-md); }
.aw-md ul, .aw-md ol { margin: 4px 0 8px; padding-left: 20px; font-size: var(--aw-type-sm); }
.aw-md li { margin: 2px 0; }
.aw-md code { font-family: var(--aw-mono); font-size: var(--aw-type-xs); background: var(--aw-fill); border-radius: var(--aw-radius-sm); padding: 0 4px; overflow-wrap: anywhere; }
.aw-md__code { margin: 4px 0 8px; max-height: 32vh; }
.aw-shots { display: flex; gap: var(--aw-space-2); margin-top: 10px; }
.aw-shots figure { flex: 1; min-width: 0; margin: 0; }
.aw-shots img { display: block; width: 100%; height: auto; border: 1px solid var(--aw-hairline); border-radius: var(--aw-radius-md); background: var(--aw-surface-sidebar); }
.aw-shots figcaption { margin-top: 3px; font-size: var(--aw-type-xs); color: var(--aw-ink-3); }

/* ————— SEO ————— */
.aw-seo-chart { margin: var(--ui-sp-2) 0 var(--ui-sp-1); min-width: 0; }
.aw-seo-chart svg { display: block; max-width: 100%; height: auto; }
.aw-seo-chart__legend { display: flex; align-items: center; gap: var(--ui-sp-3); flex-wrap: wrap; font-size: var(--ui-fs-xs); color: var(--ui-ink-2); }
.aw-seo-chart__dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: var(--ui-sp-1); vertical-align: middle; }

/* ProjectMap — 5-station functional isometric map (06-design-system.md §7.3).
   Uses shared --ui-* tokens exclusively; zero private --aw-w-* tokens. */
.aw-world-wrap {
  container-type: inline-size;
  min-width: 0;
  background: transparent;
}
.aw-world-strip-wrap {
  min-width: 0;
  background: transparent;
  margin-top: var(--ui-sp-2);
}
.aw-world-strip {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-sp-1);
}
.aw-world-strip__item { min-width: 0; }
.aw-world-strip__btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: var(--ui-sp-1);
  height: var(--ui-ctl-h-sm);
  padding: 0 var(--ui-sp-2);
  border-radius: var(--ui-r-sm);
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  color: var(--ui-ink);
  font: inherit;
  font-size: var(--ui-fs-sm);
  line-height: var(--ui-lh-tight);
  cursor: pointer;
  transition: background var(--ui-dur) var(--ui-ease), border-color var(--ui-dur) var(--ui-ease);
}
.aw-world-strip__btn:hover {
  background: var(--ui-bg-hover);
  border-color: var(--ui-border-strong);
}
.aw-world-strip__name { font-weight: 600; color: var(--ui-ink); }
.aw-world-strip__status { color: var(--ui-ink-2); font-size: var(--ui-fs-xs); }

.aw-project__world { padding: var(--ui-sp-2) 0 0; }
.aw-world__bar { display: flex; flex-direction: column; gap: var(--ui-sp-2); margin-bottom: var(--ui-sp-3); }
.aw-world {
  margin: 0;
  display: flex;
  align-items: stretch;
  border-radius: var(--ui-r-lg);
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  color: var(--ui-ink);
  overflow: hidden;
}
.aw-world__stage {
  position: relative;
  flex: 1 1 0;
  background: var(--ui-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: var(--ui-sp-2);
}
.aw-world__svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 400px;
  user-select: none;
  -webkit-user-select: none;
}
.aw-world__floor-plate {
  fill: color-mix(in srgb, var(--ui-bg-subtle) 75%, var(--ui-bg));
  stroke: var(--ui-border-strong);
  stroke-width: 1;
}

.aw-world__cable-base { fill: none; stroke: var(--ui-border-strong); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.aw-world__cable-base.is-connected { stroke: color-mix(in srgb, var(--ui-ink) 42%, transparent); }
.aw-world__cable-base.is-lit { stroke: var(--ui-accent); stroke-width: 2.4; }
.aw-world__cable-arrow { fill: var(--ui-ink-2); }
.aw-world__cable-arrow.is-active { fill: var(--ui-accent); }

.aw-world__station { cursor: pointer; outline: none; }
.aw-world__hit { fill: transparent; stroke: none; }
.aw-world__pad {
  fill: color-mix(in srgb, var(--ui-bg) 85%, var(--ui-bg-subtle));
  stroke: var(--ui-border-strong);
  stroke-width: 1;
  transition: fill var(--ui-dur) var(--ui-ease), stroke var(--ui-dur) var(--ui-ease);
}
.aw-world__lift {
  transition: transform var(--ui-dur) var(--ui-ease);
}
.aw-world__station:hover .aw-world__lift,
.aw-world__station:focus-visible .aw-world__lift { transform: translateY(-3px); }
.aw-world__station.is-active .aw-world__pad { fill: color-mix(in srgb, var(--ui-info) 12%, var(--ui-bg)); stroke: color-mix(in srgb, var(--ui-info) 60%, var(--ui-ink)); }
.aw-world__station.is-warn .aw-world__pad { fill: color-mix(in srgb, var(--ui-warn) 12%, var(--ui-bg)); stroke: color-mix(in srgb, var(--ui-warn) 55%, var(--ui-ink)); }
.aw-world__station.is-bad .aw-world__pad { fill: color-mix(in srgb, var(--ui-bad) 12%, var(--ui-bg)); stroke: color-mix(in srgb, var(--ui-bad) 60%, var(--ui-ink)); }
.aw-world__station.is-selected .aw-world__pad,
.aw-world__station:hover .aw-world__pad { fill: var(--ui-accent-wash); stroke: var(--ui-accent); stroke-width: 1.6; }
.aw-world__station:focus-visible .aw-world__pad { stroke: var(--ui-focus); stroke-width: 2.2; }

/* Pulse strictly on genuinely active stations when motion is permitted. */
@media (prefers-reduced-motion: no-preference) {
  .aw-world__station.is-active .aw-world__pad { animation: aw-world-active-pulse 2s ease-in-out infinite; }
}
@keyframes aw-world-active-pulse { 50% { stroke-opacity: .4; } }

/* Three-tone isometric faces & crisp ink lines */
.aw-world__face-top { fill: color-mix(in srgb, var(--ui-bg) 90%, var(--ui-ink) 10%); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.aw-world__face-left { fill: color-mix(in srgb, var(--ui-bg) 78%, var(--ui-ink) 22%); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.aw-world__face-right { fill: color-mix(in srgb, var(--ui-bg) 64%, var(--ui-ink) 36%); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
@media (prefers-color-scheme: dark) {
  .aw-world__face-top { fill: color-mix(in srgb, var(--ui-bg) 74%, var(--ui-ink) 26%); }
  .aw-world__face-left { fill: color-mix(in srgb, var(--ui-bg) 84%, var(--ui-ink) 16%); }
  .aw-world__face-right { fill: color-mix(in srgb, var(--ui-bg) 92%, var(--ui-ink) 8%); }
}
:where([data-theme='dark']) .aw-world__face-top { fill: color-mix(in srgb, var(--ui-bg) 74%, var(--ui-ink) 26%); }
:where([data-theme='dark']) .aw-world__face-left { fill: color-mix(in srgb, var(--ui-bg) 84%, var(--ui-ink) 16%); }
:where([data-theme='dark']) .aw-world__face-right { fill: color-mix(in srgb, var(--ui-bg) 92%, var(--ui-ink) 8%); }
:where([data-theme='light']) .aw-world__face-top { fill: color-mix(in srgb, var(--ui-bg) 90%, var(--ui-ink) 10%); }
:where([data-theme='light']) .aw-world__face-left { fill: color-mix(in srgb, var(--ui-bg) 78%, var(--ui-ink) 22%); }
:where([data-theme='light']) .aw-world__face-right { fill: color-mix(in srgb, var(--ui-bg) 64%, var(--ui-ink) 36%); }

.aw-world__face-accent-top { fill: color-mix(in srgb, var(--ui-info) 22%, var(--ui-bg)); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-accent-left { fill: color-mix(in srgb, var(--ui-info) 36%, var(--ui-bg)); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-accent-right { fill: color-mix(in srgb, var(--ui-info) 50%, var(--ui-bg)); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-ok { fill: color-mix(in srgb, var(--ui-ok) 22%, var(--ui-bg)); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-bad { fill: color-mix(in srgb, var(--ui-bad) 22%, var(--ui-bg)); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-warn { fill: color-mix(in srgb, var(--ui-warn) 24%, var(--ui-bg)); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__ink-line { fill: none; stroke: var(--ui-ink); stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.aw-world__detail-line { fill: none; stroke: color-mix(in srgb, var(--ui-ink) 50%, transparent); stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; }
.aw-world__window { fill: color-mix(in srgb, var(--ui-ink) 14%, var(--ui-bg)); stroke: var(--ui-ink); stroke-width: 1.1; stroke-linejoin: round; }
.aw-world__window--lit { fill: color-mix(in srgb, var(--ui-info) 36%, var(--ui-bg)); }
.aw-world__window--ok { fill: color-mix(in srgb, var(--ui-ok) 22%, var(--ui-bg)); }

.aw-world__cloche-rim-back { fill: none; stroke: color-mix(in srgb, var(--ui-ink) 32%, transparent); stroke-width: 1; stroke-dasharray: 2.5 2; }
.aw-world__cloche-glass { fill: color-mix(in srgb, var(--ui-ink) 10%, transparent); stroke: var(--ui-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__cloche-glass--active { fill: color-mix(in srgb, var(--ui-info) 18%, transparent); }
.aw-world__cloche-glass--warn { fill: color-mix(in srgb, var(--ui-warn) 18%, transparent); }
.aw-world__cloche-shine { fill: none; stroke: color-mix(in srgb, var(--ui-ink) 30%, transparent); stroke-width: 1.8; stroke-linecap: round; }

.aw-world__station.is-unknown .aw-world__face-top,
.aw-world__station.is-unknown .aw-world__face-left,
.aw-world__station.is-unknown .aw-world__face-right,
.aw-world__station.is-unknown .aw-world__ink-line { stroke-dasharray: 3.5 2.5; stroke: var(--ui-ink-2); fill-opacity: .55; }
.aw-world__station.is-off .aw-world__object { opacity: .66; }
.aw-world__station.is-off:hover .aw-world__object,
.aw-world__station.is-off.is-selected .aw-world__object,
.aw-world__station.is-off:focus-visible .aw-world__object { opacity: .94; }

.aw-world__beacon { stroke: var(--ui-ink); stroke-width: 1.1; }
.aw-world__beacon--ok { fill: var(--ui-ok); }
.aw-world__beacon--active { fill: var(--ui-info); }
.aw-world__beacon--warn { fill: var(--ui-warn); }
.aw-world__beacon--bad { fill: var(--ui-bad); }
.aw-world__beacon--off,
.aw-world__beacon--unknown { fill: var(--ui-bg-subtle); }
.aw-world__badge-bg { fill: var(--ui-accent); stroke: var(--ui-ink); stroke-width: 1.1; }
.aw-world__badge-bg--bad { fill: var(--ui-bad); }
.aw-world__badge-text {
  font-family: var(--ui-mono);
  font-size: var(--ui-fs-sm);
  font-weight: 700;
  fill: var(--ui-accent-ink);
  text-anchor: middle;
  dominant-baseline: central;
}

/* Readable-at-rest two-line label plates (all SVG text ≥11px at 100%) */
.aw-world__leader { stroke: var(--ui-border-strong); stroke-width: 1; stroke-dasharray: 2 2; }
.aw-world__station.is-selected .aw-world__leader,
.aw-world__station:hover .aw-world__leader { stroke: var(--ui-accent); stroke-dasharray: none; }
.aw-world__tag-bg { fill: var(--ui-bg); stroke: var(--ui-border-strong); stroke-width: 1; }
.aw-world__station.is-selected .aw-world__tag-bg,
.aw-world__station:hover .aw-world__tag-bg { stroke: var(--ui-accent); stroke-width: 1.4; }
.aw-world__tag-name {
  font-family: var(--ui-font);
  font-size: var(--ui-fs-md);
  font-weight: 600;
  fill: var(--ui-ink);
  dominant-baseline: central;
}
.aw-world__tag-status {
  font-family: var(--ui-font);
  font-size: var(--ui-fs-sm);
  font-weight: 500;
  fill: var(--ui-ink-2);
  dominant-baseline: central;
}
.aw-world__micro {
  font-family: var(--ui-mono);
  font-size: var(--ui-fs-sm);
  font-weight: 500;
  fill: var(--ui-ink-2);
  text-anchor: middle;
}

/* Shared Inspector overrides for ProjectMap */
.aw-world__caption .ui-inspector__head { padding-right: var(--ui-sp-3); }
.aw-world__caption .ui-inspector__body { display: flex; flex-direction: column; }
.aw-world__inspector { display: flex; flex-direction: column; gap: var(--ui-sp-2); flex: 1; min-width: 0; }
.aw-world__title { color: var(--ui-ink); }
.aw-world .aw-world__explain { margin: 0; font-size: var(--ui-fs-sm); line-height: var(--ui-lh); color: var(--ui-ink-2); max-width: none; }
.aw-world__status-box { padding-top: var(--ui-sp-2); border-top: 1px solid var(--ui-border); display: flex; flex-direction: column; gap: 2px; }
.aw-world__status-label {
  font-family: var(--ui-mono);
  font-size: var(--ui-fs-xs);
  font-weight: 600;
  line-height: var(--ui-lh-tight);
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--ui-ink-2);
}
.aw-world .aw-world__status-value { margin: 0; font-size: var(--ui-fs-sm); font-weight: 600; line-height: var(--ui-lh); color: var(--ui-ink); word-break: break-word; max-width: none; }

.aw-world__meta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px var(--ui-sp-3); margin: 0; padding-top: var(--ui-sp-2); border-top: 1px solid var(--ui-border); font-size: var(--ui-fs-xs); }
.aw-world__meta dt { color: var(--ui-ink-2); font-weight: 600; }
.aw-world__meta dd { margin: 0; color: var(--ui-ink); overflow-wrap: anywhere; }
.aw-world__meta-ok { color: var(--ui-ok); font-weight: 600; }

.aw-world__ops { padding-top: var(--ui-sp-2); border-top: 1px solid var(--ui-border); display: flex; flex-direction: column; gap: var(--ui-sp-1); }
.aw-world__op-chips { display: flex; flex-wrap: wrap; gap: var(--ui-sp-2); }
.aw-world__op-chip { display: inline-flex; align-items: center; gap: var(--ui-sp-1); font-size: var(--ui-fs-xs); line-height: var(--ui-lh-tight); color: var(--ui-ink-2); font-variant-numeric: tabular-nums; }
.aw-world__op-chip strong { color: var(--ui-ink); font-weight: 600; }
.aw-world__op-chip--warn, .aw-world__op-chip--warn strong { color: color-mix(in srgb, var(--ui-warn) 78%, var(--ui-ink)); }
.aw-world__op-chip--bad, .aw-world__op-chip--bad strong { color: var(--ui-bad); }

.aw-world__checks { padding-top: var(--ui-sp-2); border-top: 1px solid var(--ui-border); display: flex; flex-direction: column; gap: var(--ui-sp-1); }
.aw-world__check-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ui-sp-1); }
.aw-world__check-item { display: flex; align-items: flex-start; gap: 6px; padding: 3px 0; font-size: var(--ui-fs-xs); line-height: var(--ui-lh); }
.aw-world__check-mark {
  flex: none;
  width: 14px;
  text-align: center;
  font-family: var(--ui-mono);
  font-size: var(--ui-fs-xs);
  font-weight: 700;
  line-height: var(--ui-lh-tight);
  color: var(--ui-ink-2);
}
.aw-world__check-item.is-pending .aw-world__check-mark { color: var(--ui-warn); }
.aw-world__check-item.is-ready .aw-world__check-mark { color: var(--ui-ok); }
.aw-world__check-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.aw-world__check-label { font-weight: 600; color: var(--ui-ink); }
.aw-world .aw-world__check-detail { margin: 0; font-size: var(--ui-fs-xs); line-height: var(--ui-lh); color: var(--ui-ink-2); word-break: break-word; max-width: none; }
.aw-world__check-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-sp-1) var(--ui-sp-2);
  font-family: var(--ui-mono);
  font-size: var(--ui-fs-xs);
  font-weight: 500;
  line-height: var(--ui-lh-tight);
  color: var(--ui-ink-2);
}
.aw-world__check-who { color: var(--ui-ink); }

.aw-world__actions { display: flex; flex-wrap: wrap; gap: var(--ui-sp-2); padding-top: var(--ui-sp-2); margin-top: auto; border-top: 1px solid var(--ui-border); }
.aw-world__actions--compact { border-top: 0; padding-top: var(--ui-sp-1); margin-top: var(--ui-sp-1); }
.aw-world-wrap a.aw-world__action-link { text-decoration: none; color: var(--ui-ink); }
.aw-world-wrap a.aw-world__action-link:hover { text-decoration: none; }
.aw-world__kbd-hint { margin: var(--ui-sp-1) 0 0; font-size: var(--ui-fs-xs); color: var(--ui-ink-3); }

/* Journey filter strip & preview drift bar */
.aw-world__journeys { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; max-width: 100%; }
.aw-world__journey-pill {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: min(240px, 100%);
  min-width: 0;
  padding: 3px 9px;
  border-radius: var(--ui-r-sm);
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
  color: var(--ui-ink-2);
  font: inherit;
  font-size: var(--ui-fs-xs);
  line-height: var(--ui-lh-tight);
  cursor: pointer;
}
.aw-world__journey-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-world__journey-pill:hover { background: var(--ui-bg-hover); color: var(--ui-ink); }
.aw-world__journey-pill[aria-pressed="true"] {
  border-color: var(--ui-border-strong);
  background: var(--ui-bg-selected);
  color: var(--ui-ink);
  font-weight: 600;
}
.aw-world__journey-pill.is-all { border-style: dashed; flex: none; }
.aw-world__journey-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-ink-3); flex: 0 0 auto; }
.aw-world__journey-pill.is-new .aw-world__journey-dot,
.aw-world__journey-pill.is-in_progress .aw-world__journey-dot { background: var(--ui-info); }
.aw-world__journey-pill.is-review .aw-world__journey-dot { background: var(--ui-warn); }
.aw-world__journey-pill.is-done .aw-world__journey-dot { background: var(--ui-ok); }
@media (max-width: 720px) {
  .aw-world__journeys {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding-right: 20px;
    mask-image: linear-gradient(to right, var(--ui-ink) calc(100% - 20px), transparent);
    -webkit-mask-image: linear-gradient(to right, var(--ui-ink) calc(100% - 20px), transparent);
  }
  .aw-world__journeys::-webkit-scrollbar { display: none; }
  .aw-world__journey-pill { flex: 0 0 auto; max-width: 200px; }
}

.aw-world__drift { margin: 0; font-size: var(--ui-fs-sm); }
.aw-world__drift-toggle {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: var(--ui-r-sm);
  border: 1px solid color-mix(in srgb, var(--ui-warn) 45%, transparent);
  background: color-mix(in srgb, var(--ui-warn) 10%, transparent);
  color: var(--ui-ink);
  font: inherit;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.aw-world__drift-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-warn); flex: none; }
.aw-world__drift-list { list-style: none; margin: 6px 0 0; padding: 0 0 0 var(--ui-sp-2); border-left: 2px solid color-mix(in srgb, var(--ui-warn) 45%, transparent); display: grid; gap: 3px; }
.aw-world__drift-list li { display: flex; align-items: baseline; gap: var(--ui-sp-2); }
.aw-world__drift-item { appearance: none; border: 0; background: none; padding: 0; color: var(--ui-ink); font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
span.aw-world__drift-item { cursor: default; color: var(--ui-ink-2); }
button.aw-world__drift-item:hover { text-decoration: underline; }
.aw-world__drift-age { flex: 0 0 auto; color: color-mix(in srgb, var(--ui-warn) 78%, var(--ui-ink)); font-variant-numeric: tabular-nums; font-size: var(--ui-fs-xs); }

.aw-world__journey { padding-bottom: var(--ui-sp-3); border-bottom: 1px solid var(--ui-border); }
.aw-world__journey-sentence { margin: 3px 0 6px; font-size: var(--ui-fs-sm); line-height: var(--ui-lh); color: var(--ui-ink); }
.aw-world__journey-links { display: flex; flex-wrap: wrap; gap: 6px; }
.aw-world-wrap a.aw-world__journey-chip { display: inline-block; padding: 2px var(--ui-sp-2); border-radius: var(--ui-r-sm); border: 1px solid var(--ui-border-strong); background: var(--ui-bg); color: var(--ui-ink); font-size: var(--ui-fs-xs); text-decoration: none; }
.aw-world-wrap a.aw-world__journey-chip:hover { background: var(--ui-bg-hover); }
.aw-world__station.is-journey-ahead .aw-world__lift,
.aw-world__station.is-journey-ahead .aw-world__pad { opacity: .45; }
.aw-world__station.is-journey-ahead .aw-world__label { opacity: .82; }
.aw-world__station.is-journey-ahead.is-selected .aw-world__lift,
.aw-world__station.is-journey-ahead.is-selected .aw-world__pad,
.aw-world__station.is-journey-ahead.is-selected .aw-world__label,
.aw-world__station.is-journey-ahead:hover .aw-world__lift,
.aw-world__station.is-journey-ahead:hover .aw-world__pad,
.aw-world__station.is-journey-ahead:hover .aw-world__label { opacity: 1; }
.aw-world__station.is-journey-current .aw-world__pad { fill: color-mix(in srgb, var(--ui-accent) 16%, var(--ui-bg)); stroke: var(--ui-accent); stroke-width: 1.6; }

/* Narrow fallback: vertical route list (hidden on wide, replaces SVG map ≤900px) */
.aw-world__route {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--ui-border);
}
.aw-world__route-item {
  position: relative;
  padding: var(--ui-sp-3) 0 var(--ui-sp-3) var(--ui-sp-4);
  border-bottom: 1px solid var(--ui-border);
}
.aw-world__route-item::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--ui-border);
}
.aw-world__route-item:first-child::before { top: 18px; }
.aw-world__route-item:last-child { border-bottom: 0; }
.aw-world__route-item:last-child::before { bottom: calc(100% - 18px); }
.aw-world__route-head { display: flex; align-items: center; gap: var(--ui-sp-2); flex-wrap: wrap; }
.aw-world__route-dot {
  position: absolute;
  left: 0;
  top: 16px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ui-border-strong);
  border: 2px solid var(--ui-bg);
}
.aw-world__route-dot--ok { background: var(--ui-ok); }
.aw-world__route-dot--active { background: var(--ui-info); }
.aw-world__route-dot--warn { background: var(--ui-warn); }
.aw-world__route-dot--bad { background: var(--ui-bad); }
.aw-world__route-name { font-size: var(--ui-fs-md); font-weight: 600; flex: 1; min-width: 0; color: var(--ui-ink); }
.aw-world__route-status { margin: var(--ui-sp-1) 0 0; font-size: var(--ui-fs-sm); color: var(--ui-ink); }
.aw-world__route-sub { margin: 2px 0 0; font-size: var(--ui-fs-xs); color: var(--ui-ink-2); }
.aw-world__ops--inline { padding-top: var(--ui-sp-1); border-top: 0; }
.aw-world__route-checks { padding: var(--ui-sp-1) 0 0; }
.aw-world__route-checks > summary { cursor: pointer; font-size: var(--ui-fs-xs); font-weight: 500; color: var(--ui-ink-2); padding: 2px 0; }
.aw-world__route-checks .aw-world__checks { border-top: 0; padding-top: var(--ui-sp-1); }
.aw-world__route-checks .aw-world__status-label { display: none; }

.aw-sr-only, .aw-world__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

/* Replace isometric map with vertical route list below ~900px viewport or ≤780px container */
@media (max-width: 900px) {
  .aw-world { display: none; }
  .aw-world__route { display: block; }
}
@container (max-width: 780px) {
  .aw-world { display: none; }
  .aw-world__route { display: block; }
}
@media (prefers-reduced-motion: reduce) {
  .aw-world__station.is-active .aw-world__pad { animation: none; }
  .aw-world__pad, .aw-world__lift, .aw-world-strip__btn { transition: none; }
  .aw-world__station:hover .aw-world__lift,
  .aw-world__station:focus-visible .aw-world__lift { transform: none; }
}
:where([data-reduced-motion='1']) .aw-world__station.is-active .aw-world__pad { animation: none; }
:where([data-reduced-motion='1']) .aw-world__pad,
:where([data-reduced-motion='1']) .aw-world__lift,
:where([data-reduced-motion='1']) .aw-world-strip__btn { transition: none; }
:where([data-reduced-motion='1']) .aw-world__station:hover .aw-world__lift,
:where([data-reduced-motion='1']) .aw-world__station:focus-visible .aw-world__lift { transform: none; }

/* Marketing desk: flat hairline sections, capped measure, compact narrow rows, quiet chart. */
.aw-mk { max-width: var(--aw-measure-table, 1180px); margin: 0 auto; width: 100%; min-width: 0; }
.aw .aw-mk.ui-workspace { max-width: none; padding-inline: var(--ui-sp-3); }
.aw-mk p { max-width: var(--aw-measure, 72ch); }
.aw-mk .aw-seg { width: fit-content; align-self: flex-start; }
.aw-mk .aw-panel {
  border: 0;
  border-top: 1px solid var(--ui-border);
  border-radius: 0;
  padding: var(--ui-sp-5) 0;
  margin: 0;
  background: transparent;
}
.aw-mk-overview > .aw-panel:first-child,
.aw-mk > .aw-panel:first-of-type,
.aw-mk .ui-split__main > .aw-panel:first-child,
.aw-mk .aw-pagetabs + .aw-panel { border-top: 0; padding-top: var(--ui-sp-3); }
.aw-mk .aw-panel__head { margin-bottom: var(--ui-sp-3); }
.aw-mk .aw-panel__titles h3 { font-size: var(--ui-fs-lg); font-weight: 600; }
.aw-mk .aw-rows { border: 0; border-top: 1px solid var(--ui-border); border-radius: 0; overflow: visible; }
.aw-mk .aw-row { padding: var(--ui-sp-2) 0; }
.aw-mk .aw-row + .aw-row { border-top: 1px solid var(--ui-border); }
.aw-mk .aw-row:hover { background: var(--ui-bg-hover); }
.aw-mk-meter__num, .aw-chart__tick, .aw-chart__day, .aw-needs, .aw-mk-kinds { font-variant-numeric: tabular-nums; }

.aw-mk-health { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 240px; }
.aw-mk-health .aw-mk-meter { margin: 0; }
.aw-mk-meter { display: inline-flex; align-items: center; gap: 8px; margin: 2px 14px 2px 0; white-space: nowrap; }
.aw-mk-meter__label { color: var(--aw-ink-2); font-size: var(--aw-type-sm, 12px); min-width: 62px; }
.aw-mk-meter__track { position: relative; width: 72px; height: 5px; background: var(--aw-fill); border-radius: var(--aw-radius-sm); flex: none; }
.aw-mk-meter__fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: var(--aw-radius-sm); background: var(--aw-ok); }
.aw-mk-meter__fill--warn { background: var(--aw-warn); }
.aw-mk-meter__fill--bad { background: var(--aw-bad); }
.aw-mk-meter__limit { position: absolute; top: -2px; bottom: -2px; left: 80%; width: 1px; background: var(--aw-ink-2); opacity: .55; }
.aw-mk-meter__num { color: var(--aw-ink-2); font-size: var(--aw-type-sm, 12px); }
.aw-mk-bad { color: var(--aw-bad); }

.aw-mk-findings { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--aw-space-2, 8px) var(--aw-space-4, 16px); margin-top: var(--aw-space-3, 12px); padding-top: var(--aw-space-2, 8px); font-size: var(--aw-type-sm, 12px); }
.aw-mk-kinds-label { margin: 0; font-size: var(--aw-type-sm, 12px); }
.aw-mk-kinds { display: flex; flex-wrap: wrap; gap: var(--aw-space-1, 4px) var(--aw-space-4, 16px); margin: 0; font-size: var(--aw-type-sm, 12px); }
.aw-mk-kind { display: inline-flex; align-items: baseline; gap: 5px; }
.aw-mk-kind dt { color: var(--aw-ink-2); }
.aw-mk-kind dd { margin: 0; font-weight: 600; color: var(--aw-ink); }

.aw-needs { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.aw-needs li { display: flex; align-items: center; gap: var(--aw-space-3, 12px); min-height: var(--aw-row-h-table, 36px); padding: var(--aw-space-2, 8px) 0; border-top: 1px solid var(--aw-hairline); }
.aw-needs li:first-child { border-top: 0; }
.aw-needs li > span { flex: 1; min-width: 0; }
.aw-needs .aw-btn { flex: none; margin-left: auto; }

.aw-mk-exp-foot { margin-top: var(--aw-space-3, 12px); display: flex; flex-direction: column; gap: 4px; }
.aw-mk-exp-foot p { margin: 0; font-size: var(--aw-type-sm, 12px); }

/* Quiet single-purpose 14-day chart */
.aw-chart { margin: 0; }
.aw-chart__head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--aw-space-2, 8px) var(--aw-space-4, 16px); margin: 0 0 var(--aw-space-2, 8px); }
.aw-chart__totals { color: var(--aw-ink-2); font-size: var(--aw-type-sm, 12px); font-variant-numeric: tabular-nums; }
.aw-chart__legend { display: inline-flex; align-items: center; gap: var(--aw-space-3, 12px); font-size: var(--aw-type-xs, 11px); color: var(--aw-ink-2); }
.aw-chart__legend span { display: inline-flex; align-items: center; gap: 4px; }
.aw-chart__key { display: inline-block; width: 7px; height: 7px; border-radius: 2px; }
.aw-chart__key--sent { background: var(--aw-fill); border: 1px solid var(--aw-hairline-strong); }
.aw-chart__key--bounce { background: var(--aw-bad); }
.aw-chart__key--reply { background: var(--aw-ok); border-radius: 50%; }
.aw-chart__key--post { background: var(--ui-info); }
.aw-chart__svg { display: block; }
.aw-chart__grid { stroke: var(--ui-border); stroke-width: 1; }
.aw-chart__axis { stroke: var(--ui-border-strong); stroke-width: 1; }
.aw-chart__tick, .aw-chart__day { fill: var(--ui-ink-2); font-size: var(--ui-fs-xs); }
.aw-chart__bar { fill: var(--ui-bg-selected); }
.aw-chart__bounce { fill: var(--ui-bad); }
.aw-chart__reply { fill: var(--ui-ok); }
.aw-chart__post { fill: var(--ui-info); }

/* Replies: hairline rows with aligned timestamp and explicit row action */
.aw-mk-replies { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--aw-hairline); }
.aw-mk-reply {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--aw-space-3, 12px);
  padding: var(--aw-space-3, 12px) var(--aw-space-1, 4px);
  border-bottom: 1px solid var(--aw-hairline);
  cursor: pointer;
}
.aw-mk-reply:last-child { border-bottom: 0; }
.aw-mk-reply:hover { background: var(--aw-hover); }
.aw-mk-reply__body { min-width: 0; }
.aw-mk-reply__who { display: block; font-size: var(--aw-type-md, 13px); font-weight: 600; color: var(--aw-ink); }
.aw-mk-reply__text { margin: 2px 0 0; font-size: var(--aw-type-sm, 12px); max-width: var(--aw-measure, 72ch); }
.aw-mk-reply__meta { display: inline-flex; align-items: center; gap: var(--aw-space-2, 8px); white-space: nowrap; }
.aw-mk-reply__age { font-size: var(--aw-type-xs, 11px); font-variant-numeric: tabular-nums; }

/* Marketing loading skeletons */
.aw-mk-skel { display: grid; gap: var(--aw-space-2, 8px); padding: var(--aw-space-2, 8px) 0; }
.aw-mk-skel__row { display: block; height: 18px; border-radius: var(--aw-radius-sm); background: var(--aw-fill); max-width: 540px; }
.aw-mk-skel__row:nth-child(2) { max-width: 420px; opacity: .75; }
.aw-mk-skel__row:nth-child(3) { max-width: 480px; opacity: .55; }
.aw-mk-skel__chart { display: block; height: 164px; border-radius: var(--aw-radius-md); background: var(--aw-fill); opacity: .65; }

.aw-form2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--aw-space-4, 16px); max-width: 860px; }

/* Compact narrow layout (≤720px & 390px): 2-column compact label/value rows instead of ~5,000px stack */
@media (max-width: 720px) {
  .aw-mk .aw-panel { padding: var(--aw-space-4, 16px) 0; }
  .aw-form2 { grid-template-columns: 1fr; }
  .aw-mk-reply { grid-template-columns: minmax(0, 1fr); gap: var(--aw-space-1, 4px); }
  .aw-mk-reply > .aw-tag { justify-self: start; }
  .aw-mk-reply__meta { justify-content: space-between; width: 100%; }
}
.aw-mk-window input { flex: none; width: 58px; min-width: 0; }
.aw-mk-window input[aria-label="Window offset minutes"] { width: 72px; }
.aw-divider { border: 0; border-top: 1px solid var(--aw-hairline); margin: var(--aw-space-4, 16px) 0 var(--aw-space-1, 4px); }

/* Project solutions: kinds of work, the fleet note, and the client's connections. */
.aw-dot--muted { background: var(--aw-hairline-strong); }
.aw-psol { margin: 2px 0; }
.aw-psol__h { margin: var(--aw-space-3, 12px) 0 var(--aw-space-1, 4px); font-size: var(--aw-type-xs, 11px); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--aw-ink-2); }
.aw-psol__h:first-child { margin-top: 0; }
.aw-psol__fleet { margin: var(--aw-space-2, 8px) 0 0; font-size: var(--aw-type-sm, 12px); color: var(--aw-ink-2); }
.aw-psol__fleet--warn { color: color-mix(in srgb, var(--aw-warn) 80%, var(--aw-ink)); font-weight: 600; }
.aw-psol__rows { list-style: none; margin: 0; padding: 0; }
.aw-psol__row { display: flex; align-items: center; gap: var(--aw-space-2, 8px); min-height: var(--aw-row-h-table, 36px); padding: var(--aw-space-2, 8px) 0; border-top: 1px solid var(--aw-hairline); }
.aw-psol__row:first-child { border-top: 0; }
.aw-psol__rowmain { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--aw-space-2, 8px); flex-wrap: wrap; }
.aw-psol__miss { font-family: var(--aw-mono); font-size: var(--aw-type-xs, 11px); color: var(--aw-ink-2); }
.aw-psol__err { font-size: var(--aw-type-sm, 12px); color: var(--aw-bad); }
.aw-psol__rowact { flex: none; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.aw-psol__skel { display: grid; gap: var(--aw-space-2, 8px); padding: var(--aw-space-1, 4px) 0; }
.aw-psol__skel > span:not(.aw-sr-only) { display: block; height: 20px; max-width: 440px; border-radius: var(--aw-radius-sm); background: var(--aw-fill); }
.aw-psol__skel > span:last-child { max-width: 340px; opacity: .7; }
.aw-psol__brief { margin-top: var(--aw-space-3, 12px); }
.aw-psol__brief > summary { cursor: pointer; color: var(--aw-ink-2); font-size: var(--aw-type-sm, 12px); }
.aw-psol__brief[open] > summary { margin-bottom: var(--aw-space-1, 4px); }
.aw-psol__briefitem { padding: var(--aw-space-2, 8px) 0; border-top: 1px solid var(--aw-hairline); font-size: var(--aw-type-sm, 12px); max-width: var(--aw-measure, 72ch); }
.aw-psol__briefitem ul { margin: 2px 0 var(--aw-space-2, 8px); padding-left: 18px; color: var(--aw-ink-2); }
.aw-psol__tags { display: inline-flex; align-items: center; gap: var(--aw-space-1, 4px); flex-wrap: wrap; }
.aw-psol__steps { margin: 0 0 10px; padding-left: 20px; }
.aw-psol__steps li { margin: 3px 0; font-size: var(--aw-type-sm, 12px); color: var(--aw-ink-2); }
@media (max-width: 720px) {
  .aw-psol__row { flex-wrap: wrap; }
  .aw-psol__rowact { width: 100%; padding-left: 16px; }
}

/* ————— Shared primitives (ui.jsx): one shape each, for every view ————— */
.aw-emptybox { padding: var(--aw-space-6) var(--aw-space-4); display: flex; flex-direction: column; align-items: center; gap: var(--aw-space-1); text-align: center; color: var(--aw-ink-2); }
.aw-emptybox__icon { color: var(--aw-ink-3); margin-bottom: var(--aw-space-1); }
.aw-emptybox strong { font-size: var(--aw-type-md); font-weight: 600; color: var(--aw-ink); }
.aw-emptybox__hint { font-size: var(--aw-type-sm); max-width: 52ch; }
.aw-emptybox__action { margin-top: var(--aw-space-2); display: flex; gap: var(--aw-space-2); }
.aw-emptybox--inline { padding: var(--aw-space-4) var(--aw-space-2); align-items: flex-start; text-align: left; }
.aw-loading { display: block; padding: var(--aw-space-4) 0; color: var(--aw-ink-2); font-size: var(--aw-type-sm); }
@keyframes aw-spin { to { transform: rotate(1turn); } }
.aw-errornote { display: flex; align-items: center; gap: var(--aw-space-2) var(--aw-space-3); flex-wrap: wrap; padding: var(--aw-space-2) var(--aw-space-3); border-radius: var(--aw-radius-md); margin: var(--aw-space-2) 0; background: var(--aw-bad-wash); color: var(--aw-bad-ink); font-size: var(--aw-type-sm); }
.aw-errornote__text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.aw-panel__head { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; margin-bottom: var(--aw-space-2); }
.aw-panel__titles { flex: 1; min-width: 0; }
.aw-panel__titles h3 { font-size: var(--aw-type-md); font-weight: 600; margin: 0; }
.aw-panel__titles p { margin: 2px 0 0; color: var(--aw-ink-2); font-size: var(--aw-type-sm); }
.aw-panel__actions { display: flex; align-items: center; gap: var(--aw-space-1); flex: none; flex-wrap: wrap; }
/* StatRow: figures in a line; no boxes. */
.aw-statrow { display: flex; flex-wrap: wrap; gap: var(--aw-space-2) var(--aw-space-5); margin: var(--aw-space-2) 0; }
.aw-statrow__item { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.aw-statrow__item strong { font-size: var(--aw-type-lg); font-weight: 600; line-height: 1.3; }
.aw-statrow__item small { font-size: var(--aw-type-xs); color: var(--aw-ink-2); }
.aw-statrow__item--ok strong { color: var(--aw-ok-ink); }
.aw-statrow__item--warn strong { color: var(--aw-warn-ink); }
.aw-statrow__item--bad strong { color: var(--aw-bad-ink); }
.aw-statrow__item--info strong { color: var(--aw-info-ink); }
.aw-statrow__item--accent strong { color: var(--aw-ink); }
.aw-tag--pill { height: 18px; padding: 0 7px; border-radius: var(--aw-radius-pill); }
/* One page header (PageHeader): title + one-line context left; meta, actions
   and the overflow menu right. No box, no border. */
.aw-pagehead { display: flex; align-items: center; gap: var(--aw-space-2) var(--aw-space-4); flex-wrap: wrap; min-height: 40px; margin-bottom: var(--aw-space-3); }
.aw-pagehead__titles { flex: 1 1 280px; min-width: 0; }
.aw-pagehead__titles h2 { margin: 0; font-size: var(--aw-type-xl); font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.aw-pagehead__titles p { margin: 1px 0 0; color: var(--aw-ink-2); font-size: var(--aw-type-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aw-pagehead__side { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; justify-content: flex-end; }
.aw-pagehead__meta { display: flex; align-items: center; gap: var(--aw-space-1); flex-wrap: wrap; }
.aw-pagehead__actions { display: flex; align-items: center; gap: var(--aw-space-2); flex-wrap: wrap; }
.aw-pagehead__secondary { display: contents; }
/* One subnav (PageTabs / Subnav): underline tabs on one hairline; scrolls. */
.aw-pagetabs { display: flex; align-items: flex-end; gap: var(--aw-space-4); border-bottom: 1px solid var(--aw-hairline); margin-bottom: var(--aw-space-4); overflow-x: auto; scrollbar-width: none; }
.aw-pagetabs::-webkit-scrollbar { display: none; }
@media (max-width: 900px) {
  /* A tab strip that runs off the edge reads as scrolled, not clipped. */
  .aw-pagetabs { padding-right: 20px; mask-image: linear-gradient(to right, ${LEGACY_LITERALS.shade} calc(100% - 20px), transparent); -webkit-mask-image: linear-gradient(to right, ${LEGACY_LITERALS.shade} calc(100% - 20px), transparent); }
}

.aw-pagetabs button { appearance: none; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 2px; margin-bottom: -1px; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--aw-ink-2); font: inherit; font-size: var(--aw-type-md); cursor: pointer; white-space: nowrap; }
.aw-pagetabs button:hover { color: var(--aw-ink); }
.aw-pagetabs button[aria-selected="true"] { color: var(--aw-ink); border-bottom-color: var(--aw-accent); font-weight: 600; }
.aw-pagetabs button:focus-visible { outline-offset: -2px; }
.aw-pagetabs__badge { display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: var(--aw-radius-pill); background: var(--aw-fill); color: var(--aw-ink-2); font-size: var(--aw-type-xs); font-weight: 600; font-variant-numeric: tabular-nums; }

/* ————— Menu, context menu, overflow ————— */
.aw-overflow-anchor { display: inline-flex; flex: none; }
.aw-menu { position: fixed; z-index: 70; min-width: 200px; max-width: 320px; max-height: min(480px, 80vh); overflow-y: auto; padding: 4px; border-radius: var(--aw-radius-lg); background: var(--aw-surface-raised); color: var(--aw-ink); box-shadow: var(--aw-shadow-float); font-size: var(--aw-type-md); animation: aw-fade var(--aw-dur) var(--aw-ease); list-style: none; margin: 0; }
.aw-menu:focus { outline: none; }
.aw-menu__item { display: flex; align-items: center; gap: var(--aw-space-3); width: 100%; height: 28px; padding: 0 var(--aw-space-2); border: 0; border-radius: var(--aw-radius-sm); background: none; color: inherit; text-align: left; cursor: default; white-space: nowrap; }
.aw-menu__item > span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.aw-menu__item small { color: var(--aw-ink-3); font-size: var(--aw-type-xs); }
.aw-menu__item:hover { background: var(--aw-hover); }
.aw-menu__item.is-active, .aw-menu__item:focus-visible { background: var(--aw-accent); color: var(--aw-accent-ink); outline: none; }
.aw-menu__item.is-active small { color: inherit; opacity: .75; }
.aw-menu__item--danger { color: var(--aw-bad-ink); }
.aw-menu__item[aria-disabled=true] { color: var(--aw-ink-3); }
.aw-menu__item[aria-disabled=true].is-active { background: var(--aw-hover); color: var(--aw-ink-3); }
.aw-menu__sep { height: 1px; margin: 4px var(--aw-space-2); background: var(--aw-hairline); }
.aw-menu__label { padding: 4px var(--aw-space-2) 2px; font-size: var(--aw-type-xs); font-weight: 600; color: var(--aw-ink-3); }

/* ————— Skeleton: the final shape, quietly ————— */
.aw-skel { display: flex; flex-direction: column; gap: 10px; padding: var(--aw-space-2) 0; }
.aw-skel__bar { height: 10px; border-radius: var(--aw-radius-sm); background: var(--aw-fill); animation: aw-skel 1.4s ease-in-out infinite; }
.aw-skel__bar--title { height: 16px; width: 34%; margin-bottom: 6px; }
.aw-skel__row { display: flex; align-items: center; gap: var(--aw-space-3); height: var(--aw-row-h-table); border-bottom: 1px solid var(--aw-hairline); }
.aw-skel__row .aw-skel__bar { flex: none; }
.aw-skel__lanes { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 1fr); gap: var(--aw-space-3); }
.aw-skel__lane { height: 280px; border-radius: var(--aw-radius-lg); background: var(--aw-surface-sidebar); padding: var(--aw-space-3); display: flex; flex-direction: column; gap: var(--aw-space-2); }
.aw-skel__card { height: 64px; border-radius: var(--aw-radius-md); background: var(--aw-surface); }
.aw-skel--pane { padding: var(--aw-space-4) var(--aw-space-5); }
.aw-skel.aw-skel--ticket { gap: var(--ui-sp-2, 8px); }
@keyframes aw-skel { 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .aw-skel__bar { animation: none; } }

/* ————— Shortcut sheet ————— */
.aw-keys { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 0 var(--aw-space-5); margin: 0; }
.aw-keys > div { display: flex; align-items: center; gap: var(--aw-space-3); min-height: 30px; border-bottom: 1px solid var(--aw-hairline); font-size: var(--aw-type-md); }
.aw-keys dt { order: 2; margin-left: auto; display: flex; gap: 3px; }
.aw-keys dd { margin: 0; color: var(--aw-ink); }

/* ————— shell, continued ————— */
.aw-topbanner { position: absolute; z-index: 5; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: var(--aw-space-3); padding: 4px var(--aw-space-3); background: color-mix(in srgb, var(--aw-bad) 9%, var(--aw-surface)); border-bottom: 1px solid color-mix(in srgb, var(--aw-bad) 35%, var(--aw-hairline)); color: var(--aw-ink); font-size: var(--aw-type-sm); }
.aw-topbanner > span { flex: 1; min-width: 0; }
.aw-loading--fill { position: absolute; inset: 0; padding: 0; }
.aw-toast > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.aw-toast__close { flex: none; border: 0; background: none; color: inherit; cursor: pointer; padding: 0; width: 18px; height: 18px; display: grid; place-items: center; opacity: .7; border-radius: var(--aw-radius-sm); }
.aw-toast__close:hover { opacity: 1; }
.aw-palette__count { margin: 2px 12px 8px; color: var(--aw-ink-3); font-size: var(--aw-type-xs); }
.aw-drawer-scrim { position: fixed; inset: 0; z-index: 59; background: var(--aw-scrim); animation: aw-fade var(--aw-dur) var(--aw-ease); }
@media (max-width: 900px) {
  .aw-explorer--drawer { display: block; position: fixed; z-index: 60; top: 0; bottom: 0; left: 0; width: min(300px, 86vw); box-shadow: var(--aw-shadow-float); animation: aw-slide var(--aw-dur) var(--aw-ease); }
  .aw--inset .aw-explorer--drawer { padding-top: 32px; }
}
@keyframes aw-slide { from { transform: translateX(-12px); opacity: 0; } }
/* Keyboard rows: visible focus wherever a row can receive it. */
.aw-row:focus-visible { outline: 2px solid var(--aw-focus); outline-offset: -2px; }
.aw-titlelink { color: inherit; text-decoration: none; }
.aw-titlelink:hover { text-decoration: underline; text-decoration-color: var(--aw-hairline-strong); }
/* The right rail's rare controls, folded behind one summary. */
.aw-details > details.aw-details__more { border-top: 1px solid var(--aw-hairline); padding-top: var(--aw-space-3); margin-top: var(--aw-space-2); }
.aw-details__more > summary { cursor: pointer; font-size: var(--aw-type-sm); font-weight: 500; color: var(--aw-ink-2); list-style: none; display: flex; align-items: center; gap: 6px; }
.aw-details__more > summary::-webkit-details-marker { display: none; }
.aw-details__more > summary::before { content: ''; width: 0; height: 0; border-left: 4px solid currentColor; border-top: 4px solid transparent; border-bottom: 4px solid transparent; transition: transform var(--aw-dur) var(--aw-ease); }
.aw-details__more[open] > summary::before { transform: rotate(90deg); }
.aw-details__more[open] > summary { margin-bottom: var(--aw-space-3); }
.aw-details__more .aw-cost, .aw-details__more .aw-site { border-top: 1px solid var(--aw-hairline); padding-top: var(--aw-space-3); margin-top: var(--aw-space-3); }
.aw-mentions__open { font-size: var(--aw-type-sm); }
.aw-notified { margin-top: 2px; }
.aw-notified summary { cursor: pointer; font-size: var(--aw-type-xs); }
.aw-notified p { margin: 2px 0; }
/* directory */
.aw-directory .aw-rows > li + li { border-top: 0; }
.aw-directory__open { width: 100%; text-align: left; color: inherit; font: inherit; border: 0; background: transparent; }
.aw-directory__open:focus-visible { outline: 2px solid var(--aw-focus); outline-offset: -2px; }
.aw-directory__project { cursor: default; }
.aw-directory__project:hover { background: transparent; }
.aw-directory__name { display: grid; flex: 1 1 9rem; min-width: 0; overflow-wrap: anywhere; }
.aw-directory__name strong { font-weight: 500; }
.aw-health--compact .aw-health__row { min-height: var(--aw-row-h-tight); }
/* marketing */
.aw-mk-controls { margin-bottom: var(--ui-sp-3); }
.aw-mk-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--ui-sp-2); margin-bottom: var(--ui-sp-3); min-width: 0; }
.aw-mk-bar > .aw-search { min-width: 0; flex: 1 1 200px; max-width: 320px; }
.aw-mk-spacer { flex: 1; min-width: var(--ui-sp-2); }
.aw-mk-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-sp-1); }
.aw-mk-cell-row { display: inline-flex; align-items: center; gap: var(--ui-sp-1); min-width: 0; max-width: 100%; }
.aw-mk-cell-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-mk-cell-sub { display: block; font-size: var(--ui-fs-xs); color: var(--ui-ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-mk-cell-err { display: block; font-size: var(--ui-fs-xs); color: var(--ui-bad); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-mk-click { cursor: pointer; }
.aw-mk-row-start { align-items: flex-start; }
.aw-mk-copy { white-space: pre-wrap; font: inherit; line-height: var(--ui-lh); overflow-wrap: anywhere; max-width: 72ch; }
.aw-mk-preview { padding: var(--ui-sp-3); border: 1px solid var(--ui-border); border-radius: var(--ui-r-md); margin: var(--ui-sp-2) 0 0; font-size: var(--ui-fs-sm); background: var(--ui-bg); }
.aw-mk-no-top { margin-top: 0; }
.aw-mk-subject { font-weight: 600; margin: var(--ui-sp-2) 0; font-size: var(--ui-fs-md); }
.aw-mk-figure { margin: var(--ui-sp-3) 0; }
.aw-mk-preview-image { display: block; height: auto; max-width: 100%; border: 1px solid var(--ui-border); border-radius: var(--ui-r-md); }
.aw-mk-entry { border-top: 1px solid var(--ui-border); padding-block: var(--ui-sp-3); }
.aw-mk-entry:first-child { border-top: 0; padding-top: 0; }
.aw-mk-field-stack { display: flex; flex-direction: column; gap: var(--ui-sp-3); margin-top: var(--ui-sp-3); }
.aw-mk-inspector-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--ui-border); }
.aw-mk-inspector-item { display: flex; flex-direction: column; gap: var(--ui-sp-1); padding: var(--ui-sp-2) 0; border-bottom: 1px solid var(--ui-border); font-size: var(--ui-fs-sm); }
.aw-mk-inspector-item--btn { width: 100%; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--ui-border); color: inherit; font: inherit; cursor: pointer; padding: var(--ui-sp-2) var(--ui-sp-1); }
.aw-mk-inspector-item--btn:hover { background: var(--ui-bg-hover); }
.aw-mk-inspector-item--btn:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: -2px; }
.aw-mk-inspector-row { display: flex; align-items: center; gap: var(--ui-sp-2); min-width: 0; }
.aw-mk-inspector-row > .aw-mk-cell-title { flex: 1; min-width: 0; }
.aw-mk-loops { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--ui-border); }
.aw-mk-loop {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--ui-sp-1) var(--ui-sp-2);
  width: 100%; padding: var(--ui-sp-2) var(--ui-sp-1); border: 0; border-bottom: 1px solid var(--ui-border);
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.aw-mk-loop:hover { background: var(--ui-bg-hover); }
.aw-mk-loop[aria-current='true'] { background: var(--ui-bg-selected); box-shadow: inset 2px 0 0 var(--ui-accent); }
.aw-mk-loop:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: -2px; }
.aw-mk-loop__name { font-weight: 500; font-size: var(--ui-fs-md); color: var(--ui-ink); }
.aw-mk-loop__next { grid-column: 1 / -1; font-size: var(--ui-fs-xs); color: var(--ui-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.aw-mk-settings-fields { display: grid; gap: var(--ui-sp-4); min-inline-size: 0; margin: 0; padding: 0; border: 0; }
.aw-mk .ui-table td { height: auto; min-height: var(--ui-row-h); padding-block: var(--ui-sp-2); }
@container (max-width: 720px) {
  .aw-mk .ui-table :is(th, td)[data-fit] { width: auto; }
  .aw-mk .ui-table td { padding: 0; min-height: 0; }
  .aw-mk .ui-table td + td { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: var(--ui-sp-1); margin-top: var(--ui-sp-1); margin-right: var(--ui-sp-3); }
}
.aw-mk-scrim { display: none; }
@media (max-width: 900px) {
  .aw-mk-scrim { display: block; position: fixed; inset: 0; z-index: 49; background: var(--ui-scrim); }
  .aw-mk .ui-split > .ui-inspector {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    width: auto; max-height: 85vh; margin: 0;
    border: 0; border-top: 1px solid var(--ui-border-strong);
    border-radius: var(--ui-r-lg) var(--ui-r-lg) 0 0;
    background: var(--ui-bg); box-shadow: var(--ui-shadow);
  }
}
/* seo: one quiet strip, sections without cards, DataTable + Inspector per tab */
.aw-seo .aw-pagehead__titles p { white-space: normal; }
.aw-seo-strip { padding-bottom: var(--ui-sp-2); margin-bottom: var(--ui-sp-3); border-bottom: 1px solid var(--ui-border); }
.aw-seo-modes { display: flex; align-items: center; gap: var(--ui-sp-3, 12px); flex-wrap: wrap; margin: var(--ui-sp-3, 12px) 0; }
.aw-seo-source-question { display: block; padding: 2px 0; text-align: left; font-size: var(--ui-fs-sm, 12px); white-space: normal; overflow-wrap: anywhere; }
.aw-seo-strip .aw-statrow { margin: var(--ui-sp-2) 0 0; }
.aw-seo-strip .aw-statrow__item strong { font-size: var(--ui-fs-lg); font-weight: 600; }
.aw-seo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--ui-sp-4) var(--ui-sp-6); }
.aw-seo-section { min-width: 0; margin-top: var(--ui-sp-4); }
.aw-seo-section__head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-sp-2); flex-wrap: wrap; }
.aw-seo-section__title { display: flex; align-items: baseline; gap: var(--ui-sp-2); flex-wrap: wrap; margin: 0 0 var(--ui-sp-2); font-size: var(--ui-fs-md); font-weight: 600; color: var(--ui-ink); }
.aw-seo-section__title .ui-note { font-weight: 400; font-size: var(--ui-fs-xs); }
.aw-seo-section .ui-meta { margin: var(--ui-sp-1) 0 0; }
.aw-seo-gap { margin-top: var(--ui-sp-2); }
.aw-seo-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ui-sp-2) var(--ui-sp-3); min-height: var(--ui-filter-h); margin-bottom: var(--ui-sp-2); }
.aw-seo-filters select { width: auto; max-width: 100%; }
.aw-seo-filters__meta { margin-left: auto; font-size: var(--ui-fs-sm); color: var(--ui-ink-3); font-variant-numeric: tabular-nums; }
.aw-seo-chart__dot--accent { background: var(--ui-ink-2); }
.aw-seo-chart__dot--warn { background: var(--ui-warn); }
.aw-seo-chart__dot--ok { background: var(--ui-ok); }
.aw-seo-detail { margin: 0 0 var(--ui-sp-2); font-size: var(--ui-fs-md); color: var(--ui-ink); overflow-wrap: anywhere; }
.aw-seo-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ui-sp-2); font-size: var(--ui-fs-sm); }
.aw-seo-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--ui-sp-1) var(--ui-sp-2); min-width: 0; overflow-wrap: anywhere; }
.aw-seo-list__text { flex-basis: 100%; color: var(--ui-ink-2); }
.aw-seo-list--ranked { counter-reset: rank; }
.aw-seo-list--ranked li::before { counter-increment: rank; content: counter(rank); min-width: 2ch; color: var(--ui-ink-3); font-variant-numeric: tabular-nums; }
.aw-seo a.aw-btn { text-decoration: none; }
.aw-seo-form { margin-top: var(--ui-sp-3); }
.aw-seo-form :is(input, select, textarea) { width: 100%; }
.aw-seo .ui-split__main > .ui-disclosure { flex: none; }
.aw-seo-scrim { display: none; }
@media (max-width: 900px) {
  .aw-seo-scrim { display: block; position: fixed; inset: 0; z-index: 49; background: var(--ui-scrim); }
  .aw-seo .ui-split > .ui-inspector {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    width: auto; max-height: 85vh; margin: 0;
    border: 0; border-top: 1px solid var(--ui-border-strong);
    border-radius: var(--ui-r-lg) var(--ui-r-lg) 0 0;
    background: var(--ui-bg); box-shadow: var(--ui-shadow);
  }
}
/* seo settings (moves to the unified Settings later) */
.aw-seo-row { cursor: default; }
.aw-seo .aw-rows .aw-seo-row { display: flex; align-items: center; gap: var(--aw-space-2); min-height: var(--aw-row-h); padding: 0 var(--aw-space-1); }
.aw-seo-events-form { margin-bottom: var(--aw-space-3); }

/* fleet, clients, settings */
.aw-fleet .aw-group, .aw-clients .aw-group, .aw-client .aw-group { margin: var(--aw-space-5) 0; }
.aw-health--compact { margin: 0 0 var(--aw-space-5); }
.aw-health--compact .aw-health__summary h3 { font-size: var(--aw-type-md); font-weight: 600; }
.aw-health__head { display: flex; align-items: center; gap: var(--aw-space-3); }
.aw-health__pass { margin-top: var(--aw-space-1); }
.aw-health__pass > summary { cursor: pointer; padding: 4px var(--aw-space-2); font-size: var(--aw-type-sm); color: var(--aw-ink-2); }
.aw-machine .aw-kv { margin-bottom: var(--aw-space-2); }
.aw-machine .aw-mexes { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 2px var(--aw-space-4); }
/* This Mac's panel inside the node Inspector: the Inspector owns its title, state and controls, and lists its runs. */
.aw-fleet-machine .aw-machine { padding: 0; border: 0; }
.aw-fleet-machine .aw-machine > header, .aw-fleet-machine .aw-machine > .aw-rows { display: none; }
.aw-fleet-machine .aw-machine .aw-mexes { grid-template-columns: minmax(0, 1fr); }
/* Stacked DataTable rows (container ≤720px, e.g. beside an open Inspector): a fit column must not keep its 1% width,
   and the cells after the title read as one wrapping line of facts. */
@container (max-width: 720px) {
  :is(.aw-fleet, .aw-clients, .aw-client) .ui-table td[data-fit] { width: auto; }
  :is(.aw-fleet, .aw-clients, .aw-client) .ui-table td + td { display: inline-block; max-width: 100%; margin: var(--ui-sp-1) var(--ui-sp-3) 0 0; vertical-align: top; }
}
.aw-wizard-steps { display: flex; flex-wrap: wrap; gap: var(--ui-sp-2, 8px); margin: 0 0 var(--ui-sp-4, 16px); padding: 0; list-style: none; counter-reset: aw-step; }
.aw-wizard-steps li { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border: 1px solid var(--ui-border, var(--aw-hairline)); border-radius: 999px; font-size: var(--ui-fs-xs, 11px); color: var(--ui-ink-3, inherit); }
.aw-wizard-steps li::before { counter-increment: aw-step; content: counter(aw-step); display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: var(--ui-fill, var(--aw-fill)); font-variant-numeric: tabular-nums; }
.aw-wizard-steps li[data-current] { border-color: var(--ui-accent, var(--aw-accent)); color: var(--ui-ink, inherit); }
.aw-wizard-steps li[data-current]::before { background: var(--ui-accent, var(--aw-accent)); color: var(--aw-accent-ink, var(--ui-accent-ink, inherit)); }
.aw-wizard-steps li[data-done] { color: var(--ui-ink, inherit); }
.aw-section-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-sp-3, 12px); margin: 0 0 var(--ui-sp-2, 8px); }
.aw-section-head .ui-section__title { margin: 0; }
.aw-assign__list { display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow: auto; margin: var(--ui-sp-3, 12px) 0; padding: 4px; border: 1px solid var(--ui-border, var(--aw-hairline)); border-radius: var(--ui-r-lg, 10px); background: var(--ui-bg-subtle, var(--aw-fill)); }
.aw-assign__row { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: var(--ui-r-md, 6px); cursor: pointer; font-size: var(--ui-fs-sm, 12px); }
.aw-assign__row:hover { background: var(--ui-bg-hover, var(--aw-fill)); }
.aw-assign__row[data-checked] { background: var(--ui-bg-selected, var(--aw-fill)); }
.aw-assign__name { flex: 0 1 auto; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-assign__slug { flex: 1; min-width: 0; color: var(--ui-ink-3, inherit); font-family: var(--ui-mono, ui-monospace); font-size: var(--ui-fs-xs, 11px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-assign__state { flex: none; color: var(--ui-ink-3, inherit); font-size: var(--ui-fs-xs, 11px); }
.aw-clients .aw-row { flex-wrap: nowrap; }
.aw-clients .aw-row > .aw-muted { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--aw-type-sm); }
.aw-clients .aw-row > .aw-muted:last-child { flex: none; }
.aw-clients .aw-directory__name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--aw-type-sm); }
/* —— Settings: one workspace — header, 180px section nav, bounded form, one SaveBar —— */
.aw-settings__body { flex: 1; min-height: 0; min-width: 0; display: flex; gap: var(--ui-sp-5); }
.aw-settings__nav { flex: none; width: 180px; display: flex; flex-direction: column; gap: 2px; padding-top: var(--ui-sp-1); }
.aw-settings__navitem {
  display: flex; align-items: center; height: 28px; padding: 0 var(--ui-sp-3); border: 0; border-radius: var(--ui-r-md);
  background: none; color: var(--ui-ink-2); font: inherit; font-size: var(--ui-fs-md); text-align: left; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: inset 2px 0 0 transparent;
}
.aw-settings__navitem:hover { background: var(--ui-bg-hover); color: var(--ui-ink); }
.aw-settings__navitem[aria-current="page"] { background: var(--ui-bg-selected); color: var(--ui-ink); font-weight: 600; box-shadow: inset 2px 0 0 var(--ui-accent); }
.aw-settings__navitem:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: -2px; }
.aw-settings__main { flex: 1; min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
.aw-settings__main > .ui-form { flex: 1 0 auto; width: 100%; padding-bottom: var(--ui-sp-4); }
.aw-settings__main > .ui-savebar { margin-top: auto; padding-inline: 0; max-width: var(--ui-form-max); width: 100%; }
.aw-settings-form__head { display: flex; align-items: center; gap: var(--ui-sp-3); flex-wrap: wrap; margin-bottom: var(--ui-sp-3); }
.aw-settings-form__fill { flex: 1; }
/* Field row: the label beside its control, hint and error under the control. */
.aw-settings-form .aw-field {
  display: grid; grid-template-columns: minmax(140px, 200px) minmax(0, 1fr); align-items: start;
  gap: var(--ui-sp-1) var(--ui-sp-4); margin-bottom: var(--ui-sp-4);
}
.aw-settings-form .aw-field > .aw-field__label { grid-column: 1; grid-row: 1 / span 3; padding-top: 5px; color: var(--ui-ink-2); }
.aw-settings-form .aw-field > :not(.aw-field__label) { grid-column: 2; min-width: 0; }
.aw-settings-form .aw-field > input:not([type="checkbox"]):not(.aw-settings-num),
.aw-settings-form .aw-field > select { max-width: 360px; }
.aw-settings-form .aw-settings-num { width: 120px; max-width: 100%; }
.aw-settings-form .aw-settings-token { flex: 0 1 240px; width: 240px; min-width: 0; }
/* Segmented stays intrinsic: never stretched to the column. */
.aw-settings-form .aw-seg { justify-self: start; align-self: start; width: fit-content; max-width: 100%; }
.aw-settings-form .aw-panel > h3 { margin-bottom: var(--ui-sp-3); }
.aw-settings-form .aw-mk-settings-fields { gap: 0; }
.aw-settings-form .aw-panel { margin-bottom: var(--ui-sp-2); }
.aw-settings__main > .ui-form > .aw-panel:first-child:not(:has(> header)) { border-top: 0; padding-top: 0; }
.aw-settings-form .aw-panel__head { margin-bottom: var(--ui-sp-3); }
@media (max-width: 900px) {
  .aw-settings__body { flex-direction: column; gap: var(--ui-sp-3); flex: none; }
  .aw-settings__nav { width: auto; flex-direction: row; flex-wrap: wrap; gap: 0 6px; overflow: visible; padding-top: 0; border-bottom: 0; }
  .aw-settings__navitem { flex: none; height: 32px; border-radius: 0; box-shadow: inset 0 -2px 0 transparent; }
  .aw-settings__navitem[aria-current="page"] { background: none; box-shadow: inset 0 -2px 0 var(--ui-accent); }
  .aw-settings__main { overflow: visible; flex: none; }
}
@media (max-width: 600px) {
  .aw-settings-form .aw-field { grid-template-columns: minmax(0, 1fr); }
  .aw-settings-form .aw-field > .aw-field__label { grid-row: auto; padding-top: 0; }
  .aw-settings-form .aw-field > :not(.aw-field__label) { grid-column: 1; }
}
/* the ticket rail */
.aw-details__pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--aw-space-2); margin-bottom: var(--aw-space-3); }
.aw-details__pair > .aw-field { margin-bottom: 0; }
.aw-details__pair select { font-size: var(--aw-type-sm); padding-inline: var(--aw-space-2) 22px; }
.aw-details .aw-seg { display: flex; width: fit-content; max-width: 100%; }
.aw-details .aw-seg button { flex: 1 1 0; padding-inline: var(--aw-space-1); }
.aw-mailto { color: inherit; text-decoration: none; }
.aw-mailto:hover { text-decoration: underline; }
.aw-run footer .aw-tag--dash { box-shadow: none; background: none; padding-inline: 0; height: auto; color: var(--aw-ink-2); font-size: var(--aw-type-xs); }
/* Needs you */
.aw-inbox .aw-group { margin: var(--aw-space-5) 0; }
.aw-group__hint { font-size: var(--aw-type-sm); font-weight: 400; color: var(--aw-ink-2); }
.aw-inbox__offline { display: flex; align-items: center; gap: var(--aw-space-2); margin: 0 0 var(--aw-space-4); padding: 6px var(--aw-space-3); border-radius: var(--aw-radius-md); background: var(--aw-warn-wash); font-size: var(--aw-type-sm); color: var(--aw-ink); }
.aw-inbox .aw-row { flex-wrap: nowrap; }
.aw-inbox .aw-row > .aw-row__title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-inbox .aw-row > .aw-muted { flex: none; white-space: nowrap; font-size: var(--aw-type-sm); }
.aw-inbox .aw-row > .aw-mono { flex: none; }
.aw-inbox .aw-row__actions { display: flex; flex: none; justify-content: flex-end; gap: var(--aw-space-1); min-width: 150px; }
.aw-inbox .aw-row__actions > .aw-btn { flex: none; }
.aw-row__meta { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--aw-type-sm); color: var(--aw-ink-2); }
/* New task */
.aw-taskform { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.aw-taskform .aw-field { margin-bottom: var(--aw-space-3); }
.aw-taskform .aw-field:nth-last-child(-n + 2) { margin-bottom: 0; }
.aw-taskform + .aw-field { margin-top: var(--aw-space-3); }

/* Compact stacked rows (aw-table--rows, with aw-table--stack): the title on
   its own line, then the other cells as label-value pairs that wrap. */
/* ————— narrow: one pane, bottom bar, sheets ————— */
@media (max-width: 720px) {
  .aw-board { grid-auto-columns: minmax(78vw, 1fr); }
  .aw-pagehead__titles p { white-space: normal; }
  .aw-taskform { grid-template-columns: 1fr; }
  .aw-taskform .aw-field:nth-last-child(-n + 2) { margin-bottom: var(--aw-space-3); }
  .aw-inbox .aw-row { flex-wrap: wrap; row-gap: 2px; }
  .aw-inbox .aw-row > .aw-row__title { flex-basis: calc(100% - 60px); }
  .aw-inbox .aw-row__actions { min-width: 0; margin-left: auto; }
  .aw-node__lines { padding-left: 0; }
  .aw-node .aw-rows { margin-left: 0; }
  .aw-node__line { white-space: normal; }
}
@media (max-width: 600px) {
  .aw { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; grid-template-areas: "main" "act"; }
  .aw-activity { flex-direction: row; justify-content: space-around; padding: 2px 4px calc(2px + env(safe-area-inset-bottom)); border-right: 0; border-top: 1px solid var(--aw-hairline); gap: 0; }
  .aw-activity__spacer { display: none; }
  .aw-activity button { width: 38px; height: 40px; }
  .aw-activity button[aria-current=page]::before, .aw-activity button[aria-pressed=true]::before { left: 9px; right: 9px; top: auto; bottom: -2px; width: auto; height: 2px; }
  .aw-activity [data-tip]::after { display: none; }
  .aw--inset .aw-activity { padding-top: 2px; }
  .aw-status { display: none; }
  .aw-toast { bottom: 64px; left: var(--aw-space-3); right: var(--aw-space-3); max-width: none; }
  .aw-view, .aw-ticket__main { padding: var(--aw-space-3) var(--aw-space-3) var(--aw-space-5); }
  .aw-pagehead__secondary { display: none; }
  .aw-pagehead__meta { display: none; }
  .aw-pagehead__side { flex: 0 0 auto; margin-left: auto; justify-content: flex-end; }
  .aw-scrim { padding: 0; place-items: end stretch; }
  .aw-scrim--top { padding: 8px; place-items: start stretch; }
  .aw-modal { width: 100%; max-height: 92%; border-radius: 12px 12px 0 0; animation-name: aw-sheet; }
  .aw-modal--full { height: 92%; }
  .aw-modal__foot { padding-bottom: calc(var(--aw-space-3) + env(safe-area-inset-bottom)); }
  .aw-tab { max-width: 160px; }
  .aw-composer { position: static; box-shadow: none; }
  .aw-keys > div { font-size: var(--aw-type-sm); }
}
@keyframes aw-sheet { from { transform: translateY(16px); opacity: 0; } }

`;
