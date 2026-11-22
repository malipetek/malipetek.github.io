/*
 * Addresses for the one Settings workspace. A section is named by a key such
 * as `settings#seo` (what `open()` receives and what the desktop host routes)
 * or by a page hash `#settings/seo` / `#settings#seo` (what the web links to).
 *
 * `openSettings(open, 'marketing')` is how a desk links into Settings: it
 * leaves the section where an already-mounted or about-to-mount SettingsView
 * picks it up, then asks the host to show Settings.
 */

export const SETTINGS_SECTION_IDS = Object.freeze(['queue', 'machine', 'portal', 'marketing', 'seo', 'account']);

/** Older or friendlier names a link may use for a section. */
const ALIASES = {
  'work-queue': 'queue',
  work: 'queue',
  tools: 'machine',
  toolbox: 'machine',
  translations: 'portal',
  about: 'account',
  'sign-in': 'account',
};

/**
 * The section a key or hash names: 'settings#seo', '#settings/seo',
 * 'settings:seo' → 'seo'. Null when it names Settings without a section, an
 * unknown section, or something else entirely.
 */
export function settingsSection(target) {
  const match = /^#?settings(?:[#/:=]([\w-]+))?\/?$/i.exec(String(target ?? '').trim());
  if (!match?.[1]) return null;
  const name = match[1].toLowerCase();
  const id = ALIASES[name] ?? name;
  return SETTINGS_SECTION_IDS.includes(id) ? id : null;
}

/** True for 'settings' and every 'settings#…' / 'settings/…' address. */
export const isSettingsKey = (key) => /^#?settings(?:[#/:=][\w-]*)?\/?$/i.test(String(key ?? '').trim());

export const settingsKey = (section) => (section ? `settings#${section}` : 'settings');
export const settingsHash = (section) => `#settings/${section}`;

const EVENT = 'aw:settings-section';
let pending = null;

/** Show Settings at `section`, through the host's `open`. */
export function openSettings(open, section) {
  pending = section ?? null;
  if (typeof window !== 'undefined' && section) {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: section }));
  }
  open?.(settingsKey(section));
}

/** The section a link asked for before Settings mounted; read once. */
export function takePendingSection() {
  const section = pending;
  pending = null;
  return section;
}

/** Call `fn(section)` whenever a link asks for a section while Settings is open. */
export function onSettingsSection(fn) {
  if (typeof window === 'undefined') return () => {};
  const listener = (event) => {
    pending = null;
    fn(event.detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
