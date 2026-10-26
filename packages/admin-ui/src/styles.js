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
  display: grid;
  grid-template-columns: 48px auto minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 26px;
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
.aw [hidden] { display: none !important; }
.aw-mono { font-family: var(--aw-mono); font-size: 12px; }
.aw-muted { color: var(--aw-text2); }
.aw-warn { color: var(--aw-bad); }
.aw-center { text-align: center; }
.aw-link { background: none; border: 0; padding: 0; color: var(--aw-accent); cursor: pointer; }
.aw-link:hover { text-decoration: underline; }
.aw-empty { padding: 40px; text-align: center; color: var(--aw-text2); }
.aw-toolbar__fill, .aw-tabs__fill, .aw-status__fill { flex: 1; }

/* activity bar */
.aw-activity { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0; background: var(--aw-bg2); border-right: 1px solid var(--aw-border); }
.aw-activity button { position: relative; width: 40px; height: 40px; display: grid; place-items: center; border: 0; background: none; border-radius: 8px; color: var(--aw-text2); cursor: pointer; }
.aw-activity button:hover { background: var(--aw-hover); color: var(--aw-text); }
.aw-activity button[aria-pressed="true"] { color: var(--aw-text); box-shadow: inset 2px 0 0 var(--aw-accent); border-radius: 0 8px 8px 0; }
.aw-activity__spacer { flex: 1; }
/* Under the macOS window buttons: start below them. */
.aw--inset .aw-activity { padding-top: 40px; }
.aw--inset .aw-explorer { padding-top: 32px; }
.aw-badge { position: absolute; top: 4px; right: 3px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--aw-accent); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; }

/* explorer */
.aw-explorer { grid-column: 2; grid-row: 1; width: 260px; overflow: auto; background: var(--aw-bg2); border-right: 1px solid var(--aw-border); padding: 6px 0 16px; }
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
.aw-count { margin-left: 6px; padding: 0 6px; border-radius: 9px; background: var(--aw-bg3); color: var(--aw-text2); font-size: 11px; font-weight: 600; }

/* main + tabs */
.aw-main { grid-column: 3; grid-row: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.aw-tabs { display: flex; align-items: stretch; height: 36px; background: var(--aw-bg2); border-bottom: 1px solid var(--aw-border); overflow-x: auto; scrollbar-width: none; }
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
.aw-btn--primary { background: var(--aw-text); color: var(--aw-bg) !important; border-color: var(--aw-text); }
.aw-btn--primary:hover:not(:disabled) { background: var(--aw-text); opacity: .88; }
.aw-btn--danger { color: var(--aw-bad) !important; border-color: color-mix(in srgb, var(--aw-bad) 50%, transparent); }
.aw-btn--ghost { border-color: transparent; background: none; }
.aw-seg { display: inline-flex; border: 1px solid var(--aw-border2); border-radius: 6px; overflow: hidden; flex-wrap: wrap; }
.aw-seg button { border: 0; background: none; padding: 4px 10px; cursor: pointer; font-size: 12px; color: var(--aw-text2); }
.aw-seg button + button { border-left: 1px solid var(--aw-border); }
.aw-seg button[aria-pressed="true"] { background: var(--aw-bg3); color: var(--aw-text); font-weight: 600; }
.aw-seg button:disabled { cursor: default; }
.aw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.aw-chips button { border: 1px dashed var(--aw-border2); background: none; border-radius: 14px; padding: 3px 10px; font-size: 12px; cursor: pointer; color: var(--aw-text2); }
.aw-chips button[aria-pressed="true"] { border-style: solid; border-color: var(--aw-text); color: var(--aw-text); background: var(--aw-bg3); }
.aw-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.aw-field__label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--aw-text2); }
.aw-field__hint { font-size: 12px; color: var(--aw-text2); }
.aw-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0 18px; }
.aw-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aw-inline input { flex: 1; min-width: 120px; }
.aw-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.aw-search { width: 200px; }

.aw-pill { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 11px; font-size: 12px; font-weight: 600; background: var(--aw-bg3); }
.aw-pill--new { background: color-mix(in srgb, var(--aw-info) 16%, transparent); color: var(--aw-info); }
.aw-pill--approved { background: color-mix(in srgb, var(--aw-violet) 16%, transparent); color: var(--aw-violet); }
.aw-pill--in_progress { background: color-mix(in srgb, var(--aw-warn) 20%, transparent); color: color-mix(in srgb, var(--aw-warn) 80%, var(--aw-text)); }
.aw-pill--review { background: color-mix(in srgb, var(--aw-accent) 16%, transparent); color: var(--aw-accent); }
.aw-pill--done { background: color-mix(in srgb, var(--aw-ok) 16%, transparent); color: var(--aw-ok); }
.aw-sq { width: 9px; height: 9px; border-radius: 3px; flex: none; background: var(--aw-text2); display: inline-block; }
.aw-sq--new { background: var(--aw-info); } .aw-sq--approved { background: var(--aw-violet); } .aw-sq--in_progress { background: var(--aw-warn); }
.aw-sq--review { background: var(--aw-accent); } .aw-sq--done { background: var(--aw-ok); } .aw-sq--declined { background: var(--aw-border2); }
.aw-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; background: var(--aw-text2); }
.aw-dot--ok { background: var(--aw-ok); } .aw-dot--warn { background: var(--aw-warn); } .aw-dot--bad { background: var(--aw-bad); }
.aw-live { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; background: var(--aw-warn); animation: aw-pulse 1.4s ease-in-out infinite; }
@keyframes aw-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--aw-warn) 60%, transparent); } 50% { box-shadow: 0 0 0 4px transparent; } }
@media (prefers-reduced-motion: reduce) { .aw-live { animation: none; } }
.aw-tag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 4px; background: var(--aw-bg3); font-size: 11px; color: var(--aw-text2); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.aw-tag--dash { background: none; border: 1px dashed var(--aw-border2); }
.aw-tag--client { background: color-mix(in srgb, var(--aw-info) 12%, transparent); color: var(--aw-info); }
.aw-tag--hot { background: color-mix(in srgb, var(--aw-accent) 15%, transparent); color: var(--aw-accent); }
.aw-tag--warn { background: color-mix(in srgb, var(--aw-warn) 18%, transparent); color: color-mix(in srgb, var(--aw-warn) 75%, var(--aw-text)); }
.aw-tag--ok { background: color-mix(in srgb, var(--aw-ok) 14%, transparent); color: var(--aw-ok); }
.aw-tag--bad { background: color-mix(in srgb, var(--aw-bad) 14%, transparent); color: var(--aw-bad); }
.aw-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.aw-running { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--aw-text2); }

/* board */
.aw-view--board { display: flex; flex-direction: column; height: 100%; padding-bottom: 0; }
.aw-board { flex: 1; min-height: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(230px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 16px; }
.aw-col { display: flex; flex-direction: column; min-height: 0; background: var(--aw-bg2); border: 1px solid var(--aw-border); border-radius: 10px; }
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
.aw-tablewrap { overflow-x: auto; }
.aw-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.aw-table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--aw-text2); padding: 6px 8px; border-bottom: 1px solid var(--aw-border2); cursor: pointer; white-space: nowrap; user-select: none; }
.aw-table td { padding: 7px 8px; border-bottom: 1px solid var(--aw-border); white-space: nowrap; }
.aw-table tbody tr { cursor: pointer; }
.aw-table tbody tr:hover { background: var(--aw-hover); }
.aw-table__title { white-space: normal !important; min-width: 220px; font-weight: 500; }

/* needs you */
.aw-inbox { max-width: 1100px; }
.aw-group { margin: 22px 0; }
.aw-group > h3 { font-size: 14px; font-weight: 700; display: flex; align-items: center; }
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

/* ticket */
.aw-ticket { display: grid; grid-template-columns: minmax(0, 1fr) 300px; min-height: 100%; }
.aw-ticket__main { padding: 18px 24px 24px; min-width: 0; display: flex; flex-direction: column; }
.aw-ticket__head h2 { font-size: 22px; font-weight: 700; margin: 4px 0 10px; line-height: 1.25; }
.aw-ticket__crumbs { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--aw-text2); }
.aw-ticket__crumbs span + span::before { content: '·'; margin-right: 10px; }
.aw-ticket__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 1px solid var(--aw-border); }
.aw-timeline { list-style: none; margin: 0; padding: 16px 0; display: flex; flex-direction: column; gap: 12px; flex: 1; }
.aw-event { display: flex; gap: 10px; font-size: 12px; color: var(--aw-text2); padding-left: 12px; border-left: 2px solid var(--aw-border); }
.aw-event time { margin-left: auto; white-space: nowrap; }
.aw-msg { border: 1px solid var(--aw-border); border-radius: 10px; padding: 10px 14px; background: var(--aw-bg); }
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
.aw-run { border: 1px solid var(--aw-border); border-radius: 10px; padding: 10px 14px; background: var(--aw-bg2); }
.aw-run--live { border-color: color-mix(in srgb, var(--aw-warn) 60%, transparent); }
.aw-run--failed { border-left: 3px solid var(--aw-bad); }
.aw-run--ok { border-left: 3px solid var(--aw-ok); }
.aw-run__summary { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; }
.aw-run footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; font-size: 12px; }
.aw-diff, .aw-log { font-family: var(--aw-mono); font-size: 11.5px; line-height: 1.5; white-space: pre; overflow: auto; max-height: 65vh; background: var(--aw-bg2); border: 1px solid var(--aw-border); border-radius: 6px; padding: 10px; margin: 0; }
.aw-log { max-height: 220px; margin-top: 10px; }
.aw-composer { position: sticky; bottom: 0; border: 1px solid var(--aw-border2); border-radius: 10px; background: var(--aw-bg); padding: 10px; box-shadow: 0 -6px 16px var(--aw-bg); }
.aw-composer.is-note { border-style: dashed; border-color: var(--aw-warn); }
.aw-composer__head, .aw-composer__foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.aw-composer__head { margin-bottom: 8px; }
.aw-composer__foot { margin-top: 8px; }
.aw-composer textarea { border: 0; padding: 4px 2px; background: none; outline: none !important; }
.aw-details { border-left: 1px solid var(--aw-border); background: var(--aw-bg2); padding: 16px; overflow-y: auto; position: sticky; top: 0; height: 100cqh; align-self: start; }
.aw-details select, .aw-details input { width: 100%; }
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
.aw-node { border: 1px solid var(--aw-border); border-radius: 10px; padding: 12px 14px; background: var(--aw-bg); }
.aw-node--bad { border-left: 3px solid var(--aw-bad); } .aw-node--warn { border-left: 3px solid var(--aw-warn); } .aw-node--ok { border-left: 3px solid var(--aw-ok); }
.aw-node > header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.aw-node h3 { font-size: 15px; font-weight: 700; }
.aw-kv { display: grid; grid-template-columns: 80px 1fr; gap: 5px 10px; margin: 0 0 8px; font-size: 12px; }
.aw-kv dt { color: var(--aw-text2); }
.aw-kv dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.aw-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; }
.aw-cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.aw-panel { border: 1px solid var(--aw-border); border-radius: 10px; padding: 12px 14px; background: var(--aw-bg); margin-bottom: 12px; }
.aw-panel > header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.aw-panel > h3 { font-size: 14px; margin-bottom: 12px; }
.aw-panel p { margin: 6px 0; }
.aw-settings { max-width: 900px; }

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

@media (max-width: 900px) {
  .aw-explorer { display: none; }
  .aw-ticket { grid-template-columns: 1fr; }
  .aw-details { border-left: 0; border-top: 1px solid var(--aw-border); position: static; height: auto; }
}
`;
