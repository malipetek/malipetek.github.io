/*
 * The DeepSeek Harness plugin shelf.
 *
 * Two sources, on purpose:
 *
 *  1. `packages/<name>/package.json` and its README are read at BUILD time via
 *     `import.meta.glob`, so the canonical name, blurb, icons and docs can never
 *     drift from the code that gets published. Adding a plugin to `packages/`
 *     is the only step needed to make it appear here.
 *
 *  2. Version, publish date and downloads come from the npm registry at REQUEST
 *     time, cached at the edge. Nothing is published yet, so every package
 *     starts life honestly reported as unpublished rather than lying with a
 *     version copied out of the manifest.
 */
import { Marked } from 'marked';

const GITHUB_BLOB = 'https://github.com/malipetek/malipetek.github.io/blob/master';

const REGISTRY = 'https://registry.npmjs.org';
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point/last-month';

/** How long an edge-cached registry answer is trusted, in seconds. */
const REGISTRY_TTL = 3600;
/** In-isolate memo so one page view costs two subrequests, not eight. */
const MEMO_TTL_MS = 5 * 60 * 1000;

interface PkgJson {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  license?: string;
  icon?: string;
  homepage?: string;
  repository?: { type?: string; url?: string; directory?: string };
  exports?: Record<string, string>;
  files?: string[];
  dsh?: {
    bundle?: { patch?: string };
    client?: { platform?: string; immediately?: boolean; inject?: string[] };
    meta?: { title?: string; description?: string };
  };
}

/** The four plugins in the order they read best, not alphabetical order. */
const ORDER = [
  'dsh-projects-panel',
  'dsh-projects-manager',
  'dsh-ai-workspace',
  'dsh-action-cards',
];

const rank = (slug: string) => {
  const index = ORDER.indexOf(slug);
  return index === -1 ? ORDER.length : index;
};

const byDisplayOrder = (a: { slug: string }, b: { slug: string }) =>
  rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug);

// Vite resolves these at build time; the raw text never ships as a fetch.
const manifests = import.meta.glob('../../packages/*/package.json', {
  eager: true,
  import: 'default',
}) as Record<string, PkgJson>;

const readmes = import.meta.glob('../../packages/*/README.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export interface NpmState {
  /** True when the registry knows this package. */
  published: boolean;
  /** False when the registry could not be reached at all. */
  checked: boolean;
  version?: string;
  modified?: string;
  license?: string;
  unpackedSize?: number;
  downloads?: number;
}

export interface Plugin {
  slug: string;
  /** The published package name, e.g. `@malipetek/dsh-action-cards`. */
  name: string;
  /** The manifest version, which is what npm will publish next. */
  manifestVersion: string;
  title: string;
  blurb: string;
  keywords: string[];
  /** True when the package ships a browser half (`./client`). */
  hasClient: boolean;
  clientInject: string[];
  homepage?: string;
  repositoryDirectory?: string;
  install: string;
  npmUrl: string;
  repoUrl: string;
  readme: string;
  npm: NpmState;
}

interface CacheEntry {
  at: number;
  value: NpmState;
}

const memo = new Map<string, CacheEntry>();

function slugOf(name: string): string {
  return name.replace(/^@[^/]+\//, '');
}

function titleOf(slug: string): string {
  return slug
    .replace(/^dsh-/, '')
    .split('-')
    .map((part) => (part === 'ai' ? 'AI' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * A Cloudflare subrequest with an edge cache. The `cf` member is ignored by
 * Node's fetch during `astro dev`, so the same code path works locally.
 */
async function registryFetch(url: string): Promise<Response> {
  const init = {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: REGISTRY_TTL, cacheEverything: true },
  };
  return fetch(url, init as RequestInit);
}

async function fetchNpm(name: string): Promise<NpmState> {
  const cached = memo.get(name);
  if (cached && Date.now() - cached.at < MEMO_TTL_MS) return cached.value;

  const miss: NpmState = { published: false, checked: false };

  try {
    const [pkgRes, dlRes] = await Promise.all([
      registryFetch(`${REGISTRY}/${name}`),
      registryFetch(`${DOWNLOADS_API}/${name}`),
    ]);

    // A 404 is an answer: the package is not published. Anything else is a
    // failure to ask, and the page says so instead of claiming "unpublished".
    if (pkgRes.status === 404) {
      const value: NpmState = { published: false, checked: true };
      memo.set(name, { at: Date.now(), value });
      return value;
    }
    if (!pkgRes.ok) return miss;

    const doc = (await pkgRes.json()) as {
      'dist-tags'?: { latest?: string };
      time?: { modified?: string };
      license?: string;
      versions?: Record<string, { license?: string; dist?: { unpackedSize?: number } }>;
    };
    const latest = doc['dist-tags']?.latest;
    const version = latest ? doc.versions?.[latest] : undefined;

    let downloads: number | undefined;
    if (dlRes.ok) {
      const dl = (await dlRes.json()) as { downloads?: number };
      if (typeof dl.downloads === 'number') downloads = dl.downloads;
    }

    const value: NpmState = {
      published: true,
      checked: true,
      version: latest,
      modified: doc.time?.modified,
      license: version?.license ?? doc.license,
      unpackedSize: version?.dist?.unpackedSize,
      downloads,
    };
    memo.set(name, { at: Date.now(), value });
    return value;
  } catch {
    return miss;
  }
}

function fromGlob(): { pkg: PkgJson; readme: string }[] {
  const byDir = new Map<string, { pkg: PkgJson; readme: string }>();

  for (const [path, pkg] of Object.entries(manifests)) {
    const dir = path.replace(/\/package\.json$/, '');
    if (!pkg?.name) continue;
    byDir.set(dir, { pkg, readme: '' });
  }
  for (const [path, text] of Object.entries(readmes)) {
    const dir = path.replace(/\/README\.md$/, '');
    const entry = byDir.get(dir);
    if (entry) entry.readme = text;
  }

  return [...byDir.values()];
}

/** Every plugin in the workspace, enriched with whatever npm currently says. */
export async function getPlugins(): Promise<Plugin[]> {
  return build();
}

/** One plugin by its URL slug (`dsh-action-cards`), or null. */
export async function getPlugin(slug: string): Promise<Plugin | null> {
  const [plugin] = await build(slug);
  return plugin ?? null;
}

/** `only` narrows the registry work to a single package for a detail page. */
async function build(only?: string): Promise<Plugin[]> {
  const base = fromGlob().filter(({ pkg }) => !only || slugOf(pkg.name) === only);

  const plugins = await Promise.all(
    base.map(async ({ pkg, readme }): Promise<Plugin> => {
      const slug = slugOf(pkg.name);
      const dir = `packages/${slug}`;
      return {
        slug,
        name: pkg.name,
        manifestVersion: pkg.version,
        title: pkg.dsh?.meta?.title ?? titleOf(slug),
        blurb: pkg.dsh?.meta?.description ?? pkg.description ?? '',
        keywords: pkg.keywords ?? [],
        hasClient: Boolean(pkg.dsh?.client) || Boolean(pkg.exports?.['./client']),
        clientInject: pkg.dsh?.client?.inject ?? [],
        homepage: pkg.homepage,
        repositoryDirectory: pkg.repository?.directory ?? dir,
        install: `dsh plugin add ${pkg.name}`,
        npmUrl: `https://www.npmjs.com/package/${pkg.name}`,
        repoUrl: `${GITHUB_BLOB}/${pkg.repository?.directory ?? dir}`,
        readme,
        npm: await fetchNpm(pkg.name),
      };
    }),
  );

  return plugins.sort(byDisplayOrder);
}

/**
 * Manifest-only view, for a page that must not touch the network.
 *
 * The homepage uses this: a front page should never wait on npm to render, and
 * the version numbers it would gain are one click away.
 */
export function getPluginSummaries(): Pick<
  Plugin,
  'slug' | 'name' | 'title' | 'blurb' | 'hasClient' | 'install'
>[] {
  return fromGlob()
    .map(({ pkg }) => {
      const slug = slugOf(pkg.name);
      return {
        slug,
        name: pkg.name,
        title: pkg.dsh?.meta?.title ?? titleOf(slug),
        blurb: pkg.dsh?.meta?.description ?? pkg.description ?? '',
        hasClient: Boolean(pkg.dsh?.client) || Boolean(pkg.exports?.['./client']),
        install: `dsh plugin add ${pkg.name}`,
      };
    })
    .sort(byDisplayOrder);
}

/** `1.2 MB`, `812 kB`, `940 B` — tarball sizes read better than raw bytes. */
export function fmtBytes(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || bytes <= 0) return null;
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function fmtDay(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtCount(n: number | undefined): string | null {
  if (typeof n !== 'number') return null;
  return n.toLocaleString('en-GB');
}

/* ————— README rendering ————— */

function slugifyHeading(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    // marked escapes quotes and dashes in inline text; they must not survive
    // into an id ("metadata &quot;smarter&quot" -> "metadata-smarter").
    .replace(/&[a-z]+;|&#\d+;/gi, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * READMEs are written for a GitHub checkout, so a few links need translating
 * before they mean anything on the web:
 *   `../dsh-other`        -> the sibling's page in this section
 *   `dev-smoke.mjs`       -> the file in the repo, on GitHub
 *   `#some-heading`       -> left alone; headings below get matching ids
 */
function rewriteHref(href: string, slug: string): string {
  if (/^(https?:|mailto:|#)/.test(href)) return href;

  const sibling = href.match(/^\.\.\/(dsh-[a-z0-9-]+)(?:\/.*)?$/);
  if (sibling) return `/plugins/${sibling[1]}`;

  const relative = href.replace(/^\.\//, '');
  return `${GITHUB_BLOB}/packages/${slug}/${relative}`;
}

/**
 * The README, rendered for the page body. Raw HTML is dropped, as in the KB.
 *
 * A leading `# @malipetek/dsh-…` title is dropped too: the page already shows
 * the plugin name above it, so keeping it would just say the same thing twice.
 */
export function renderReadme(source: string, slug: string): string {
  const body = source.replace(/^\s*#\s+[^\n]*\n/, '');
  const seen = new Map<string, number>();
  const markdown = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      html: () => '',
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const base = slugifyHeading(text) || 'section';
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const url = rewriteHref(href, slug);
        // In-repo docs open in a new tab: they leave the site.
        const external = url.startsWith('http');
        const attrs = [
          `href="${url}"`,
          title ? `title="${title}"` : '',
          external ? 'rel="noreferrer"' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<a ${attrs}>${text}</a>`;
      },
    },
  });

  try {
    return markdown.parse(body ?? '', { async: false }) as string;
  } catch {
    return '<p>Could not render this README.</p>';
  }
}
