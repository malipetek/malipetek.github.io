/*
 * Interface strings: flat catalogs (src/i18n/messages/<locale>.json), English
 * the source. A string is looked up along the locale's fallback chain
 * (es-419 → es-ES → en-US), so a key missing from a translation shows in
 * English instead of as a key. scripts/i18n-sync.mjs fills the translations.
 *
 *   {name}                       a variable
 *   {n, plural, one {…} other {…}}  a count; # inside a branch is the number
 */

/** Fill a template's {variables} and {n, plural, …} blocks. */
export function format(template, vars = {}, locale = 'en-US') {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open === -1) break;
    out += template.slice(i, open);
    const close = matching(template, open);
    if (close === -1) break;
    out += field(template.slice(open + 1, close), vars, locale);
    i = close + 1;
  }
  return out + template.slice(i);
}

function matching(s, open) {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return j;
  }
  return -1;
}

function field(body, vars, locale) {
  const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(body);
  if (!plural) {
    const value = vars[body.trim()];
    return value === undefined || value === null ? `{${body}}` : String(value);
  }
  const n = Number(vars[plural[1]] ?? 0);
  const branches = {};
  const re = /\s*(=?\w+)\s*\{/g;
  let m;
  while ((m = re.exec(plural[2]))) {
    const start = m.index + m[0].length - 1;
    const end = matching(plural[2], start);
    if (end === -1) break;
    branches[m[1]] = plural[2].slice(start + 1, end);
    re.lastIndex = end + 1;
  }
  let rule = 'other';
  try {
    rule = new Intl.PluralRules(locale).select(n);
  } catch {
    /* an unknown locale counts like English */
  }
  const branch = branches[`=${n}`] ?? branches[rule] ?? branches.other ?? '';
  return format(branch.replace(/#/g, new Intl.NumberFormat(locale).format(n)), vars, locale);
}

/**
 * A t(key, vars) over catalogs in fallback order (the reader's locale first).
 * An unknown key comes back as itself, so a typo shows rather than vanishes.
 */
export function createT(catalogs, locale = 'en-US') {
  const t = (key, vars) => {
    for (const catalog of catalogs) {
      const s = catalog?.[key];
      if (typeof s === 'string') return format(s, vars, locale);
    }
    return key;
  };
  t.locale = locale;
  return t;
}
