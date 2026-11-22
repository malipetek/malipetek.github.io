// Scoped to the project destination; aligned with 01-ui-contract.md tokens (with base fallbacks).
export default `
.aw-project { max-width: var(--aw-measure-table, 1180px); margin: 0 auto; width: 100%; min-width: 0; box-sizing: border-box; }
/* Allow header meta chips and slug to wrap cleanly on narrow widths without clipping glyphs. */
.aw-project .aw-pagehead__titles p { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; white-space: normal; overflow: visible; text-overflow: clip; }
/* Hosted site actions: separate and clearly mark destructive Delete site secondary button. */
.aw-project .aw-site { border-bottom: 0; padding: var(--aw-space-2, 8px) 0 var(--aw-space-3, 12px); }
.aw-project .aw-site__one > .aw-btn { margin-top: var(--aw-space-1, 4px); margin-right: var(--aw-space-2, 8px); }
.aw-project .aw-site__one > .aw-btn--ghost {
  margin-left: var(--aw-space-3, 12px);
  color: var(--aw-bad);
  border-color: color-mix(in srgb, var(--aw-bad) 45%, transparent);
}
.aw-project .aw-site__one > .aw-btn--ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--aw-bad) 10%, transparent);
}
.aw-project h3 { margin: 0 0 var(--aw-space-3, 12px); font-size: var(--aw-type-lg, 15px); line-height: 1.35; font-weight: 600; }
.aw-project h4 { margin: 0 0 var(--aw-space-2, 8px); font-size: var(--aw-type-md, 13px); font-weight: 600; }
.aw-project p { line-height: 1.55; max-width: var(--aw-measure, 72ch); margin: var(--aw-space-2, 8px) 0; }
.aw-project a { color: var(--aw-accent); text-underline-offset: 3px; overflow-wrap: anywhere; }
.aw-project button { scroll-margin-block: 80px; }
.aw-project :is(button, a, input, textarea, summary):focus-visible { outline: 2px solid var(--aw-focus, var(--aw-accent)); outline-offset: 2px; }
.aw-project :is(input, textarea) { caret-color: var(--aw-accent); }
.aw-project ::selection { background: var(--aw-accent); color: var(--aw-surface, var(--aw-bg)); }

/* Header overflow menu ("…") */
.aw-project__overflow { position: relative; display: inline-flex; }
.aw-project__overflow-btn { width: 30px; padding: 0; justify-content: center; font-size: 16px; line-height: 1; }
.aw-project__menu {
  position: absolute;
  top: calc(100% + var(--aw-space-1, 4px));
  right: 0;
  z-index: 25;
  min-width: 176px;
  padding: var(--aw-space-1, 4px);
  border-radius: var(--aw-radius-lg, var(--aw-r-lg, 8px));
  border: 1px solid var(--aw-hairline-strong, var(--aw-border2));
  background: var(--aw-surface-raised, var(--aw-bg));
  box-shadow: var(--aw-shadow-float, 0 8px 24px rgba(0, 0, 0, .18));
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.aw-project__menuitem {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--aw-radius-sm, var(--aw-r-sm, 4px));
  background: transparent;
  color: var(--aw-ink, var(--aw-text));
  font-size: var(--aw-type-sm, 12px);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}
.aw-project__menuitem:hover { background: var(--aw-hover); text-decoration: none; }
.aw-project__menuitem:disabled { opacity: .45; cursor: default; }

/* Sections: separated by hairlines and breathing room, never nested cards */
.aw-project__actions { display: flex; flex-wrap: wrap; gap: var(--aw-space-2, 8px); align-items: center; }
.aw-project__local-actions { margin-bottom: var(--aw-space-3, 12px); }
.aw-project__body { min-width: 0; }
.aw-project__section { padding: var(--aw-space-5, 24px) 0; border-bottom: 1px solid var(--aw-hairline, var(--aw-border)); min-width: 0; }
.aw-project__section:first-child { padding-top: var(--aw-space-3, 12px); }
.aw-project__section:last-child { border-bottom: 0; }
.aw-project__section > :first-child { margin-top: 0; }
.aw-project__section > :last-child { margin-bottom: 0; }
.aw-project__section .aw-row-h { margin-bottom: var(--aw-space-2, 8px); }
.aw-project__section .aw-row-h h3 { margin: 0; }

/* Brief */
.aw-project__brief { margin: var(--aw-space-2, 8px) 0 0; }
.aw-project__brief dt {
  color: var(--aw-ink-2, var(--aw-text2));
  font-size: var(--aw-type-xs, 11px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  margin: var(--aw-space-4, 16px) 0 var(--aw-space-1, 4px);
}
.aw-project__brief dt:first-child { margin-top: 0; }
.aw-project__brief dd { margin: 0; white-space: pre-wrap; line-height: 1.6; overflow-wrap: anywhere; max-width: var(--aw-measure, 72ch); }

/* Forms */
.aw-project__form { display: grid; gap: var(--aw-space-3, 12px); margin: var(--aw-space-3, 12px) 0; max-width: var(--aw-measure, 72ch); }
.aw-project__form .aw-field { margin-bottom: 0; }
.aw-project__fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); gap: var(--aw-space-4, 16px); }

/* Topology strip */
.aw-project__topology {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--aw-space-5, 24px);
  list-style: none;
  padding: var(--aw-space-1, 4px) 0;
  margin: var(--aw-space-2, 8px) 0 0;
}
.aw-project__topology > li { display: flex; align-items: flex-start; gap: var(--aw-space-3, 12px); min-width: 0; }
.aw-project__topology > li > svg { margin-top: 2px; color: var(--aw-ink-2, var(--aw-text2)); flex-shrink: 0; }
.aw-project__topology > li > div { display: flex; flex-direction: column; gap: var(--aw-space-1, 4px); min-width: 0; }
.aw-project__topology strong { font-size: var(--aw-type-sm, 12px); font-weight: 600; }
.aw-project__topology span, .aw-project__topology a { color: var(--aw-ink-2, var(--aw-text2)); font-size: var(--aw-type-sm, 12px); line-height: 1.5; overflow-wrap: anywhere; }
.aw-project__topology a { color: var(--aw-accent); }
.aw-project__destination { display: flex; flex-direction: column; gap: 2px; margin-bottom: var(--aw-space-2, 8px); }

/* Hairline lists (work, runs, deploys, secrets) */
.aw-project__work { list-style: none; padding: 0; margin: var(--aw-space-2, 8px) 0 0; font-variant-numeric: tabular-nums; }
.aw-project__work > li {
  display: flex;
  align-items: center;
  gap: var(--aw-space-3, 12px);
  min-height: var(--aw-row-h-table, 36px);
  border-bottom: 1px solid var(--aw-hairline, var(--aw-border));
  padding: var(--aw-space-2, 8px) 0;
  min-width: 0;
}
.aw-project__work > li:last-child { border-bottom: 0; }
.aw-project__work > li > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.aw-project__work > li > div:first-child { flex: 1; }
.aw-project__worklink {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: var(--aw-space-3, 12px);
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--aw-ink, var(--aw-text));
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.aw-project__worklink:hover strong { color: var(--aw-accent); }
.aw-project__worklink strong { font-size: var(--aw-type-md, 13px); font-weight: 500; overflow-wrap: anywhere; }
.aw-project__worklink > .aw-muted { margin-left: auto; font-size: var(--aw-type-xs, 11px); white-space: nowrap; }
.aw-project__run { overflow-wrap: anywhere; }

/* States & feedback */
.aw-project__error { color: var(--aw-bad); line-height: 1.5; margin-block: var(--aw-space-2, 8px); overflow-wrap: anywhere; font-size: var(--aw-type-sm, 12px); }
.aw-project__error-bar {
  display: flex;
  align-items: center;
  gap: var(--aw-space-3, 12px);
  flex-wrap: wrap;
  padding: var(--aw-space-2, 8px) var(--aw-space-3, 12px);
  border-radius: var(--aw-radius-md, var(--aw-r-md, 6px));
  background: color-mix(in srgb, var(--aw-bad) 10%, transparent);
  color: var(--aw-bad);
  font-size: var(--aw-type-sm, 12px);
  margin: var(--aw-space-2, 8px) 0;
}
.aw-project__error-bar > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.aw-project__success { color: var(--aw-ok); margin-block: var(--aw-space-2, 8px); font-size: var(--aw-type-sm, 12px); }
.aw-project__handoff { max-width: var(--aw-measure, 72ch); }

/* Shape-matched loading skeleton */
.aw-project__skel { display: grid; gap: var(--aw-space-2, 8px); padding: var(--aw-space-2, 8px) 0; }
.aw-project__skel-row {
  display: block;
  height: 16px;
  border-radius: var(--aw-radius-sm, var(--aw-r-sm, 4px));
  background: var(--aw-fill, var(--aw-bg3));
  max-width: 480px;
}
.aw-project__skel-row:nth-child(2) { max-width: 360px; opacity: .75; }
.aw-project__skel-row:nth-child(3) { max-width: 420px; opacity: .55; }

/* Disclosures & file/secret blocks */
.aw-project details { padding: var(--aw-space-2, 8px) 0; }
.aw-project summary { cursor: pointer; color: var(--aw-ink, var(--aw-text)); font-weight: 500; padding: var(--aw-space-1, 4px) 0; font-size: var(--aw-type-md, 13px); }
.aw-project__invite { display: flex; align-items: end; gap: var(--aw-space-3, 12px); margin-top: var(--aw-space-3, 12px); max-width: 560px; }
.aw-project__invite .aw-field { flex: 1; margin-bottom: 0; }
.aw-project__files { list-style: none; margin: var(--aw-space-2, 8px) 0; padding: 0; max-height: 300px; overflow: auto; border-top: 1px solid var(--aw-hairline, var(--aw-border)); }
.aw-project__files li { border-bottom: 1px solid var(--aw-hairline, var(--aw-border)); }
.aw-project__files button { display: flex; gap: var(--aw-space-2, 8px); align-items: center; width: 100%; color: var(--aw-ink, var(--aw-text)); background: none; border: 0; font: inherit; text-align: left; padding: 7px 6px; cursor: pointer; }
.aw-project__files button:hover { background: var(--aw-hover); }
.aw-project__files button:disabled { opacity: .5; cursor: wait; }
.aw-project__file, .aw-project__reveal {
  background: var(--aw-surface-sidebar, var(--aw-bg2));
  border: 1px solid var(--aw-hairline, var(--aw-border));
  border-radius: var(--aw-radius-md, var(--aw-r-md, 6px));
  padding: var(--aw-space-3, 12px);
  margin-top: var(--aw-space-3, 12px);
  min-width: 0;
}
.aw-project pre { overflow: auto; font-family: var(--aw-mono); font-size: var(--aw-type-sm, 12px); line-height: 1.55; tab-size: 2; max-height: 440px; margin: var(--aw-space-2, 8px) 0 0; }
.aw-project__reveal pre { white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; }

/* Overview health line & map wrapper */
.aw-project__health { margin: 0; font-size: var(--ui-fs-md, var(--aw-type-md, 13px)); color: var(--ui-ink, var(--aw-ink)); min-width: 0; font-variant-numeric: tabular-nums; }
.aw-project__world { margin-top: var(--ui-sp-3, var(--aw-space-3, 12px)); }

/* Sub-block separator inside Local checkout & People */
.aw-project__connect { border-top: 1px solid var(--aw-hairline, var(--aw-border)); padding-top: var(--aw-space-4, 16px); margin-top: var(--aw-space-4, 16px); }
.aw-project__connect .aw-row-h { margin-bottom: var(--aw-space-2, 8px); }
.aw-project__connect .aw-row-h h4 { margin: 0; }
.aw-project__connect .aw-seg button { font-size: var(--aw-type-sm, 12px); }
.aw-project .aw-psol__copy { font-size: var(--aw-type-sm, 12px); }

/* People table */
.aw-project__ownership { margin-top: 0; font-size: var(--aw-type-md, 13px); }
.aw-project__people { width: 100%; border-collapse: collapse; margin-top: var(--aw-space-3, 12px); font-size: var(--aw-type-md, 13px); }
.aw-project__people th {
  text-align: left;
  font-size: var(--aw-type-xs, 11px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--aw-ink-2, var(--aw-text2));
  padding: 6px 12px 6px 0;
  border-bottom: 1px solid var(--aw-hairline, var(--aw-border));
}
.aw-project__people td {
  padding: var(--aw-space-2, 8px) 12px var(--aw-space-2, 8px) 0;
  border-bottom: 1px solid var(--aw-hairline, var(--aw-border));
  vertical-align: middle;
}
.aw-project__people tr:last-child td { border-bottom: 0; }
.aw-project__peoplewho { min-width: 0; overflow-wrap: anywhere; }
.aw-project__rolecell { display: inline-flex; align-items: center; gap: var(--aw-space-1, 4px); flex-wrap: wrap; }
.aw-project__peopleact { text-align: right; white-space: nowrap; }
.aw-project__peopleact .aw-check { font-size: var(--aw-type-sm, 12px); color: var(--aw-ink-2, var(--aw-text2)); margin-right: var(--aw-space-2, 8px); }

/* Narrow layout (≤760px & 390px): zero horizontal scroll, compact rows */
@media (max-width: 760px) {
  .aw-project__section { padding: var(--aw-space-4, 16px) 0; }
  .aw-project__fields { grid-template-columns: minmax(0, 1fr); gap: var(--aw-space-3, 12px); }
  .aw-project__topology { grid-template-columns: minmax(0, 1fr); gap: var(--aw-space-4, 16px); }
  .aw-project__work > li { flex-wrap: wrap; gap: var(--aw-space-2, 8px); }
  .aw-project__worklink { flex-basis: 100%; flex-wrap: wrap; gap: 4px 8px; }
  .aw-project__worklink > .aw-muted { margin-left: 0; }
  .aw-project__invite { align-items: stretch; flex-direction: column; }
  .aw-project .aw-row-h { flex-wrap: wrap; gap: var(--aw-space-2, 8px); }
  .aw-project__people, .aw-project__people tbody, .aw-project__people tr, .aw-project__people td { display: block; width: 100%; }
  .aw-project__people thead { display: none; }
  .aw-project__people tr { padding: var(--aw-space-2, 8px) 0; border-bottom: 1px solid var(--aw-hairline, var(--aw-border)); }
  .aw-project__people tr:last-child { border-bottom: 0; }
  .aw-project__people td { border-bottom: 0; padding: 3px 0; }
  .aw-project__peopleact { text-align: left; display: flex; align-items: center; gap: var(--aw-space-2, 8px); }
}
`;
