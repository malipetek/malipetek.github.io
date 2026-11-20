/*
 * The workbench's CSS, injected by the app itself so both hosts get the same
 * styles with no build step for CSS. Colours follow the host: the Harness theme
 * tokens when present, the site's palette otherwise.
 */
export const STYLES = `
.aw {
  --aw-bg: var(--dsw-alias-bg-base, var(--bone, #fff));
  --aw-bg2: var(--dsw-alias-bg-layer-1, var(--paper, #f8f7f4));
  --aw-bg3: var(--dsw-alias-bg-layer-2, var(--rule, #efebe4));
  --aw-hover: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  --aw-text: var(--dsw-alias-label-primary, var(--ink, #16140f));
  --aw-text2: var(--dsw-alias-label-secondary, var(--ink-soft, #5d5850));
  --aw-border: var(--dsw-alias-border-l2, var(--rule, #e8e4dd));
  --aw-border2: var(--dsw-alias-border-l3, var(--rule-strong, #d2ccc2));
  --aw-accent: var(--orange, #ff5a1f);
  --aw-ok: var(--dsw-alias-state-success-primary, #2f9e5b);
  --aw-warn: var(--dsw-alias-state-warn-primary, #d99a16);
  --aw-bad: var(--dsw-alias-state-error-primary, #d6453d);
  --aw-info: var(--dsw-alias-state-business-primary, #3b7bd9);
  --aw-violet: #8a63d2;
  --aw-mono: var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  /* one design system: the one scale; every size in this sheet snaps to it */
  --aw-r-sm: 4px;
  --aw-r-md: 6px;
  --aw-r-lg: 8px;
  --aw-r-pill: 999px;
  --aw-sp-1: 4px;
  --aw-sp-2: 6px;
  --aw-sp-3: 8px;
  --aw-sp-4: 12px;
  --aw-sp-5: 16px;
  --aw-sp-6: 24px;
  --aw-fs-xs: 11px;
  --aw-fs-sm: 12px;
  --aw-fs-md: 13px;
  --aw-fs-lg: 15px;
  --aw-fs-xl: 18px;
  --aw-text3: color-mix(in srgb, var(--aw-text2) 70%, var(--aw-bg));
  --aw-line: var(--aw-border);
  display: grid;
  grid-template-columns: 48px auto minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 22px;
  height: 100%;
  min-height: 0;
  background: var(--aw-bg);
  color: var(--aw-text);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif;
  position: relative;
  overflow: hidden;
}
.aw *, .aw *::before, .aw *::after { box-sizing: border-box; }
.aw--fullscreen { position: fixed; inset: 0; z-index: 50; height: 100dvh; }
.aw h2, .aw h3, .aw h4 { font-family: inherit; margin: 0; letter-spacing: 0; }
.aw button { font: inherit; color: inherit; }
.aw input, .aw select, .aw textarea {
  font: inherit; color: var(--aw-text); background: var(--aw-bg);
  border: 1px solid var(--aw-border2); border-radius: 6px; padding: 6px 8px; min-width: 0;
}
.aw textarea { width: 100%; resize: vertical; line-height: 1.5; }
.aw input:focus, .aw select:focus, .aw textarea:focus { outline: 2px solid color-mix(in srgb, var(--aw-accent) 50%, transparent); outline-offset: -1px; }
/* One focus ring for everything; inputs keep their inset ring below it. */
.aw :is(button, a, input, select, textarea, summary, [role=tab], [tabindex]):focus-visible { outline: 2px solid var(--aw-accent); outline-offset: 2px; }
.aw :is(input, select, textarea):focus-visible { outline: 2px solid color-mix(in srgb, var(--aw-accent) 50%, transparent); outline-offset: -1px; }
.aw [hidden] { display: none !important; }
.aw-mono { font-family: var(--aw-mono); font-size: 12px; }
.aw-muted { color: var(--aw-text2); }
.aw-warn { color: color-mix(in srgb, var(--aw-warn) 70%, var(--aw-text)); }
.aw-bad { color: var(--aw-bad); }
.aw-center { text-align: center; }
.aw-link { background: none; border: 0; padding: 0; color: var(--aw-accent); cursor: pointer; }
.aw-link:hover { text-decoration: underline; }
.aw-empty { padding: 40px; text-align: center; color: var(--aw-text2); }
/* Bordered tinted info box, and the inline error text (after .aw-empty so it wins there). */
.aw-callout { display: flex; align-items: flex-start; gap: var(--aw-sp-2); padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--aw-info) 30%, transparent); border-radius: var(--aw-r-lg); background: color-mix(in srgb, var(--aw-info) 8%, transparent); margin: 10px 0; overflow-wrap: anywhere; }
.aw-error { color: var(--aw-bad); font-size: var(--aw-fs-sm); }
.aw-toolbar__fill, .aw-tabs__fill, .aw-status__fill { flex: 1; }

/* activity bar */
.aw-activity { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0; background: var(--aw-bg2); border-right: 1px solid var(--aw-border); }
.aw-activity button { position: relative; width: 34px; height: 34px; display: grid; place-items: center; border: 0; background: none; border-radius: 8px; color: var(--aw-text2); cursor: pointer; }
.aw-activity button:hover { background: var(--aw-hover); color: var(--aw-text); }
.aw-activity button[aria-pressed="true"] { color: var(--aw-text); box-shadow: inset 2px 0 0 var(--aw-accent); border-radius: 0 8px 8px 0; }
.aw-activity__spacer { flex: 1; }
/* Under the macOS window buttons: start below them. */
.aw--inset .aw-activity { padding-top: 40px; }
.aw--inset .aw-explorer { padding-top: 32px; }
.aw-badge { position: absolute; top: 4px; right: 3px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--aw-accent); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; }

/* explorer */
.aw-explorer { grid-column: 2; grid-row: 1; width: var(--aw-explorer-w, 260px); overflow: auto; background: var(--aw-bg2); border-right: 1px solid var(--aw-border); padding: 6px 0 16px; }
.aw-explorer h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--aw-text2); padding: 12px 12px 4px; }
.aw-tree, .aw-tree ul { list-style: none; margin: 0; padding: 0; }
.aw-tree ul { padding-left: 18px; }
.aw-tree__row { display: flex; align-items: center; padding-right: 10px; }
.aw-tree__row.is-active { background: var(--aw-hover); }
.aw-tree__twist { width: 20px; border: 0; background: none; color: var(--aw-text2); cursor: pointer; padding: 0 0 0 6px; }
.aw-tree__name, .aw-tree__leaf { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; border: 0; background: none; padding: 4px 10px 4px 4px; text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 4px; }
.aw-tree__leaf { width: 100%; padding-left: 12px; color: var(--aw-text); }
.aw-tree__name { font-weight: 600; }
.aw-tree__name:hover, .aw-tree__leaf:hover { background: var(--aw-hover); }
.aw-tree__id { color: var(--aw-text2); font-family: var(--aw-mono); font-size: 11px; }
.aw-tree__none { padding: 3px 12px; color: var(--aw-text2); font-size: 12px; }
.aw-count { margin-left: 6px; padding: 0 6px; border-radius: var(--aw-r-lg); background: var(--aw-bg3); color: var(--aw-text2); font-size: 11px; font-weight: 600; }

/* main + tabs */
.aw-main { grid-column: 3; grid-row: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.aw-tabs { display: flex; align-items: stretch; height: 32px; background: var(--aw-bg2); border-bottom: 1px solid var(--aw-border); overflow-x: auto; scrollbar-width: none; }
.aw-tab { display: flex; align-items: center; gap: 6px; max-width: 240px; padding: 0 6px 0 12px; border-right: 1px solid var(--aw-border); color: var(--aw-text2); cursor: pointer; white-space: nowrap; user-select: none; }
.aw-tab:hover { background: var(--aw-hover); }
.aw-tab.is-active { background: var(--aw-bg); color: var(--aw-text); box-shadow: inset 0 2px 0 var(--aw-accent); }
.aw-tab__label { overflow: hidden; text-overflow: ellipsis; }
.aw-tab__close { border: 0; background: none; width: 20px; height: 20px; border-radius: 4px; color: var(--aw-text2); cursor: pointer; opacity: .5; font-size: 15px; line-height: 1; }
.aw-tab:hover .aw-tab__close, .aw-tab.is-active .aw-tab__close { opacity: 1; }
.aw-tab__close:hover { background: var(--aw-hover); }
.aw-content { flex: 1; min-height: 0; position: relative; }
.aw-pane { position: absolute; inset: 0; overflow: auto; container-type: size; }
.aw-view { padding: 16px 20px 40px; }
.aw-hero { margin-bottom: 14px; }
.aw-hero h2 { font-size: 20px; font-weight: 700; }

/* status bar */
.aw-status { grid-column: 1 / -1; grid-row: 2; display: flex; align-items: center; gap: 14px; padding: 0 10px; background: var(--aw-bg2); border-top: 1px solid var(--aw-border); color: var(--aw-text2); font-size: 12px; }
.aw-status button { border: 0; background: none; padding: 0 4px; height: 100%; display: flex; align-items: center; gap: 6px; cursor: pointer; color: inherit; }
.aw-status button:hover { background: var(--aw-hover); color: var(--aw-text); }
.aw-status__err { color: var(--aw-bad); }

/* controls */
.aw-btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 6px; border: 1px solid var(--aw-border2); background: var(--aw-bg); cursor: pointer; white-space: nowrap; font-weight: 500; }
.aw-btn:hover:not(:disabled) { background: var(--aw-hover); }
.aw-btn:disabled { opacity: .45; cursor: default; }
.aw-btn--sm { height: 26px; padding: 0 9px; font-size: 12px; }
.aw-btn--primary { background: var(--aw-accent); color: #fff !important; border-color: var(--aw-accent); }
.aw-btn--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--aw-accent) 85%, #fff); border-color: color-mix(in srgb, var(--aw-accent) 85%, #fff); }
.aw-btn--danger { color: var(--aw-bad) !important; border-color: color-mix(in srgb, var(--aw-bad) 50%, transparent); }
.aw-btn--ghost { border-color: transparent; background: none; }
.aw-seg { display: inline-flex; border: 1px solid var(--aw-border2); border-radius: 6px; overflow: hidden; flex-wrap: wrap; }
.aw-seg button { border: 0; background: none; padding: 4px 10px; cursor: pointer; font-size: 12px; color: var(--aw-text2); }
.aw-seg button + button { border-left: 1px solid var(--aw-border); }
.aw-seg button:is([aria-pressed="true"], [aria-checked="true"]) { background: var(--aw-bg3); color: var(--aw-text); font-weight: 600; }
.aw-seg button:disabled { cursor: default; }
.aw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.aw-chips button { border: 1px dashed var(--aw-border2); background: none; border-radius: var(--aw-r-pill); padding: 3px 10px; font-size: 12px; cursor: pointer; color: var(--aw-text2); }
.aw-chips button[aria-pressed="true"] { border-style: solid; border-color: var(--aw-text); color: var(--aw-text); background: var(--aw-bg3); }
.aw-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.aw-field__label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--aw-text2); }
.aw-field__hint { font-size: 12px; color: var(--aw-text2); }
.aw-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 18px; }
.aw-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aw-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.aw-check input { flex: none; width: auto; min-width: 0; margin: 0; }
.aw-people { margin: 6px 0; }
.aw-people ul { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 2px; }
.aw-people li { display: flex; align-items: center; gap: 8px; min-width: 0; }
.aw-people__who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.aw-people .aw-check { font-size: 12px; color: var(--aw-text2); white-space: nowrap; }
.aw-inline input { flex: 1; min-width: 120px; }
.aw-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.aw-search { width: 200px; }

.aw-pill { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: var(--aw-r-pill); font-size: 12px; font-weight: 600; background: var(--aw-bg3); }
.aw-pill--new { background: color-mix(in srgb, var(--aw-info) 16%, transparent); color: var(--aw-info); }
.aw-pill--approved { background: color-mix(in srgb, var(--aw-violet) 16%, transparent); color: var(--aw-violet); }
.aw-pill--in_progress { background: color-mix(in srgb, var(--aw-warn) 20%, transparent); color: color-mix(in srgb, var(--aw-warn) 80%, var(--aw-text)); }
.aw-pill--review { background: color-mix(in srgb, var(--aw-accent) 16%, transparent); color: var(--aw-accent); }
.aw-pill--done { background: color-mix(in srgb, var(--aw-ok) 16%, transparent); color: var(--aw-ok); }
.aw-pill--declined { background: color-mix(in srgb, var(--aw-text2) 12%, transparent); color: var(--aw-text2); }
.aw-sq { width: 9px; height: 9px; border-radius: var(--aw-r-sm); flex: none; background: var(--aw-text2); display: inline-block; }
.aw-sq--new { background: var(--aw-info); } .aw-sq--approved { background: var(--aw-violet); } .aw-sq--in_progress { background: var(--aw-warn); }
.aw-sq--review { background: var(--aw-accent); } .aw-sq--done { background: var(--aw-ok); } .aw-sq--declined { background: var(--aw-border2); }
.aw-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; background: var(--aw-text2); }
.aw-dot--ok { background: var(--aw-ok); } .aw-dot--warn { background: var(--aw-warn); } .aw-dot--bad { background: var(--aw-bad); }
.aw-live { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; background: var(--aw-warn); animation: aw-pulse 1.4s ease-in-out infinite; }
@keyframes aw-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--aw-warn) 60%, transparent); } 50% { box-shadow: 0 0 0 4px transparent; } }
@media (prefers-reduced-motion: reduce) { .aw-live { animation: none; } }
.aw-tag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 4px; background: var(--aw-bg3); font-size: 11px; color: var(--aw-text2); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.aw-tag--dash { background: none; border: 1px dashed var(--aw-border2); }
.aw-tag--client, .aw-tag--info { background: color-mix(in srgb, var(--aw-info) 12%, transparent); color: var(--aw-info); }
.aw-tag--hot, .aw-tag--accent { background: color-mix(in srgb, var(--aw-accent) 15%, transparent); color: var(--aw-accent); }
.aw-tag--warn { background: color-mix(in srgb, var(--aw-warn) 18%, transparent); color: color-mix(in srgb, var(--aw-warn) 75%, var(--aw-text)); }
.aw-tag--ok { background: color-mix(in srgb, var(--aw-ok) 14%, transparent); color: var(--aw-ok); }
.aw-tag--bad { background: color-mix(in srgb, var(--aw-bad) 14%, transparent); color: var(--aw-bad); }
.aw-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.aw-running { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--aw-text2); }

/* board */
.aw-view--board { display: flex; flex-direction: column; height: 100%; padding-bottom: 0; }
.aw-board { flex: 1; min-height: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(230px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 16px; }
.aw-col { display: flex; flex-direction: column; min-height: 0; background: var(--aw-bg2); border: 1px solid var(--aw-border); border-radius: var(--aw-r-lg); }
.aw-col.is-over { border-color: var(--aw-accent); background: color-mix(in srgb, var(--aw-accent) 6%, var(--aw-bg2)); }
.aw-col > header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-weight: 700; font-size: 12px; }
.aw-col__body { flex: 1; overflow-y: auto; padding: 0 8px 10px; display: flex; flex-direction: column; gap: 8px; }
.aw-col__empty { margin: 8px 4px; font-size: 12px; color: var(--aw-text2); }
.aw-card { background: var(--aw-bg); border: 1px solid var(--aw-border); border-radius: 8px; padding: 9px 10px; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.aw-card:hover { border-color: var(--aw-border2); box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.aw-card:focus-visible { outline: 2px solid var(--aw-accent); }
.aw-card.is-running { border-left: 3px solid var(--aw-warn); }
.aw-card.is-stuck { border-left: 3px solid var(--aw-bad); }
.aw-card__top { display: flex; align-items: center; gap: 6px; }
.aw-card__id { font-family: var(--aw-mono); font-size: 11px; color: var(--aw-text2); }
.aw-card__age { margin-left: auto; font-size: 11px; color: var(--aw-text2); }
.aw-card h4 { font-size: 13px; font-weight: 600; margin: 5px 0 4px; line-height: 1.35; }
.aw-card__meta { display: flex; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--aw-text2); }
.aw-card__foot { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 7px; font-size: 11px; }
.aw-card__foot:empty { display: none; }
.aw-card__warn { margin: 6px 0 0; font-size: 11px; color: var(--aw-bad); }

/* list + tables */
.aw-tablewrap, .aw-table-wrap { overflow-x: auto; }
.aw-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.aw-table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--aw-text2); padding: 6px 8px; border-bottom: 1px solid var(--aw-border2); cursor: pointer; white-space: nowrap; user-select: none; }
.aw-table td { padding: 7px 8px; border-bottom: 1px solid var(--aw-border); white-space: nowrap; }
.aw-table tbody tr { cursor: pointer; }
.aw-table tbody tr:hover { background: var(--aw-hover); }
.aw-table__title { white-space: normal !important; min-width: 220px; font-weight: 500; }

/* needs you */
.aw-inbox { max-width: 1100px; }
.aw-group { margin: 22px 0; }
.aw-group > h3 { font-size: var(--aw-fs-lg); font-weight: 700; display: flex; align-items: center; }
.aw-group > p { margin: 2px 0 8px; }
.aw-row-h { display: flex; align-items: center; gap: 8px; }
.aw-rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--aw-border); border-radius: 8px; overflow: hidden; }
.aw-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; flex-wrap: wrap; }
.aw-row + .aw-row { border-top: 1px solid var(--aw-border); }
.aw-row:hover { background: var(--aw-hover); }
.aw-row__title { font-weight: 600; }
.aw-banner { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; margin: 10px 0; }
.aw-banner--bad { background: color-mix(in srgb, var(--aw-bad) 10%, transparent); }
.aw-snippet { display: block; font-weight: 400; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 520px; }
.aw-files { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.aw-file { font: inherit; font-size: 12px; display: inline-flex; gap: 6px; align-items: baseline; padding: 3px 8px; border: 1px solid var(--aw-border2); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; max-width: 100%; overflow-wrap: anywhere; }
button.aw-file:hover { border-color: currentColor; }
.aw-banner--warn { background: color-mix(in srgb, var(--aw-warn) 12%, transparent); }
.aw-banner--ok { background: color-mix(in srgb, var(--aw-ok) 12%, transparent); }

/* ticket */
.aw-ticket { display: grid; grid-template-columns: minmax(0, 1fr) var(--aw-details-w, 300px); min-height: 100%; position: relative; }
/* No details column: the thread gets the whole width, and the moves the column
   used to hold sit under the title instead. */
.aw-ticket--solo { grid-template-columns: minmax(0, 1fr); }
.aw-ticket__quick { margin-top: 12px; }
.aw-ticket__quick .aw-ticket__actions { padding-bottom: 0; border-bottom: 0; }
.aw-ticket__main { padding: 18px 24px 24px; min-width: 0; display: flex; flex-direction: column; }
.aw-ticket__head h2 { font-size: var(--aw-fs-xl); font-weight: 700; margin: 4px 0 10px; line-height: 1.25; }
.aw-ticket__head { padding-bottom: 4px; border-bottom: 1px solid var(--aw-border); margin-bottom: 4px; }
.aw-ticket__crumbs { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--aw-text2); }
.aw-ticket__crumbs span + span::before { content: '·'; margin-right: 10px; }
.aw-ticket__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 1px solid var(--aw-border); }
.aw-timeline { list-style: none; margin: 0; padding: 16px 0; display: flex; flex-direction: column; gap: 12px; flex: 1; }
.aw-event { display: flex; gap: 10px; font-size: 12px; color: var(--aw-text2); padding-left: 12px; border-left: 2px solid var(--aw-border); }
.aw-event time { margin-left: auto; white-space: nowrap; }
.aw-msg { border: 1px solid var(--aw-border); border-radius: var(--aw-r-lg); padding: 10px 14px; background: var(--aw-bg); }
.aw-msg--client { border-left: 3px solid var(--aw-info); }
.aw-msg--ali { border-left: 3px solid var(--aw-text); }
.aw-msg.is-private { background: color-mix(in srgb, var(--aw-warn) 7%, var(--aw-bg)); border-style: dashed; border-left-style: solid; border-left-color: var(--aw-warn); }
.aw-msg header, .aw-run header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 5px; font-size: 12px; }
.aw-msg header time { margin-left: auto; color: var(--aw-text2); }
.aw-msg__body { white-space: pre-wrap; overflow-wrap: anywhere; }
.aw-msg__body.is-clipped, .aw-run__summary.is-clipped { max-height: 7.5em; overflow: hidden; mask-image: linear-gradient(#000 55%, transparent); -webkit-mask-image: linear-gradient(#000 55%, transparent); }
.aw-fold { cursor: pointer; user-select: none; }
.aw-fold__chev { display: inline-grid; place-items: center; width: 18px; height: 18px; margin-left: -4px; border: 0; padding: 0; background: none; color: var(--aw-text2); cursor: pointer; border-radius: 4px; transition: transform .12s; }
.aw-fold__chev:hover { background: var(--aw-hover); color: var(--aw-text); }
.aw-fold__chev.is-open { transform: rotate(90deg); }
.aw-fold__more { margin-top: 4px; font-size: 12px; }
.aw-run { border: 1px solid var(--aw-border); border-radius: var(--aw-r-lg); padding: 10px 14px; background: var(--aw-bg2); }
.aw-run--live { border-color: color-mix(in srgb, var(--aw-warn) 60%, transparent); }
.aw-run--failed { border-left: 3px solid var(--aw-bad); }
.aw-run--ok { border-left: 3px solid var(--aw-ok); }
.aw-run__summary { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--aw-fs-sm); }
.aw-steps { list-style: none; margin: 6px 0 2px; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; border: 1px solid var(--aw-border); border-radius: 6px; background: var(--aw-bg); font-size: 12px; }
.aw-steps li { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
.aw-steps time { flex: none; color: var(--aw-text2); font-family: var(--aw-mono); font-size: var(--aw-fs-xs); }
.aw-steps span { min-width: 0; overflow-wrap: anywhere; }
.aw-step--tool span { font-family: var(--aw-mono); font-size: var(--aw-fs-xs); }
.aw-step--node span { color: var(--aw-text2); }
.aw-step--error span { color: var(--aw-bad); }
.aw-step__mark { flex: none; width: 1em; text-align: center; color: var(--aw-text2); }
.aw-run footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; font-size: 12px; }
.aw-diff, .aw-log { font-family: var(--aw-mono); font-size: var(--aw-fs-xs); line-height: 1.5; white-space: pre; overflow: auto; max-height: 65vh; background: var(--aw-bg2); border: 1px solid var(--aw-border); border-radius: 6px; padding: 10px; margin: 0; }
.aw-log { max-height: 220px; margin-top: 10px; }
.aw-composer { position: sticky; bottom: 0; border: 1px solid var(--aw-border2); border-radius: var(--aw-r-lg); background: var(--aw-bg); padding: 10px; box-shadow: 0 -6px 16px var(--aw-bg); }
.aw-composer.is-note { border-style: dashed; border-color: var(--aw-warn); }
.aw-composer__head, .aw-composer__foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.aw-composer__head { margin-bottom: 8px; }
.aw-composer__foot { margin-top: 8px; }
.aw-composer textarea { border: 0; padding: 4px 2px; background: none; outline: none !important; }
.aw-details { border-left: 1px solid var(--aw-border); background: var(--aw-bg2); padding: 16px; overflow-y: auto; position: sticky; top: 0; height: 100cqh; align-self: start; }
.aw-details select, .aw-details input { width: 100%; }
.aw-site { display: flex; flex-direction: column; gap: 6px; padding: 10px 0 14px; margin-bottom: 4px; border-bottom: 1px solid var(--aw-border); }
.aw-site p { margin: 0; }
.aw-site__links { display: flex; gap: 14px; font-weight: 600; }
.aw-details .aw-ticket__actions { flex-direction: column; align-items: stretch; gap: 6px; padding-bottom: 14px; margin-bottom: 4px; }
.aw-details .aw-ticket__actions > button { width: 100%; justify-content: center; }
.aw-details .aw-ticket__actions > :first-child { align-self: flex-start; }
.aw-details .aw-ticket__actions > .aw-running, .aw-details .aw-ticket__actions > .aw-muted { justify-content: center; text-align: center; }
/* The same fields as a full page (a tab of their own): no column furniture,
   a readable measure, and the moves in a row instead of a stack. */
.aw-details--page { border-left: 0; background: none; padding: 0; position: static; height: auto; overflow: visible; }
.aw-details--page .aw-ticket__actions { flex-direction: row; flex-wrap: wrap; align-items: center; }
.aw-details--page .aw-ticket__actions > button { width: auto; }
.aw-details--page .aw-field { max-width: 520px; }
.aw-details__h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--aw-text2); margin: 18px 0 6px !important; }
.aw-cost { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px 0; border-top: 1px solid var(--aw-border); border-bottom: 1px solid var(--aw-border); }
.aw-cost > div { display: flex; flex-direction: column; gap: 2px; }
.aw-cost strong { font-size: 15px; }
.aw-cost small { font-size: 11px; }
.aw-cost .aw-link { grid-column: 1 / -1; text-align: left; font-size: 12px; }
.aw-runlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.aw-runlist li { display: flex; align-items: center; gap: 6px; }
.aw-predict { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; margin: 0 0 14px; color: var(--aw-text2); }
.aw-predict .aw-dot { margin-top: 4px; }
.aw-predict--bad { color: var(--aw-bad); }

/* fleet + directory */
.aw-nodes { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }
.aw-node { border: 1px solid var(--aw-border); border-radius: var(--aw-r-lg); padding: 12px 14px; background: var(--aw-bg); }
.aw-node--bad { border-left: 3px solid var(--aw-bad); } .aw-node--warn { border-left: 3px solid var(--aw-warn); } .aw-node--ok { border-left: 3px solid var(--aw-ok); }
.aw-node > header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.aw-node h3 { font-size: 15px; font-weight: 700; }
.aw-kv { display: grid; grid-template-columns: 80px 1fr; gap: 5px 10px; margin: 0 0 8px; font-size: 12px; }
.aw-kv dt { color: var(--aw-text2); }
.aw-kv dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.aw-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; }
.aw-cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.aw-panel { border: 1px solid var(--aw-border); border-radius: var(--aw-r-lg); padding: var(--aw-sp-4); background: var(--aw-bg); margin-bottom: 12px; }
.aw-panel > header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aw-panel > h3 { font-size: var(--aw-fs-md); margin-bottom: 12px; }
.aw-panel p { margin: 6px 0; }
.aw-settings { max-width: 900px; }

/* this machine as a worker: the header pill, then the panel's own bits */
.aw-mpillbar { display: inline-flex; align-items: center; gap: 2px; margin-left: 6px; }
.aw-mpill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border: 1px solid var(--aw-border2); border-radius: var(--aw-r-pill); background: var(--aw-bg); color: var(--aw-text2); font-size: 12px; white-space: nowrap; cursor: pointer; }
.aw-mpill:hover { background: var(--aw-hover); color: var(--aw-text); }
.aw-mpillbar .aw-btn--ghost { height: 24px; width: 26px; padding: 0; justify-content: center; }
.aw-mstate { margin: 0 0 8px; font-size: var(--aw-fs-sm); }
.aw-mexes { display: flex; flex-direction: column; gap: 2px; }
.aw-mexe { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--aw-fs-sm); cursor: pointer; }
.aw-mexe .aw-tag { font-size: 11px; }
.aw-mexe__name { font-weight: 600; }
.aw-mlog { margin-top: 8px; }
.aw-mlog summary { cursor: pointer; color: var(--aw-text2); font-size: 12px; }
.aw-mlog[open] summary { margin-bottom: 4px; }
.aw-machine p > .aw-btn { margin-left: 8px; }
/* Settings → This machine's tools (MCP servers and skills fleet agents read). */
.aw-toolbox__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.aw-toolbox__head p { margin: 0; }
.aw-toolbox__warnings { list-style: none; margin: 4px 0 8px; padding: 0; display: grid; gap: 2px; font-size: 12px; }
.aw-toolbox__section { border-top: 1px solid var(--aw-border); margin-top: 10px; padding-top: 10px; }
.aw-toolbox__section > h4 { font-size: 13px; font-weight: 700; margin: 0 0 6px; }
.aw-toolbox__subhead { font-size: 12px; font-weight: 600; color: var(--aw-text2); margin: 10px 0 4px; }
.aw-toolbox__rows, .aw-toolbox__skills, .aw-toolbox__plugins { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.aw-toolbox__row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--aw-border); border-radius: 8px; background: var(--aw-bg2); }
.aw-toolbox__row.is-off { opacity: .72; }
.aw-toolbox__main { min-width: 0; }
.aw-toolbox__title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.aw-toolbox__meta { color: var(--aw-text2); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-toolbox__actions { display: flex; gap: 4px; }
.aw-toolbox__skills > li, .aw-toolbox__plugin { padding: 6px 8px; border: 1px solid var(--aw-border); border-radius: 8px; background: var(--aw-bg2); }
.aw-toolbox__plugin { display: flex; align-items: center; gap: 6px; }
.aw-toolbox__skilldesc { margin: 2px 0 0; color: var(--aw-text2); font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }


/* overlays */
.aw-scrim { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,.35); display: grid; place-items: center; padding: 20px; }
.aw-scrim--top { place-items: start center; padding-top: 12vh; }
.aw-modal { width: min(520px, 100%); max-height: 88%; display: flex; flex-direction: column; background: var(--aw-bg); color: var(--aw-text); border: 1px solid var(--aw-border2); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.aw-modal--wide { width: min(760px, 100%); }
.aw-modal--full { width: 96%; height: 92%; max-height: 92%; }
.aw-modal--full .aw-modal__body { flex: 1; min-height: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.aw-review { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.aw-review > * { flex: 1; min-height: 0; }
.aw-modal__head { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px 6px; }
.aw-modal__head > div { flex: 1; }
.aw-modal__head h2 { font-size: 16px; font-weight: 700; }
.aw-modal__head p { margin: 4px 0 0; color: var(--aw-text2); }
.aw-modal__body { padding: 10px 18px; overflow-y: auto; }
.aw-modal__foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid var(--aw-border); flex-wrap: wrap; }
.aw-modal__foot .aw-predict { margin: 0 auto 0 0; }
.aw-palette { width: min(620px, 100%); background: var(--aw-bg); border: 1px solid var(--aw-border2); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.3); overflow: hidden; }
.aw-palette input { width: 100%; border: 0 !important; border-bottom: 1px solid var(--aw-border) !important; border-radius: 0 !important; padding: 14px 16px !important; font-size: 15px !important; outline: none !important; }
.aw-palette ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
.aw-palette li { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.aw-palette li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-palette li small { color: var(--aw-text2); white-space: nowrap; }
.aw-palette li.is-active { background: var(--aw-hover); }
.aw-toast { position: absolute; z-index: 30; right: 16px; bottom: 38px; max-width: 420px; padding: 10px 14px; border-radius: 8px; background: var(--aw-text); color: var(--aw-bg); box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.aw-toast.is-error { background: var(--aw-bad); color: #fff; }

/* pane resize handles */
.aw-resize { position: absolute; top: 0; bottom: 0; width: 9px; cursor: col-resize; z-index: 8; touch-action: none; }
.aw-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; }
.aw-resize:hover::after, .aw-resize.is-drag::after { background: var(--aw-accent); }
.aw-resize--explorer { bottom: 22px; left: calc(48px + var(--aw-explorer-w, 260px) - 5px); }
.aw-resize--details { right: calc(var(--aw-details-w, 300px) - 5px); }

@media (max-width: 900px) {
  .aw-explorer { display: none; }
  .aw-resize { display: none; }
  .aw-ticket { grid-template-columns: 1fr; }
  .aw-details { border-left: 0; border-top: 1px solid var(--aw-border); position: static; height: auto; }
}

/* ————— The details panel: sections, and what you can act on ————— */

/* One block per concern, separated by a rule, so the eye can find "where do I
   change the agent" without reading every label. */
.aw-details > .aw-field,
.aw-details > .aw-cost,
.aw-details > .aw-runlist,
.aw-details > .aw-site,
.aw-details > .aw-predict,
.aw-details > .aw-details__h {
  border-top: 1px solid var(--aw-border);
  padding-top: 14px;
  margin-top: 14px;
}

.aw-details__h {
  font-size: var(--aw-fs-xs);
  letter-spacing: .1em;
  color: var(--aw-text2);
  margin-bottom: 8px !important;
}

/* Labels read as labels, not as another line of body text. */
.aw-details .aw-field__label {
  font-size: var(--aw-fs-xs);
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--aw-text3, var(--aw-text2));
  opacity: .85;
  margin-bottom: 2px;
}

/* Chips and segments: the chosen one is tinted, the rest stay quiet. */
.aw-details .aw-seg { width: 100%; }
.aw-details .aw-seg button { flex: 1; padding: 5px 6px; }
.aw-details .aw-seg button:is([aria-pressed="true"], [aria-checked="true"]) {
  background: color-mix(in srgb, var(--aw-accent) 18%, var(--aw-bg3));
  color: var(--aw-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--aw-accent) 55%, transparent);
}
.aw-details .aw-chips button[aria-pressed="true"] {
  border-color: var(--aw-accent);
  color: var(--aw-text);
  background: color-mix(in srgb, var(--aw-accent) 14%, transparent);
}

/* The money block: three figures on one card, the one that is billed in accent. */
.aw-details .aw-cost {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--aw-border);
  border-radius: 8px;
  background: var(--aw-bg);
}
.aw-details .aw-cost > div { display: flex; flex-direction: column; gap: 2px; }
.aw-details .aw-cost strong { font-size: 16px; font-variant-numeric: tabular-nums; }
.aw-details .aw-cost > div:last-child strong { color: var(--aw-accent); }

/* Runs: one line each, separated, with the node and cost quiet. */
.aw-details .aw-runlist { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; }
.aw-details .aw-runlist > li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-top: 1px dashed var(--aw-border);
  font-size: 12px;
}
.aw-details .aw-runlist > li:first-child { border-top: 0; }

/* Status and the "why nothing can take this" note get their own weight. */
.aw-details .aw-predict { font-size: 12px; line-height: 1.45; }

/* Health: one row per end-to-end check, red only when something is wrong. */
.aw-health { max-width: 1000px; }
.aw-health__intro { margin: 0 0 14px; }
.aw-health__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.aw-health__row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--aw-border); border-radius: var(--aw-r-lg); background: var(--aw-bg); }
.aw-health__row--bad { border-color: color-mix(in srgb, var(--aw-bad) 45%, var(--aw-border)); }
.aw-health__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.aw-health__body strong { font-size: 13px; }
.aw-health__body span { font-size: 12px; }
.aw-health__meta { display: flex; align-items: center; gap: 8px; white-space: nowrap; }

/* Pre-review: one screen instead of the diff. */
.aw-prereview { margin: 12px 0 0; padding: 10px 12px; border: 1px solid var(--aw-border); border-left: 3px solid var(--aw-border2); border-radius: 8px; background: var(--aw-bg); }
.aw-prereview--ok { border-left-color: var(--aw-ok); }
.aw-prereview--warn { border-left-color: var(--aw-warn); }
.aw-prereview--bad { border-left-color: var(--aw-bad); }
.aw-prereview header, .aw-prereview footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aw-prereview__headline { margin: 8px 0 4px; font-size: var(--aw-fs-lg); }
.aw-prereview ul { margin: 4px 0 8px; padding-left: 20px; font-size: 13px; }
.aw-prereview footer { margin-top: 6px; }

/* Recorded evidence: one summary row; the run and compare controls open on demand. */
.aw-evidence { padding: 8px 12px; }
.aw-evidence header { align-items: baseline; }
.aw-evidence__line { font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-evidence__toggle { flex: none; font-size: 12px; }
.aw-evidence__body { margin-top: 8px; }
.aw-evidence__hint { margin: 0 0 8px; font-size: 12px; }
.aw-md { margin: 6px 0 8px; overflow-wrap: anywhere; }
.aw-md p { margin: 0 0 6px; }
.aw-md p:last-child, .aw-md ul:last-child, .aw-md ol:last-child, .aw-md pre:last-child { margin-bottom: 0; }
.aw-md__heading { margin: 10px 0 4px; font-size: 13px; }
.aw-md ul, .aw-md ol { margin: 4px 0 8px; padding-left: 20px; font-size: var(--aw-fs-sm); }
.aw-md li { margin: 2px 0; }
.aw-md code { font-family: var(--aw-mono); font-size: var(--aw-fs-xs); background: var(--aw-bg2); border: 1px solid var(--aw-border); border-radius: 4px; padding: 0 4px; overflow-wrap: anywhere; }
.aw-md__code { margin: 4px 0 8px; max-height: 32vh; }

/* Before/after preview shots: evidence, not decoration. */
.aw-shots { display: flex; gap: 8px; margin-top: 10px; }
.aw-shots figure { flex: 1; min-width: 0; margin: 0; }
.aw-shots img { display: block; width: 100%; height: auto; border: 1px solid var(--aw-border); border-radius: 6px; background: var(--aw-bg2); }
.aw-shots figcaption { margin-top: 3px; font-size: 11px; color: var(--aw-text3); text-transform: uppercase; letter-spacing: .04em; }

/* SEO: small inline charts, wide tables that scroll, drafts that stay readable. */
.aw-seo-chart { margin: 8px 0 4px; }
.aw-seo-chart svg { display: block; width: 100%; height: auto; max-height: 190px; }
.aw-seo-chart__legend { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--aw-text2); }
.aw-seo-chart__dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.aw-seo-pages td.aw-seo-types, .aw-seo-citations td { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.aw-seo-path { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.aw-seo-ranks td { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.aw-seo-ranks__url { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-seo-citations textarea { min-width: 240px; }
.aw-seo-citations input { min-width: 200px; }
.aw-seo-issues { display: grid; gap: 4px; padding: 2px 0; }
.aw-seo-issue { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.aw-seo-issue span:last-child { color: var(--aw-text2); }

/* ProjectWorld — compact isometric map ported from client portal; works in dark & light themes. */
.aw-world-wrap { container-type: inline-size; min-width: 0; }
.aw-project__world { padding: 16px 0 20px; }
.aw-world {
  --aw-w-ink: var(--aw-text, var(--dsw-alias-label-primary, currentColor));
  --aw-w-ink-soft: var(--aw-text2, var(--dsw-alias-label-secondary, rgba(128,134,142,.92)));
  --aw-w-surface: var(--aw-bg, rgba(128,134,142,.06));
  --aw-w-stage: var(--aw-bg2, rgba(128,134,142,.09));
  --aw-w-chip: rgba(128,134,142,.16);
  --aw-w-rule: var(--aw-border, rgba(128,134,142,.24));
  --aw-w-rule-strong: var(--aw-border2, rgba(128,134,142,.38));
  --aw-w-accent: var(--aw-accent, #ff5a1f);
  --aw-w-ok: var(--aw-ok, #2f9e5b);
  --aw-w-warn: var(--aw-warn, #d99a16);
  --aw-w-bad: var(--aw-bad, #d6453d);
  --aw-w-hover: var(--aw-hover, rgba(128,134,142,.14));
  --aw-w-tint: color-mix(in srgb, var(--aw-w-accent) 14%, transparent);
  --aw-w-mono: var(--aw-mono, ui-monospace, 'SF Mono', Menlo, monospace);

  --aw-w-face-top: color-mix(in srgb, var(--aw-w-surface) 90%, var(--aw-w-ink) 10%);
  --aw-w-face-left: color-mix(in srgb, var(--aw-w-surface) 78%, var(--aw-w-ink) 22%);
  --aw-w-face-right: color-mix(in srgb, var(--aw-w-surface) 64%, var(--aw-w-ink) 36%);

  --aw-w-accent-top: color-mix(in srgb, var(--aw-w-accent) 22%, var(--aw-w-surface));
  --aw-w-accent-left: color-mix(in srgb, var(--aw-w-accent) 36%, var(--aw-w-surface));
  --aw-w-accent-right: color-mix(in srgb, var(--aw-w-accent) 50%, var(--aw-w-surface));

  --aw-w-ok-soft: color-mix(in srgb, var(--aw-w-ok) 22%, var(--aw-w-surface));
  --aw-w-bad-soft: color-mix(in srgb, var(--aw-w-bad) 22%, var(--aw-w-surface));
  --aw-w-warn-soft: color-mix(in srgb, var(--aw-w-warn) 24%, var(--aw-w-surface));

  margin: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(240px, 1fr);
  gap: 12px;
  align-items: stretch;
  padding: 10px;
  border-radius: var(--aw-r-lg);
  border: 1px solid var(--aw-w-rule);
  background: var(--aw-w-stage);
  color: var(--aw-w-ink);
}
@media (prefers-color-scheme: dark) {
  .aw-world, .aw-world__journeys {
    --aw-w-face-top: color-mix(in srgb, var(--aw-w-surface) 74%, var(--aw-w-ink) 26%);
    --aw-w-face-left: color-mix(in srgb, var(--aw-w-surface) 84%, var(--aw-w-ink) 16%);
    --aw-w-face-right: color-mix(in srgb, var(--aw-w-surface) 92%, var(--aw-w-ink) 8%);
  }
}
:root[data-theme='dark'] .aw-world, :root[data-theme='dark'] .aw-world__journeys {
  --aw-w-face-top: color-mix(in srgb, var(--aw-w-surface) 74%, var(--aw-w-ink) 26%);
  --aw-w-face-left: color-mix(in srgb, var(--aw-w-surface) 84%, var(--aw-w-ink) 16%);
  --aw-w-face-right: color-mix(in srgb, var(--aw-w-surface) 92%, var(--aw-w-ink) 8%);
}
.aw-world__stage {
  position: relative;
  border-radius: 8px;
  background: var(--aw-w-surface);
  border: 1px solid var(--aw-w-rule);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 4px;
}
.aw-world__svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 260px;
  user-select: none;
  -webkit-user-select: none;
}
.aw-world__floor-plate { fill: color-mix(in srgb, var(--aw-w-stage) 65%, var(--aw-w-surface)); stroke: var(--aw-w-rule-strong); stroke-width: 1; }
.aw-world__dot { fill: color-mix(in srgb, var(--aw-w-ink) 20%, transparent); }
.aw-world__dot--active { fill: var(--aw-w-accent); opacity: .72; }
.aw-world__zone-label { font: 600 9px/1 var(--aw-w-mono); letter-spacing: .12em; text-transform: uppercase; fill: var(--aw-w-ink-soft); opacity: .78; }

.aw-world__cable-base { fill: none; stroke: var(--aw-w-rule-strong); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.aw-world__cable-base.is-connected { stroke: color-mix(in srgb, var(--aw-w-ink) 45%, transparent); }
.aw-world__cable-flow { fill: none; stroke: var(--aw-w-accent); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 5 7; animation: aw-world-dash-flow 1.35s linear infinite; }
.aw-world__cable-arrow { fill: var(--aw-w-ink-soft); }
.aw-world__cable-arrow.is-active { fill: var(--aw-w-accent); }
@keyframes aw-world-dash-flow { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }

.aw-world__station { cursor: pointer; outline: none; }
.aw-world__hit { fill: transparent; stroke: none; }
.aw-world__pad { fill: color-mix(in srgb, var(--aw-w-surface) 80%, var(--aw-w-stage)); stroke: var(--aw-w-rule-strong); stroke-width: 1; transition: fill 150ms ease, stroke 150ms ease; }
.aw-world__station.is-active .aw-world__pad { fill: color-mix(in srgb, var(--aw-w-accent) 12%, var(--aw-w-surface)); stroke: color-mix(in srgb, var(--aw-w-accent) 55%, var(--aw-w-ink)); }
.aw-world__station.is-warn .aw-world__pad { fill: color-mix(in srgb, var(--aw-w-warn) 12%, var(--aw-w-surface)); stroke: color-mix(in srgb, var(--aw-w-warn) 60%, var(--aw-w-ink)); }
.aw-world__station.is-selected .aw-world__pad,
.aw-world__station:hover .aw-world__pad { fill: var(--aw-w-tint); stroke: var(--aw-w-accent); stroke-width: 1.5; }
.aw-world__station:focus-visible .aw-world__pad { stroke: var(--aw-w-accent); stroke-width: 2.2; }

.aw-world__face-top { fill: var(--aw-w-face-top); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.aw-world__face-left { fill: var(--aw-w-face-left); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.aw-world__face-right { fill: var(--aw-w-face-right); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round; }
.aw-world__face-accent-top { fill: var(--aw-w-accent-top); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-accent-left { fill: var(--aw-w-accent-left); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-accent-right { fill: var(--aw-w-accent-right); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-ok { fill: var(--aw-w-ok-soft); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-bad { fill: var(--aw-w-bad-soft); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__face-warn { fill: var(--aw-w-warn-soft); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__ink-line { fill: none; stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.aw-world__detail-line { fill: none; stroke: color-mix(in srgb, var(--aw-w-ink) 55%, transparent); stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; }
.aw-world__window { fill: color-mix(in srgb, var(--aw-w-ink) 14%, var(--aw-w-surface)); stroke: var(--aw-w-ink); stroke-width: 1.1; stroke-linejoin: round; }
.aw-world__window--lit { fill: var(--aw-w-accent-left); }
.aw-world__window--ok { fill: var(--aw-w-ok-soft); }

.aw-world__cloche-rim-back { fill: none; stroke: color-mix(in srgb, var(--aw-w-ink) 32%, transparent); stroke-width: 1; stroke-dasharray: 2.5 2; }
.aw-world__cloche-glass { fill: rgba(128,134,142,.18); stroke: var(--aw-w-ink); stroke-width: 1.3; stroke-linejoin: round; }
.aw-world__cloche-glass--active { fill: color-mix(in srgb, var(--aw-w-accent) 18%, transparent); }
.aw-world__cloche-glass--warn { fill: color-mix(in srgb, var(--aw-w-warn) 18%, transparent); }
.aw-world__cloche-shine { fill: none; stroke: color-mix(in srgb, var(--aw-w-ink) 32%, transparent); stroke-width: 1.8; stroke-linecap: round; }

.aw-world__station.is-unknown .aw-world__face-top,
.aw-world__station.is-unknown .aw-world__face-left,
.aw-world__station.is-unknown .aw-world__face-right,
.aw-world__station.is-unknown .aw-world__ink-line { stroke-dasharray: 3.5 2.5; stroke: var(--aw-w-ink-soft); fill-opacity: .55; }
.aw-world__station.is-off .aw-world__object { opacity: .66; }
.aw-world__station.is-off:hover .aw-world__object,
.aw-world__station.is-off.is-selected .aw-world__object,
.aw-world__station.is-off:focus-visible .aw-world__object { opacity: .92; }

.aw-world__beacon { stroke: var(--aw-w-ink); stroke-width: 1.2; }
.aw-world__beacon--ok { fill: var(--aw-w-ok); }
.aw-world__beacon--active { fill: var(--aw-w-accent); }
.aw-world__beacon--warn { fill: var(--aw-w-warn); }
.aw-world__beacon--bad { fill: var(--aw-w-bad); }
.aw-world__beacon--off,
.aw-world__beacon--unknown { fill: var(--aw-w-stage); }
.aw-world__badge-bg { fill: var(--aw-w-accent); stroke: var(--aw-w-ink); stroke-width: 1.2; }
.aw-world__badge-text { font: 700 10px/1 var(--aw-w-mono); fill: #fff; text-anchor: middle; dominant-baseline: central; }

.aw-world__tag-bg { fill: var(--aw-w-chip); stroke: var(--aw-w-rule-strong); stroke-width: 1; }
.aw-world__station.is-selected .aw-world__tag-bg,
.aw-world__station:hover .aw-world__tag-bg { stroke: var(--aw-w-accent); }
.aw-world__tag-text { font: 600 10px/1 inherit; fill: var(--aw-w-ink); text-anchor: middle; dominant-baseline: central; }
.aw-world__micro { font: 500 9px/1 var(--aw-w-mono); fill: var(--aw-w-ink-soft); text-anchor: middle; }

.aw-world__caption { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.aw-world__eyebrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; font: 600 10px/1.2 var(--aw-w-mono); text-transform: uppercase; letter-spacing: .09em; color: var(--aw-w-ink-soft); }
.aw-world__project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
.aw-world__card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; background: var(--aw-w-surface); border: 1px solid var(--aw-w-rule); flex: 1; }
.aw-world__card-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.aw-world__pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 1.3; border: 1px solid var(--aw-w-rule-strong); background: var(--aw-w-chip); color: var(--aw-w-ink-soft); }
.aw-world__pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--aw-w-ink-soft); flex: none; }
.aw-world__pill--ok { border-color: color-mix(in srgb, var(--aw-w-ok) 45%, transparent); background: color-mix(in srgb, var(--aw-w-ok) 14%, transparent); color: var(--aw-w-ok); }
.aw-world__pill--ok .aw-world__pill-dot { background: var(--aw-w-ok); }
.aw-world__pill--active { border-color: color-mix(in srgb, var(--aw-w-accent) 45%, transparent); background: var(--aw-w-tint); color: var(--aw-w-accent); }
.aw-world__pill--active .aw-world__pill-dot { background: var(--aw-w-accent); }
.aw-world__pill--warn { border-color: color-mix(in srgb, var(--aw-w-warn) 45%, transparent); background: color-mix(in srgb, var(--aw-w-warn) 14%, transparent); color: var(--aw-w-warn); }
.aw-world__pill--warn .aw-world__pill-dot { background: var(--aw-w-warn); }
.aw-world__pill--bad { border-color: color-mix(in srgb, var(--aw-w-bad) 45%, transparent); background: color-mix(in srgb, var(--aw-w-bad) 14%, transparent); color: var(--aw-w-bad); }
.aw-world__pill--bad .aw-world__pill-dot { background: var(--aw-w-bad); }
.aw-world__pill--unknown { border-style: dashed; }

.aw-world .aw-world__title { margin: 0; font-size: var(--aw-fs-lg); font-weight: 700; line-height: 1.25; letter-spacing: -.01em; color: var(--aw-w-ink); }
.aw-world .aw-world__explain { margin: 0; font-size: 12px; line-height: 1.4; color: var(--aw-w-ink-soft); max-width: none; }
.aw-world__status-box { margin-top: auto; padding-top: 7px; border-top: 1px dashed var(--aw-w-rule-strong); display: flex; flex-direction: column; gap: 2px; }
.aw-world__status-label { font: 600 9.5px/1.2 var(--aw-w-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--aw-w-ink-soft); }
.aw-world .aw-world__status-value { margin: 0; font-size: var(--aw-fs-sm); font-weight: 600; line-height: 1.35; color: var(--aw-w-ink); word-break: break-word; max-width: none; }

.aw-world__ops { padding-top: 7px; border-top: 1px dashed var(--aw-w-rule-strong); display: flex; flex-direction: column; gap: 4px; }
.aw-world__op-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.aw-world__op-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 6px; border: 1px solid var(--aw-w-rule); background: var(--aw-w-chip); color: var(--aw-w-ink-soft); font-size: 11px; line-height: 1.3; font-variant-numeric: tabular-nums; }
.aw-world__op-chip strong { color: var(--aw-w-ink); font-weight: 650; }
.aw-world__op-chip--warn { border-color: color-mix(in srgb, var(--aw-w-warn) 45%, transparent); background: color-mix(in srgb, var(--aw-w-warn) 14%, transparent); color: var(--aw-w-warn); }
.aw-world__op-chip--warn strong { color: var(--aw-w-warn); }
.aw-world__op-chip--bad { border-color: color-mix(in srgb, var(--aw-w-bad) 45%, transparent); background: color-mix(in srgb, var(--aw-w-bad) 14%, transparent); color: var(--aw-w-bad); }
.aw-world__op-chip--bad strong { color: var(--aw-w-bad); }

.aw-world__checks { padding-top: 7px; border-top: 1px dashed var(--aw-w-rule-strong); display: flex; flex-direction: column; gap: 5px; }
.aw-world__check-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.aw-world__check-item { display: flex; align-items: flex-start; gap: 7px; padding: 5px 7px; border-radius: 6px; border: 1px solid var(--aw-w-rule); background: var(--aw-w-chip); font-size: var(--aw-fs-xs); line-height: 1.35; }
.aw-world__check-item.is-pending { border-color: color-mix(in srgb, var(--aw-w-warn) 45%, transparent); background: color-mix(in srgb, var(--aw-w-warn) 10%, transparent); }
.aw-world__check-item.is-ready { border-color: color-mix(in srgb, var(--aw-w-ok) 35%, transparent); background: color-mix(in srgb, var(--aw-w-ok) 9%, transparent); }
.aw-world__check-mark { flex: none; width: 15px; height: 15px; margin-top: 1px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font: 700 10px/1 var(--aw-w-mono); color: var(--aw-w-ink-soft); background: var(--aw-w-chip); }
.aw-world__check-item.is-pending .aw-world__check-mark { color: var(--aw-w-warn); background: color-mix(in srgb, var(--aw-w-warn) 18%, transparent); }
.aw-world__check-item.is-ready .aw-world__check-mark { color: var(--aw-w-ok); background: color-mix(in srgb, var(--aw-w-ok) 18%, transparent); }
.aw-world__check-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
.aw-world__check-label { font-weight: 600; color: var(--aw-w-ink); }
.aw-world .aw-world__check-detail { margin: 0; font-size: var(--aw-fs-xs); line-height: 1.35; color: var(--aw-w-ink-soft); word-break: break-word; max-width: none; }
.aw-world__check-meta { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 1px; font: 500 var(--aw-fs-xs)/1.25 var(--aw-w-mono); color: var(--aw-w-ink-soft); }
.aw-world__check-who { color: var(--aw-w-ink); }

.aw-world__nav { display: flex; flex-wrap: wrap; gap: 4px; }
.aw-world__journeys {
  --aw-w-ink: var(--aw-text, var(--dsw-alias-label-primary, currentColor));
  --aw-w-ink-soft: var(--aw-text2, var(--dsw-alias-label-secondary, rgba(128,134,142,.92)));
  --aw-w-surface: var(--aw-bg, rgba(128,134,142,.06));
  --aw-w-stage: var(--aw-bg2, rgba(128,134,142,.09));
  --aw-w-chip: rgba(128,134,142,.16);
  --aw-w-rule: var(--aw-border, rgba(128,134,142,.24));
  --aw-w-rule-strong: var(--aw-border2, rgba(128,134,142,.38));
  --aw-w-accent: var(--aw-accent, #ff5a1f);
  --aw-w-ok: var(--aw-ok, #2f9e5b);
  --aw-w-warn: var(--aw-warn, #d99a16);
  --aw-w-bad: var(--aw-bad, #d6453d);
  --aw-w-hover: var(--aw-hover, rgba(128,134,142,.14));
  --aw-w-tint: color-mix(in srgb, var(--aw-w-accent) 14%, transparent);
  --aw-w-mono: var(--aw-mono, ui-monospace, 'SF Mono', Menlo, monospace);
  --aw-w-face-top: color-mix(in srgb, var(--aw-w-surface) 90%, var(--aw-w-ink) 10%);
  --aw-w-face-left: color-mix(in srgb, var(--aw-w-surface) 78%, var(--aw-w-ink) 22%);
  --aw-w-face-right: color-mix(in srgb, var(--aw-w-surface) 64%, var(--aw-w-ink) 36%);
  --aw-w-accent-top: color-mix(in srgb, var(--aw-w-accent) 22%, var(--aw-w-surface));
  --aw-w-accent-left: color-mix(in srgb, var(--aw-w-accent) 36%, var(--aw-w-surface));
  --aw-w-accent-right: color-mix(in srgb, var(--aw-w-accent) 50%, var(--aw-w-surface));
  --aw-w-ok-soft: color-mix(in srgb, var(--aw-w-ok) 22%, var(--aw-w-surface));
  --aw-w-bad-soft: color-mix(in srgb, var(--aw-w-bad) 22%, var(--aw-w-surface));
  --aw-w-warn-soft: color-mix(in srgb, var(--aw-w-warn) 24%, var(--aw-w-surface));
}
.aw-world__journeys { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 6px; }
.aw-world__drift { margin: 0 0 6px; font-size: 12px; }
.aw-world__drift-toggle { appearance: none; display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--aw-warn, #d99a16) 45%, transparent); background: color-mix(in srgb, var(--aw-warn, #d99a16) 12%, transparent); color: var(--aw-text, inherit); font: inherit; cursor: pointer; }
.aw-world__drift-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--aw-warn, #d99a16); }
.aw-world__drift-list { list-style: none; margin: 4px 0 0; padding: 0 0 0 4px; display: grid; gap: 2px; }
.aw-world__drift-list li { display: flex; align-items: baseline; gap: 8px; }
.aw-world__drift-item { appearance: none; border: 0; background: none; padding: 0; color: var(--aw-text, inherit); font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
span.aw-world__drift-item { cursor: default; color: var(--aw-text2, inherit); }
button.aw-world__drift-item:hover { text-decoration: underline; }
.aw-world__drift-age { flex: 0 0 auto; color: var(--aw-warn, #d99a16); font-variant-numeric: tabular-nums; }
.aw-world__journey-pill { appearance: none; display: inline-flex; align-items: center; gap: 5px; max-width: 220px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--aw-w-rule); background: var(--aw-w-chip); color: var(--aw-w-ink-soft); font: inherit; font-size: 11px; line-height: 1.4; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aw-world__journey-pill[aria-pressed="true"] { border-color: color-mix(in srgb, var(--aw-w-accent) 60%, var(--aw-w-rule)); background: var(--aw-w-tint); color: var(--aw-w-ink); }
.aw-world__journey-pill.is-all { border-style: dashed; }
.aw-world__journey-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--aw-w-ink-soft); flex: 0 0 auto; }
.aw-world__journey-pill.is-in_progress .aw-world__journey-dot, .aw-world__journey-pill.is-review .aw-world__journey-dot { background: var(--aw-w-accent); }
.aw-world__journey-pill.is-done .aw-world__journey-dot { background: var(--aw-w-ok, #2f9e5b); }
.aw-world__journey { margin: 0 0 8px; padding: 8px 10px; border-radius: 8px; background: var(--aw-w-tint); }
.aw-world__journey-sentence { margin: 2px 0 6px; font-size: 13px; line-height: 1.4; color: var(--aw-w-ink); }
.aw-world__journey-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--aw-w-accent) 55%, var(--aw-w-rule)); color: var(--aw-w-ink); font-size: 11px; text-decoration: none; }
.aw-world__station.is-journey-ahead { opacity: .35; }
.aw-world__station.is-journey-current .aw-world__pad { fill: color-mix(in srgb, var(--aw-w-accent) 22%, var(--aw-w-surface)); stroke: var(--aw-w-accent); stroke-width: 1.6; }
@media (prefers-reduced-motion: no-preference) { .aw-world__station.is-journey-current .aw-world__pad { animation: aw-world-journey-pulse 2.4s ease-in-out infinite; } }
@keyframes aw-world-journey-pulse { 50% { stroke-opacity: .45; } }
.aw-world__chip { appearance: none; display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border-radius: 6px; border: 1px solid var(--aw-w-rule); background: var(--aw-w-chip); color: var(--aw-w-ink-soft); font-size: 11px; font-weight: 500; line-height: 1.25; cursor: pointer; transition: border-color 120ms ease, background 120ms ease, color 120ms ease; }
.aw-world__chip:hover { background: var(--aw-w-hover); color: var(--aw-w-ink); }
.aw-world__chip[aria-pressed='true'] { border-color: var(--aw-w-accent); background: var(--aw-w-tint); color: var(--aw-w-ink); font-weight: 600; }
.aw-world__chip:focus-visible { outline: 2px solid var(--aw-w-accent); outline-offset: 1px; }
.aw-world__chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--aw-w-rule-strong); flex: none; }
.aw-world__chip-dot--ok { background: var(--aw-w-ok); }
.aw-world__chip-dot--active { background: var(--aw-w-accent); }
.aw-world__chip-dot--warn { background: var(--aw-w-warn); }
.aw-world__chip-dot--bad { background: var(--aw-w-bad); }
.aw-world__chip-dot--unknown { background: transparent; border: 1px dashed var(--aw-w-ink-soft); }

.aw-sr-only, .aw-world__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 720px) {
  .aw-world { grid-template-columns: minmax(0, 1fr); }
}
@container (max-width: 720px) {
  .aw-world { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  .aw-world__cable-flow { animation: none; }
  .aw-world__pad, .aw-world__chip { transition: none; }
}

/* Marketing desk: the autopilot rows, the needs list, the day chart, regrouped settings. */
.aw-hero--mk { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.aw-hero--mk h2 { flex: none; }
.aw-mk-state { display: inline-flex; align-items: center; gap: 7px; color: var(--aw-text2); font-size: 13px; }
.aw-mk-state .aw-dot { width: 9px; height: 9px; }
.aw-table--compact td, .aw-table--compact th { padding-top: 7px; padding-bottom: 7px; }
.aw-table--static tbody tr, .aw-table--static th { cursor: default; }
.aw-table--static tbody tr:hover { background: transparent; }
.aw-table, .aw-mk-meter__num, .aw-chart__tick, .aw-chart__day, .aw-needs, .aw-mk-kinds { font-variant-numeric: tabular-nums; }
.aw-mk-health { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 250px; }
.aw-mk-health .aw-mk-meter { margin: 0; }
.aw-mk-meter { display: inline-flex; align-items: center; gap: 8px; margin: 2px 14px 2px 0; white-space: nowrap; }
.aw-mk-meter__label { color: var(--aw-text2); font-size: 12px; min-width: 62px; }
.aw-mk-meter__track { position: relative; width: 72px; height: 5px; background: var(--aw-bg3); border-radius: var(--aw-r-sm); flex: none; }
.aw-mk-meter__fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: var(--aw-r-sm); background: var(--aw-ok); }
.aw-mk-meter__fill--warn { background: var(--aw-warn); }
.aw-mk-meter__fill--bad { background: var(--aw-bad); }
.aw-mk-meter__limit { position: absolute; top: -2px; bottom: -2px; left: 80%; width: 1px; background: var(--aw-text2); opacity: .55; }
.aw-mk-meter__num { color: var(--aw-text2); font-size: 12px; }
.aw-mk-bad { color: var(--aw-bad); }
.aw-mk-kinds-label { margin: 12px 0 2px; }
.aw-mk-kinds { display: flex; flex-wrap: wrap; gap: 3px 16px; margin: 0; font-size: 12px; }
.aw-mk-kind { display: flex; gap: 5px; }
.aw-mk-kind dt { color: var(--aw-text2); }
.aw-mk-kind dd { margin: 0; font-weight: 600; }
.aw-needs { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.aw-needs li { display: flex; align-items: center; gap: 12px; padding: 7px 0; border-top: 1px solid var(--aw-border); }
.aw-needs li:first-child { border-top: 0; }
.aw-needs li > span { flex: 1; min-width: 0; }
.aw-needs .aw-btn { flex: none; }
.aw-chart { margin: 0; }
.aw-chart__totals { margin: 0 0 8px; color: var(--aw-text2); font-size: 12px; }
.aw-chart__svg { display: block; }
.aw-chart__grid { stroke: var(--aw-border); stroke-width: 1; }
.aw-chart__axis { stroke: var(--aw-border2); stroke-width: 1; }
.aw-chart__tick, .aw-chart__day { fill: var(--aw-text2); font-size: 10px; }
.aw-chart__bar { fill: var(--aw-bg3); }
.aw-chart__bounce { fill: var(--aw-bad); }
.aw-chart__reply { fill: var(--aw-ok); }
.aw-chart__post { fill: var(--aw-violet); }
.aw-form2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
@media (max-width: 720px) {
  .aw-form2 { grid-template-columns: 1fr; }
  .aw-table--stack thead { display: none; }
  .aw-table--stack, .aw-table--stack tbody, .aw-table--stack tr, .aw-table--stack td { display: block; width: 100%; }
  .aw-table--stack tr { padding: 8px 4px; border-top: 1px solid var(--aw-border); }
  .aw-table--stack tbody tr:first-child { border-top: 0; }
  .aw-table--stack td { padding: 3px 8px; border-bottom: 0; white-space: normal; }
  .aw-table--stack td::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 1px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--aw-text2);
  }
  .aw-table--stack td:first-child { font-weight: 600; }
  .aw-table--stack td:first-child::before { content: none; }
  .aw-table--stack .aw-mk-meter { display: flex; margin: 2px 0; }
}
.aw-mk-window input { flex: none; width: 58px; min-width: 0; }
.aw-mk-window input[aria-label="Window offset minutes"] { width: 72px; }
.aw-divider { border: 0; border-top: 1px solid var(--aw-border); margin: 18px 0 4px; }

/* Project solutions: kinds of work, the fleet note, and the client's connections. */
.aw-dot--muted { background: var(--aw-border2); }
.aw-psol { margin: 2px 0; }
.aw-psol__h { margin: 12px 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--aw-text2); }
.aw-psol__h:first-child { margin-top: 0; }
.aw-psol__fleet { margin: 6px 0 0; font-size: 12px; color: var(--aw-text2); }
.aw-psol__fleet--warn { color: color-mix(in srgb, var(--aw-warn) 80%, var(--aw-text)); font-weight: 600; }
.aw-psol__rows { list-style: none; margin: 0; padding: 0; }
.aw-psol__row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--aw-border); }
.aw-psol__row:first-child { border-top: 0; }
.aw-psol__rowmain { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aw-psol__miss { font-family: var(--aw-mono); font-size: 11px; color: var(--aw-text2); }
.aw-psol__err { font-size: 12px; color: var(--aw-bad); }
.aw-psol__rowact { flex: none; display: flex; align-items: center; gap: 6px; }
.aw-psol__brief { margin-top: 12px; }
.aw-psol__brief > summary { cursor: pointer; color: var(--aw-text2); font-size: 12px; }
.aw-psol__brief[open] > summary { margin-bottom: 4px; }
.aw-psol__briefitem { padding: 6px 0; border-top: 1px solid var(--aw-border); font-size: 12px; }
.aw-psol__briefitem ul { margin: 2px 0 8px; padding-left: 18px; color: var(--aw-text2); }
.aw-psol__tags { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.aw-psol__steps { margin: 0 0 10px; padding-left: 20px; }
.aw-psol__steps li { margin: 3px 0; font-size: 12px; color: var(--aw-text2); }

/* ————— Shared primitives (ui.jsx): one shape each, for every view ————— */
.aw-emptybox { padding: var(--aw-sp-6); display: flex; flex-direction: column; align-items: center; gap: var(--aw-sp-2); text-align: center; color: var(--aw-text2); }
.aw-emptybox strong { font-size: var(--aw-fs-md); font-weight: 600; }
.aw-emptybox__hint { font-size: var(--aw-fs-sm); max-width: 52ch; }
.aw-emptybox__action { margin-top: var(--aw-sp-2); }
.aw-loading { display: flex; align-items: center; justify-content: center; gap: var(--aw-sp-2); padding: var(--aw-sp-6) var(--aw-sp-4); color: var(--aw-text2); font-size: var(--aw-fs-sm); }
.aw-loading::before { content: ''; flex: none; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--aw-border2); border-top-color: var(--aw-accent); animation: aw-spin .7s linear infinite; }
@keyframes aw-spin { to { transform: rotate(1turn); } }
@media (prefers-reduced-motion: reduce) { .aw-loading::before { animation: none; } }
.aw-errornote { display: flex; align-items: center; gap: var(--aw-sp-3); flex-wrap: wrap; padding: 10px 12px; border-radius: var(--aw-r-lg); margin: 10px 0; background: color-mix(in srgb, var(--aw-bad) 10%, transparent); color: var(--aw-bad); font-size: var(--aw-fs-sm); }
.aw-errornote__text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.aw-panel__head { display: flex; align-items: center; gap: var(--aw-sp-3); flex-wrap: wrap; margin-bottom: var(--aw-sp-3); }
.aw-panel__titles { flex: 1; min-width: 0; }
.aw-panel__titles h3 { font-size: var(--aw-fs-md); font-weight: 600; margin: 0; }
.aw-panel__titles p { margin: 2px 0 0; color: var(--aw-text2); font-size: var(--aw-fs-sm); }
.aw-panel__actions { display: flex; align-items: center; gap: var(--aw-sp-1); flex: none; }
.aw-statrow { display: flex; flex-wrap: wrap; gap: var(--aw-sp-3); font-variant-numeric: tabular-nums; }
.aw-statrow__item { display: flex; flex-direction: column; gap: 1px; min-width: 64px; padding: var(--aw-sp-2) var(--aw-sp-4); border: 1px solid var(--aw-border); border-radius: var(--aw-r-md); background: var(--aw-bg); }
.aw-statrow__item strong { font-size: var(--aw-fs-lg); font-weight: 600; }
.aw-statrow__item small { font-size: var(--aw-fs-xs); color: var(--aw-text2); }
.aw-statrow__item--ok strong { color: var(--aw-ok); }
.aw-statrow__item--warn strong { color: color-mix(in srgb, var(--aw-warn) 70%, var(--aw-text)); }
.aw-statrow__item--bad strong { color: var(--aw-bad); }
.aw-statrow__item--info strong { color: var(--aw-info); }
.aw-statrow__item--accent strong { color: var(--aw-accent); }
.aw-tag--pill { height: 18px; padding: 0 6px; border-radius: var(--aw-r-pill); }
/* shell */
.aw-tablist { display: flex; flex: 1; align-items: stretch; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.aw-tablist::-webkit-scrollbar { display: none; }
.aw-tabs__toggle { flex: none; height: 100%; padding: 0 9px; border: 0; border-right: 1px solid var(--aw-border); border-radius: 0; color: var(--aw-text2); }
.aw-tabs__toggle:hover:not(:disabled) { background: var(--aw-hover); color: var(--aw-text); }
.aw-tab:focus-visible { outline: 2px solid var(--aw-accent); outline-offset: -2px; }
.aw-tab__close:focus-visible { outline: 2px solid var(--aw-accent); outline-offset: -1px; }
.aw-topbanner { position: absolute; z-index: 5; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: color-mix(in srgb, var(--aw-bad) 12%, var(--aw-bg)); border-bottom: 1px solid color-mix(in srgb, var(--aw-bad) 45%, var(--aw-border)); color: var(--aw-text); font-size: 12px; }
.aw-topbanner > span { flex: 1; min-width: 0; }
.aw-loading--fill { position: absolute; inset: 0; padding: 0; }
.aw-toast { display: flex; align-items: flex-start; gap: 10px; }
.aw-toast__close { flex: none; border: 0; background: none; color: inherit; cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; opacity: .75; }
.aw-toast__close:hover { opacity: 1; }
.aw-palette__count { margin: 2px 12px 8px; color: var(--aw-text2); font-size: 11px; }
.aw-drawer-scrim { position: fixed; inset: 0; z-index: 59; background: rgba(0, 0, 0, .28); }
@media (max-width: 900px) {
  .aw-explorer--drawer { display: block; position: fixed; z-index: 60; top: 0; bottom: 0; left: 0; width: min(300px, 86vw); padding-top: 8px; box-shadow: 0 0 40px rgba(0, 0, 0, .3); }
  .aw--inset .aw-explorer--drawer { padding-top: 44px; }
}
/* loop */
/* Keyboard rows: visible focus wherever a row can receive it. */
.aw-table tbody tr:focus-visible, .aw-row:focus-visible { outline: 2px solid var(--aw-accent); outline-offset: -2px; }
/* A row's title is a real link that keeps the row's ink until it is hovered. */
.aw-titlelink { color: inherit; text-decoration: none; }
.aw-titlelink:hover { text-decoration: underline; }
/* The right rail's rare controls, folded behind one summary. */
.aw-details > details.aw-details__more { border-top: 1px solid var(--aw-border); padding-top: 14px; margin-top: 14px; }
.aw-details__more > summary { cursor: pointer; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--aw-text2); }
.aw-details__more[open] > summary { margin-bottom: 8px; }
.aw-details__more .aw-field, .aw-details__more .aw-cost, .aw-details__more .aw-site { border-top: 1px solid var(--aw-border); padding-top: 14px; margin-top: 14px; }
.aw-details__more .aw-site:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
/* The composer's notify fold and its one-line delivery status. */
.aw-mentions__open { font-size: 12px; }
.aw-notified { margin-top: 2px; }
.aw-notified summary { cursor: pointer; font-size: 11px; }
.aw-notified p { margin: 2px 0; }
/* fleet */
.aw-directory { grid-template-columns: repeat(auto-fit, minmax(min(100%, 410px), 1fr)); }
.aw-directory .aw-rows > li + li { border-top: 1px solid var(--aw-border); }
.aw-directory__open { width: 100%; text-align: left; color: inherit; font: inherit; border: 0; background: transparent; }
.aw-directory__open:focus-visible { outline: 2px solid var(--aw-accent); outline-offset: -2px; }
.aw-directory__project { cursor: default; }
.aw-directory__project:hover { background: transparent; }
.aw-directory__name { display: grid; flex: 1 1 9rem; min-width: 0; overflow-wrap: anywhere; }
.aw-health--compact .aw-health__row { padding-block: 6px; }
/* marketing */
.aw-mk-header .aw-panel__head { margin-bottom: 0; }
.aw-mk-header .aw-panel__actions { flex-wrap: wrap; }
.aw-mk-header { scroll-margin-block: var(--aw-sp-4); }
.aw-mk-controls { margin-bottom: var(--aw-sp-3); }
.aw-mk-click { cursor: pointer; }
.aw-mk-row-start { align-items: flex-start; }
.aw-mk-copy { white-space: pre-wrap; font: inherit; line-height: 1.5; overflow-wrap: anywhere; }
.aw-mk-preview { padding: var(--aw-sp-4); border: 1px solid var(--aw-border); border-radius: var(--aw-r-md); margin: 0; }
.aw-mk-preview-spaced { margin-top: var(--aw-sp-4); }
.aw-mk-no-top { margin-top: 0; }
.aw-mk-subject { font-weight: 600; margin: 0 0 var(--aw-sp-3); }
.aw-mk-message-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--aw-sp-1) var(--aw-sp-4); font-size: var(--aw-fs-xs); margin: 0; }
.aw-mk-message-meta dd { margin: 0; overflow-wrap: anywhere; }
.aw-mk-figure { margin: 0 0 var(--aw-sp-4); }
.aw-mk-preview-image { display: block; height: auto; max-width: 100%; border: 1px solid var(--aw-border); border-radius: var(--aw-r-md); }
.aw-mk-entry { border-top: 1px solid var(--aw-border); padding-block: var(--aw-sp-3); }
.aw-mk-post-body { margin: var(--aw-sp-3) 0; }
.aw-mk-post-actions { align-items: baseline; flex-wrap: wrap; }
.aw-mk-more summary, .aw-mk-publisher summary { cursor: pointer; }
.aw-mk-more[open] summary { margin-bottom: var(--aw-sp-2); }
.aw-mk-sequence-tools { margin-top: var(--aw-sp-4); }
.aw-mk-settings-fields { display: grid; gap: var(--aw-sp-4); min-inline-size: 0; margin: 0; padding: 0; border: 0; }
.aw-mk-settings-footer { position: sticky; bottom: 0; z-index: 1; flex-wrap: wrap; background: var(--aw-bg2); border: 1px solid var(--aw-border); border-radius: var(--aw-r-md); padding: var(--aw-sp-3) var(--aw-sp-4); }

/* seo */
.aw-seo-head { display: flex; align-items: flex-start; gap: var(--aw-sp-3); flex-wrap: wrap; margin-bottom: var(--aw-sp-4); }
.aw-seo-head__titles { flex: 1 1 340px; min-width: 0; }
.aw-seo-head__titles h2 { margin: 0; font-size: var(--aw-fs-xl); font-weight: 700; line-height: 1.2; }
.aw-seo-head__titles p { margin: 2px 0 0; max-width: 70ch; font-size: var(--aw-fs-sm); color: var(--aw-text2); }
.aw-seo-head__runs, .aw-seo-head__actions { display: flex; align-items: center; gap: var(--aw-sp-1); flex-wrap: wrap; }
.aw-seo-head__actions { flex: none; }
.aw-seo-statrow { margin-bottom: var(--aw-sp-4); }
.aw-seo-statrow .aw-statrow__item { min-width: 56px; padding: var(--aw-sp-1) var(--aw-sp-3); }
.aw-seo-chart__dot--accent { background: var(--aw-accent); }
.aw-seo-chart__dot--warn { background: var(--aw-warn); }
.aw-seo-chart__dot--ok { background: var(--aw-ok); }
.aw-seo-note, .aw-panel p.aw-seo-note { margin: 0; }
.aw-panel p.aw-seo-answer { margin: 4px 0 0; white-space: pre-wrap; }
.aw-seo-cell--detail { white-space: normal; }
.aw-seo-cell--wide { min-width: 200px; white-space: normal; }
.aw-seo-cell--wider { min-width: 240px; }
.aw-seo-cell--url { min-width: 220px; }
.aw-seo-cell--note { min-width: 280px; white-space: normal; }
.aw-seo-cited-url { display: block; }
.aw-table tbody tr.aw-seo-row, .aw-seo-row { cursor: default; }
.aw-table tbody tr.aw-seo-row:hover { background: transparent; }
.aw-seo-guides__more { margin-top: var(--aw-sp-2); }
.aw-seo-events-form { margin-bottom: var(--aw-sp-3); }
.aw-seo-savebar { position: sticky; bottom: 0; z-index: 3; display: flex; align-items: center; gap: var(--aw-sp-2); flex-wrap: wrap; padding: var(--aw-sp-3) var(--aw-sp-4); border: 1px solid var(--aw-border2); border-radius: var(--aw-r-lg); background: var(--aw-bg); box-shadow: 0 -6px 18px color-mix(in srgb, var(--aw-text) 8%, transparent); }
.aw-seo-savebar__state { flex: 1; min-width: 160px; font-size: var(--aw-fs-sm); color: var(--aw-text2); }

/* fleet2 */
/* Fleet, clients and settings, tightened: one-line health, dense node cards,
   28px table rows, 16px section rhythm. Scoped to the views it redesigns. */
.aw-fleet .aw-hero, .aw-clients .aw-hero, .aw-client .aw-hero, .aw-settings .aw-hero { margin-bottom: var(--aw-sp-3); }
.aw-fleet .aw-hero h2, .aw-clients .aw-hero h2, .aw-client .aw-hero h2, .aw-settings .aw-hero h2 { font-size: var(--aw-fs-xl); }
.aw-fleet .aw-hero p, .aw-clients .aw-hero p, .aw-client .aw-hero p { margin: 2px 0 0; }
.aw-fleet .aw-group, .aw-clients .aw-group, .aw-client .aw-group { margin: var(--aw-sp-5) 0; }
.aw-fleet .aw-group > h3, .aw-clients .aw-group > h3, .aw-client .aw-group > h3 { font-size: var(--aw-fs-md); font-weight: 600; margin-bottom: var(--aw-sp-2); }

/* Health on Fleet: a one-line summary, then a single bordered list of 28px rows. */
.aw-health--compact { margin: 0 0 var(--aw-sp-5); }
.aw-health--compact .aw-health__summary h3 { font-size: var(--aw-fs-md); font-weight: 600; }
.aw-health__head { display: flex; align-items: center; gap: var(--aw-sp-3); }
.aw-health__list { display: block; margin: var(--aw-sp-2) 0 0; padding: 0; border: 1px solid var(--aw-border); border-radius: var(--aw-r-lg); overflow: hidden; background: var(--aw-bg); }
.aw-health__row { height: 28px; padding: 0 10px; gap: var(--aw-sp-2); border: 0; border-radius: 0; background: none; font-size: var(--aw-fs-sm); }
.aw-health__row + .aw-health__row { border-top: 1px solid var(--aw-border); }
.aw-health__row--bad { border-color: var(--aw-border); background: color-mix(in srgb, var(--aw-bad) 6%, transparent); }
.aw-health__name { flex: none; font-size: var(--aw-fs-sm); font-weight: 600; white-space: nowrap; }
.aw-health__detail { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-health__meta { flex: none; gap: var(--aw-sp-2); font-size: var(--aw-fs-xs); }
.aw-health__pass { margin-top: var(--aw-sp-2); }
.aw-health__pass > summary { cursor: pointer; padding: 2px 0; font-size: var(--aw-fs-sm); color: var(--aw-text2); }

/* Node cards: 320px grid, one-line header, three short plain-text lines. */
.aw-nodes { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--aw-sp-3); }
.aw-node { padding: 9px 12px; }
.aw-node > header { gap: 7px; margin-bottom: var(--aw-sp-2); flex-wrap: nowrap; }
.aw-node > header .aw-btn { flex: none; }
.aw-node > header .aw-btn--sm { padding: 0 7px; }
.aw-node h3 { font-size: var(--aw-fs-md); flex: none; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-node__os { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--aw-fs-sm); }
.aw-node__lines { display: grid; gap: 2px; margin-bottom: var(--aw-sp-2); }
.aw-node__lines:last-child { margin-bottom: 0; }
.aw-node__line { margin: 0; font-size: var(--aw-fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aw-node__bar { display: inline-block; width: 56px; height: 4px; margin-left: var(--aw-sp-2); vertical-align: -1px; border-radius: 2px; background: var(--aw-bg3); overflow: hidden; }
.aw-node__bar i { display: block; height: 100%; background: var(--aw-info); }
.aw-node .aw-rows .aw-row { padding: 4px 10px; flex-wrap: nowrap; gap: var(--aw-sp-2); }
.aw-node .aw-row > .aw-live, .aw-node .aw-row > .aw-mono, .aw-node .aw-row > .aw-muted { flex: none; white-space: nowrap; }
.aw-node .aw-row__title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-machine .aw-kv { margin-bottom: var(--aw-sp-2); }
.aw-machine .aw-mexes { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 2px var(--aw-sp-4); }

/* 28px table rows on the fleet and client pages. */
.aw-fleet .aw-table td, .aw-client .aw-table td, .aw-clients .aw-table td { padding: 4px 8px; }
.aw-fleet .aw-table th, .aw-client .aw-table th, .aw-clients .aw-table th { padding: 4px 8px; }
.aw-clients .aw-row { padding: 6px 10px; flex-wrap: nowrap; }
.aw-clients .aw-row > .aw-muted { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-clients .aw-row > .aw-muted:last-child { flex: none; }
.aw-clients .aw-directory__name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-client .aw-toolbar { margin-bottom: var(--aw-sp-3); }

/* Settings: tighter fields and toolbox, Save pinned to a sticky footer. */
.aw-settings .aw-field { margin-bottom: 10px; }
.aw-settings .aw-panel > h3 { margin-bottom: var(--aw-sp-3); }
.aw-settings .aw-toolbox__row, .aw-settings .aw-toolbox__skills > li, .aw-settings .aw-toolbox__plugin { padding: 4px 8px; }
.aw-settings .aw-toolbox__section { margin-top: var(--aw-sp-3); padding-top: var(--aw-sp-3); }
.aw-settings__foot { position: sticky; bottom: 0; display: flex; align-items: center; gap: var(--aw-sp-3); margin: var(--aw-sp-5) -20px -40px; padding: var(--aw-sp-3) 20px; background: var(--aw-bg); border-top: 1px solid var(--aw-border); }
/* loop2 */
/* The ticket rail: one status pill at the top, fields 12px apart and no
   rule between every one of them; labels stay small and quiet. */
.aw-details > .aw-field { border-top: 0; padding-top: 0; margin-top: 0; margin-bottom: var(--aw-sp-4); }
.aw-details > .aw-predict { border-top: 0; padding-top: 0; margin-top: 0; margin-bottom: var(--aw-sp-4); }
.aw-details .aw-field { gap: var(--aw-sp-1); }
.aw-details .aw-field__hint { font-size: var(--aw-fs-xs); line-height: 1.4; }
.aw-details__pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--aw-sp-3); margin-bottom: var(--aw-sp-4); }
.aw-details__pair > .aw-field { margin-bottom: 0; }
.aw-details__pair select { font-size: var(--aw-fs-sm); padding-inline: var(--aw-sp-2); }
/* Priority: full-width, equal columns (the Agent choice is a select now). */
.aw-details .aw-seg { display: flex; width: 100%; }
.aw-details .aw-seg button { flex: 1 1 0; padding-inline: var(--aw-sp-1); }
/* A primary button that cannot be pressed reads as disabled, not as a faded brand. */
.aw-btn--primary:disabled { background: var(--aw-bg3); border-color: var(--aw-border); color: var(--aw-text2) !important; opacity: 1; }
/* The composer starts at three rows and the script grows it up to twelve. */
.aw-composer textarea { min-height: calc(3 * 1.5em + 8px); resize: none; }
/* The header's mail address is a link, not a chip. */
.aw-mailto { color: inherit; text-decoration: none; }
.aw-mailto:hover { text-decoration: underline; }
/* A run's branch line is context, so it is a plain muted line, not a chip. */
.aw-run footer .aw-tag--dash { border: 0; background: none; padding-inline: 0; height: auto; color: var(--aw-text2); font-size: var(--aw-fs-xs); }
/* Inbox: one count line, a slim warn notice, the hint on the group line, and
   one fixed action column so the buttons line up down every group. */
.aw-inbox .aw-group { margin: var(--aw-sp-5) 0; }
.aw-group__hint { margin-left: var(--aw-sp-2); font-size: var(--aw-fs-sm); font-weight: 400; color: var(--aw-text2); }
.aw-inbox__offline { display: flex; align-items: center; gap: var(--aw-sp-2); margin: 0 0 var(--aw-sp-4); padding: var(--aw-sp-1) var(--aw-sp-3); border: 1px solid color-mix(in srgb, var(--aw-warn) 25%, transparent); border-radius: var(--aw-r-md); background: color-mix(in srgb, var(--aw-warn) 9%, transparent); font-size: var(--aw-fs-sm); color: var(--aw-text2); }
.aw-inbox .aw-row { gap: var(--aw-sp-3); }
.aw-inbox .aw-row .aw-btn--ghost { border-color: var(--aw-border2); }
.aw-inbox .aw-row__actions { display: flex; flex: 0 0 144px; justify-content: flex-end; gap: var(--aw-sp-1); margin-left: auto; }
.aw-inbox .aw-row__actions > .aw-btn { flex: none; }
/* New task: four fields in two columns and a shorter brief. */
.aw-taskform { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.aw-taskform .aw-field { margin-bottom: var(--aw-sp-4); }
.aw-taskform .aw-field:nth-last-child(-n + 2) { margin-bottom: 0; }
.aw-taskform + .aw-field { margin-top: var(--aw-sp-3); }

`;
