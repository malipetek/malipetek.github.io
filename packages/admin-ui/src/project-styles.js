// Scoped to the project destination; uses the incumbent web/native workbench tokens.
export default `
.aw-project { max-width: 1440px; margin: 0 auto; width: 100%; min-width: 0; box-sizing: border-box; }
.aw-project h2 { margin: 0 0 5px; font-size: 24px; line-height: 1.25; letter-spacing: -.025em; }
.aw-project h3 { margin: 0 0 14px; font-size: 15px; line-height: 1.4; font-weight: 650; }
.aw-project p { line-height: 1.6; max-width: 75ch; }
.aw-project a { color: var(--aw-accent); text-underline-offset: 3px; overflow-wrap: anywhere; }
.aw-project button { scroll-margin-block: 80px; }
.aw-project :is(button, a, input, textarea, summary):focus-visible { outline: 2px solid var(--aw-accent); outline-offset: 3px; }
.aw-project :is(input, textarea) { caret-color: var(--aw-accent); }
.aw-project ::selection { background: var(--aw-accent); color: var(--aw-bg); }
.aw-project__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding: 6px 0 22px; }
.aw-project__header > div { min-width: 0; }
.aw-project__header h2 { overflow-wrap: anywhere; }
.aw-project__header p { margin: 0; }
.aw-project__actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.aw-project__tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--aw-border); overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--aw-border2) var(--aw-bg); }
.aw-project__tabs button { appearance: none; flex: 0 0 auto; background: none; border: 0; color: var(--aw-text2); font: inherit; padding: 13px 0; border-bottom: 2px solid transparent; cursor: pointer; }
.aw-project__tabs button:hover { color: var(--aw-text); }
.aw-project__tabs button[aria-current] { color: var(--aw-accent); border-bottom-color: var(--aw-accent); }
.aw-project__body { min-width: 0; }
.aw-project__section { padding: 28px 0; border-bottom: 1px solid var(--aw-border); min-width: 0; }
.aw-project__section > :first-child { margin-top: 0; }
.aw-project__section > :last-child { margin-bottom: 0; }
.aw-project__overview { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(250px, 1fr); gap: 42px; }
.aw-project__overview > section { border-bottom: 0; }
.aw-project__brief { margin: 8px 0 0; }
.aw-project__brief dt { color: var(--aw-text2); font-size: 11px; font-weight: 600; margin: 22px 0 6px; }
.aw-project__brief dt:first-child { margin-top: 0; }
.aw-project__brief dd { margin: 0; white-space: pre-wrap; line-height: 1.65; overflow-wrap: anywhere; max-width: 72ch; }
.aw-project__form { display: grid; gap: 14px; margin: 14px 0; max-width: 760px; }
.aw-project__fields { display: grid; grid-template-columns: 1fr 1.5fr; gap: 16px; }
.aw-project__topology { display: grid; grid-template-columns: 1fr 1.1fr 1.2fr; gap: 26px; list-style: none; padding: 0; margin: 16px 0 22px; }
.aw-project__topology > li { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.aw-project__topology > li > svg { margin-top: 2px; color: var(--aw-text2); flex-shrink: 0; }
.aw-project__topology > li > div { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.aw-project__topology strong { font-size: 12px; }
.aw-project__topology span, .aw-project__topology a { color: var(--aw-text2); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.aw-project__topology a { color: var(--aw-accent); }
.aw-project__destination { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.aw-project__work { list-style: none; padding: 0; margin: 12px 0 20px; }
.aw-project__work > li { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--aw-border); padding: 13px 0; min-width: 0; }
.aw-project__work > li:last-child { border-bottom: 0; }
.aw-project__work > li > div { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.aw-project__work > li > div:first-child { flex: 1; }
.aw-project__worklink { flex: 1; display: flex; align-items: baseline; gap: 10px; border: 0; padding: 0; background: transparent; color: var(--aw-text); font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.aw-project__worklink:hover strong { color: var(--aw-accent); }
.aw-project__worklink strong { font-weight: 500; overflow-wrap: anywhere; }
.aw-project__worklink > .aw-muted { margin-left: auto; font-size: 11px; white-space: nowrap; }
.aw-project__run { overflow-wrap: anywhere; }
.aw-project__note { margin-top: 22px; font-size: 12px; }
.aw-project__error { color: var(--aw-bad); line-height: 1.6; margin-block: 12px; overflow-wrap: anywhere; }
.aw-project__success { color: var(--aw-ok); margin-block: 12px; }
.aw-project__empty { color: var(--aw-text2); padding: 20px 0; }
.aw-project__subheading { margin-top: 32px !important; }
.aw-project__handoff { max-width: 75ch; }
.aw-project details { padding: 12px 0; }
.aw-project summary { cursor: pointer; color: var(--aw-text); font-weight: 500; padding: 5px 0; }
.aw-project__invite { display: flex; align-items: end; gap: 12px; margin-top: 18px; max-width: 650px; }
.aw-project__invite .aw-field { flex: 1; }
.aw-project__files { list-style: none; margin: 12px 0; padding: 0; max-height: 320px; overflow: auto; }
.aw-project__files button { display: flex; gap: 8px; align-items: center; width: 100%; color: var(--aw-text); background: none; border: 0; font: inherit; text-align: left; padding: 7px 5px; cursor: pointer; }
.aw-project__files button:hover { background: var(--aw-bg3); }
.aw-project__files button:disabled { opacity: .5; cursor: wait; }
.aw-project__file, .aw-project__reveal { background: var(--aw-bg2); padding: 14px; margin-top: 12px; min-width: 0; }
.aw-project pre { overflow: auto; font-family: var(--aw-mono); font-size: 12px; line-height: 1.6; tab-size: 2; max-height: 480px; }
.aw-project__reveal pre { white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; }
@media (max-width: 760px) {
  .aw-project__header { flex-direction: column; gap: 14px; }
  .aw-project__overview, .aw-project__fields { grid-template-columns: minmax(0,1fr); gap: 0; }
  .aw-project__topology { grid-template-columns: minmax(0,1fr); gap: 22px; }
  .aw-project__tabs { gap: 20px; }
  .aw-project__overview > section { border-bottom: 1px solid var(--aw-border); }
  .aw-project__work > li { flex-wrap: wrap; }
  .aw-project__worklink { flex-basis: calc(100% - 100px); flex-wrap: wrap; gap: 6px 10px; }
  .aw-project__worklink > .aw-muted { margin-left: 0; }
  .aw-project__invite { align-items: stretch; flex-direction: column; }
  .aw-project .aw-row-h { flex-wrap: wrap; gap: 8px; }
}
`;
