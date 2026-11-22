/*
 * The one token set for PTech Admin v2 (docs/admin-ui-refresh/06-design-system.md §7.1).
 *
 * Every colour follows the host first: the DSH desktop app's `--dsw-alias-*`
 * tokens when they are defined, then a light or dark fallback chosen by
 * `prefers-color-scheme` or an explicit `data-theme` on an ancestor.
 *
 * Rules (enforced by scripts/ui-conformance.mjs):
 * - This is the only file under packages/admin-ui/src that may hold raw hex.
 * - No `--aw-*` names, no aliases, no `!important`.
 * - `--ui-fb-*` are private fallbacks; read the public `--ui-*` names only.
 *
 * Tokens are declared on `.ui` (the v2 root that Shell renders) and on `.aw`
 * (the legacy root) so a v2 primitive mounted inside a legacy view resolves
 * them. Declaring new custom properties changes nothing that is painted today.
 */

/** Type scale in px. 11 is the floor everywhere, SVG text included. */
export const TYPE = Object.freeze({ xs: 11, sm: 12, md: 13, lg: 15, xl: 18 });
/** 4px grid. Index n is `--ui-sp-n`. */
export const SPACE = Object.freeze([0, 4, 8, 12, 16, 24, 32]);
export const RADII = Object.freeze({ sm: 4, md: 6, lg: 8 });
export const MOTION = Object.freeze({ dur: '120ms', ease: 'cubic-bezier(.2, 0, 0, 1)' });
/** Fixed geometry from 06 §7.1, in px. */
export const SIZE = Object.freeze({
  bar: 38, // ObjectBar / ContextBar
  filter: 36, // FilterBar
  row: 34, // DataTable row
  subnav: 32,
  sideRow: 28,
  control: 28, // Button md
  controlSm: 24, // Button sm
  status: 24, // StatusBar
  sidebar: 220,
  formMax: 720, // form controls never stretch past this
  stackBelow: 720, // DataTable stacks rows at or below this container width
  inspector: 380,
  inspectorMin: 300,
  inspectorMax: 560,
});

const LIGHT = {
  bg: '#FFFFFF',
  'bg-subtle': '#F6F6F4',
  'bg-raised': '#FFFFFF',
  border: 'rgba(22, 20, 15, .10)',
  'border-strong': 'rgba(22, 20, 15, .18)',
  ink: '#16140F',
  'ink-2': '#5D5850',
  'ink-3': '#8A847A',
  ok: '#2F9E5B',
  warn: '#D99A16',
  bad: '#D6453D',
  info: '#3B7BD9',
  shadow: '0 0 0 1px rgba(22, 20, 15, .08), 0 12px 32px rgba(0, 0, 0, .16)',
};
const DARK = {
  bg: '#141416',
  'bg-subtle': '#1A1A1D',
  'bg-raised': '#222226',
  border: 'rgba(255, 255, 255, .09)',
  'border-strong': 'rgba(255, 255, 255, .16)',
  ink: '#F2F2F3',
  'ink-2': '#A1A1AA',
  'ink-3': '#71717A',
  ok: '#3FB36D',
  warn: '#E5A82A',
  bad: '#E5534B',
  info: '#4C8DF0',
  shadow: '0 0 0 1px rgba(255, 255, 255, .08), 0 12px 32px rgba(0, 0, 0, .48)',
};
export const PALETTE = Object.freeze({ light: Object.freeze({ ...LIGHT }), dark: Object.freeze({ ...DARK }) });
export const ACCENT = '#FF5A1F';
export const ACCENT_INK = '#FFFFFF';
/**
 * Fixed colours the legacy stylesheet (styles.js) interpolates, so raw colour
 * stays in this file. Not theme tokens: like the `.aw` fallbacks they feed,
 * they do not switch with the colour scheme. The rest of those fallbacks are
 * the LIGHT values above.
 */
export const LEGACY_LITERALS = Object.freeze({
  paper: '#F7F6F3', // the site's --paper: the legacy sidebar surface fallback
  shade: '#000000', // darkening mixes and opaque mask-gradient stops
});

/** The public colour tokens and the host alias each one follows first. */
const HOST = {
  bg: ['--dsw-alias-bg-base'],
  'bg-subtle': ['--dsw-alias-bg-layer-1'],
  'bg-raised': ['--dsw-alias-bg-elevated'],
  border: ['--dsw-alias-border-l2'],
  'border-strong': ['--dsw-alias-border-l3'],
  ink: ['--dsw-alias-label-primary'],
  'ink-2': ['--dsw-alias-label-secondary'],
  'ink-3': ['--dsw-alias-label-tertiary'],
  ok: ['--dsw-alias-state-success-primary'],
  warn: ['--dsw-alias-state-warning-primary', '--dsw-alias-state-warn-primary'],
  bad: ['--dsw-alias-state-danger-primary', '--dsw-alias-state-error-primary'],
  info: ['--dsw-alias-state-business-primary'],
  shadow: [],
};

const chain = (aliases, last) => aliases.reduceRight((inner, name) => `var(${name}, ${inner})`, last);
const block = (pairs) => pairs.map(([k, v]) => `  ${k}: ${v};`).join('\n');
const fallbacks = (palette) => block(Object.entries(palette).map(([k, v]) => [`--ui-fb-${k}`, v]));

const ROOT = ':where(.ui, .aw)';

/** Every public token: name → value (CSS). Order is the order in the stylesheet. */
export const TOKENS = Object.freeze({
  ...Object.fromEntries(Object.keys(HOST).map((k) => [`--ui-${k}`, chain(HOST[k], `var(--ui-fb-${k})`)])),
  '--ui-bg-hover': chain(['--dsw-alias-interactive-bg-hover'], 'color-mix(in srgb, var(--ui-ink) 6%, transparent)'),
  '--ui-bg-selected': 'color-mix(in srgb, var(--ui-ink) 9%, transparent)',
  '--ui-accent': chain(['--dsw-alias-brand-primary'], ACCENT),
  '--ui-accent-hover': 'color-mix(in srgb, var(--ui-accent) 88%, var(--ui-ink))',
  '--ui-accent-ink': ACCENT_INK,
  '--ui-accent-wash': 'color-mix(in srgb, var(--ui-accent) 12%, transparent)',
  '--ui-focus': 'var(--ui-accent)',
  '--ui-scrim': 'rgba(0, 0, 0, .32)',
  '--ui-font': "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, system-ui, sans-serif",
  '--ui-mono': "ui-monospace, 'SF Mono', Menlo, monospace",
  ...Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [`--ui-fs-${k}`, `${v}px`])),
  '--ui-lh': '1.45',
  '--ui-lh-tight': '1.25',
  ...Object.fromEntries(SPACE.slice(1).map((v, i) => [`--ui-sp-${i + 1}`, `${v}px`])),
  ...Object.fromEntries(Object.entries(RADII).map(([k, v]) => [`--ui-r-${k}`, `${v}px`])),
  '--ui-bar-h': `${SIZE.bar}px`,
  '--ui-filter-h': `${SIZE.filter}px`,
  '--ui-row-h': `${SIZE.row}px`,
  '--ui-subnav-h': `${SIZE.subnav}px`,
  '--ui-side-row-h': `${SIZE.sideRow}px`,
  '--ui-ctl-h': `${SIZE.control}px`,
  '--ui-ctl-h-sm': `${SIZE.controlSm}px`,
  '--ui-status-h': `${SIZE.status}px`,
  '--ui-sidebar-w': `${SIZE.sidebar}px`,
  '--ui-form-max': `${SIZE.formMax}px`,
  '--ui-inspector-w': `${SIZE.inspector}px`,
  '--ui-dur': MOTION.dur,
  '--ui-ease': MOTION.ease,
});

/** Public token names, for docs and tests. */
export const TOKEN_NAMES = Object.freeze(Object.keys(TOKENS));

/** The token stylesheet: fallbacks per theme, then the public names. */
export const TOKENS_CSS = `
${ROOT} {
${fallbacks(LIGHT)}
}
@media (prefers-color-scheme: dark) {
  ${ROOT} {
${fallbacks(DARK)}
  }
}
:where([data-theme='dark']) ${ROOT}, :where(.ui, .aw)[data-theme='dark'] {
${fallbacks(DARK)}
}
:where([data-theme='light']) ${ROOT}, :where(.ui, .aw)[data-theme='light'] {
${fallbacks(LIGHT)}
}
${ROOT} {
${block(Object.entries(TOKENS))}
}
@media (prefers-reduced-motion: reduce) {
  ${ROOT} { --ui-dur: 0ms; }
}
`;
