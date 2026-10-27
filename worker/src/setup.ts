/*
 * Onboarding: an interview becomes a project, and a project says how ready it
 * is to be handed to an agent.
 *
 * Two shapes come out of this module and nothing else in the Worker derives
 * them. `cleanBrief` is the only writer of the brief JSON; `setupFor` is the
 * only place that decides what "ready" means. Both are pure, so the portal, the
 * admin views and a test can all ask the same question and get the same answer.
 *
 * The metric is deliberately conservative. A check nobody can observe yet is
 * `unknown`, never `ready` — a panel that claims a site is ready because its
 * form was filled in is worse than one that says it does not know.
 */
import { nodesView } from './queue.ts';
import { type Env } from './shared.ts';
import type { SiteView } from './sites.ts';

/** 'existing' = the client brings a site or codebase. 'new' = we create it. */
export type ProjectKind = 'existing' | 'new';
export type RepoKind = 'repo' | 'zip' | 'none';

export const PROJECT_KINDS: readonly ProjectKind[] = ['existing', 'new'];
export const REPO_KINDS: readonly RepoKind[] = ['repo', 'zip', 'none'];

const MAX_ANSWER_CHARS = 1200;
const MAX_REPO_CHARS = 300;

/** What the interview asked, in the client's own words. */
export interface Brief {
  /** What the business, the site or the system is. */
  what: string;
  /** Where the code lives: a repo, a zip they will send, or nothing yet. */
  where?: string;
  /** What they do by hand today. The interesting answer for a new project. */
  manual?: string;
  /** What they want first, or what done looks like. */
  goal: string;
}

export function isProjectKind(value: unknown): value is ProjectKind {
  return typeof value === 'string' && (PROJECT_KINDS as readonly string[]).includes(value);
}

export function isRepoKind(value: unknown): value is RepoKind {
  return typeof value === 'string' && (REPO_KINDS as readonly string[]).includes(value);
}

const answer = (value: unknown, max = MAX_ANSWER_CHARS): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
};

/**
 * Validate an interview into a brief.
 *
 * `what` and `goal` are required for both kinds: they are the two answers the
 * agent cannot work without. `where` is kept only for an existing project and
 * `manual` only for a new one, so a replayed form cannot smuggle the other
 * kind's answer into a project it does not describe.
 *
 * @returns the brief, or null when a required answer is missing or too long.
 */
export function cleanBrief(value: unknown, kind: ProjectKind): Brief | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const what = answer(raw.what);
  const goal = answer(raw.goal);
  if (!what || !goal) return null;

  const where = kind === 'existing' ? answer(raw.where) : null;
  const manual = kind === 'new' ? answer(raw.manual) : null;
  return {
    what,
    ...(where ? { where } : {}),
    ...(manual ? { manual } : {}),
    goal,
  };
}

/** The brief as the text a ticket, a prompt or a panel reads. */
export function briefText(brief: Brief, kind: ProjectKind): string {
  const lines = [`What it is: ${brief.what}`];
  if (kind === 'existing') {
    lines.push(`Where the code lives: ${brief.where ?? 'not said yet'}`);
    lines.push(`Wanted first: ${brief.goal}`);
  } else {
    if (brief.manual) lines.push(`Done by hand today: ${brief.manual}`);
    lines.push(`What done looks like: ${brief.goal}`);
  }
  return lines.join('\n');
}

/** Read the stored brief JSON. A malformed row reads as an empty brief. */
export function parseBrief(value: unknown): Brief {
  if (typeof value !== 'string' || value.length === 0) return { what: '', goal: '' };
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    return {
      what: typeof raw.what === 'string' ? raw.what : '',
      ...(typeof raw.where === 'string' && raw.where ? { where: raw.where } : {}),
      ...(typeof raw.manual === 'string' && raw.manual ? { manual: raw.manual } : {}),
      goal: typeof raw.goal === 'string' ? raw.goal : '',
    };
  } catch {
    return { what: '', goal: '' };
  }
}

/* ——————————————————————— slugs ——————————————————————— */

/**
 * A path-safe project slug. The slug is what a node maps to a folder, so it can
 * only ever be `[a-z0-9-]` and it must start with a letter or digit.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return /^[a-z0-9]/.test(base) ? base : `project${base ? `-${base}` : ''}`;
}

/**
 * A slug no project holds yet: the plain one, then `-2`, `-3`, … then a random
 * tail. The tenant of a slug is decided here, never by the client.
 */
export async function uniqueSlug(env: Env, name: string): Promise<string> {
  const base = slugify(name);
  for (let n = 1; n <= 20; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await env.DB.prepare('SELECT 1 FROM projects WHERE slug = ?').bind(slug).first();
    if (!taken) return slug;
  }
  return `${base.slice(0, 34)}-${crypto.randomUUID().slice(0, 6)}`;
}

const REPO_RE = /^(https:\/\/[^\s]+|git@[^\s:]+:[^\s]+)$/i;

/** A repo URL worth storing, or null. Anything else is not a repo we can clone. */
export function cleanRepo(value: unknown): string | null {
  const repo = typeof value === 'string' ? value.trim() : '';
  return repo.length > 0 && repo.length <= MAX_REPO_CHARS && REPO_RE.test(repo) ? repo : null;
}

/* ——————————————————————— setup completeness ——————————————————————— */

export type CheckState = 'ready' | 'missing' | 'pending' | 'unknown';
/** Who clears a check: the client, or us. */
export type CheckOwner = 'you' | 'us';

export interface SetupCheck {
  key: string;
  label: string;
  state: CheckState;
  /** What to do about it, in one sentence. */
  detail: string;
  owner: CheckOwner;
  /** False for checks that are nice to have: they never hold autonomy back. */
  blocking: boolean;
}

export interface Setup {
  checks: SetupCheck[];
  /** Ready known checks. */
  ready: number;
  /** Known checks: the ones with a state other than `unknown`. */
  total: number;
  /** Every blocking check is ready, so an agent can work without Ali preparing anything. */
  autonomous: boolean;
  /** The one thing to do next, when there is one. */
  next?: string;
}

export interface SetupInput {
  kind: ProjectKind;
  brief: Brief;
  repoKind: RepoKind;
  repo: string | null;
  slug: string;
  /** Slugs an online node currently holds a folder for. */
  onlineSlugs: string[];
  /** Requests filed against this project. */
  ticketCount: number;
  /**
   * True when a client created the project from the interview. False when Ali
   * did: the client is then never asked to fill a brief, so those checks read
   * `unknown` rather than blaming them for a form they never saw.
   */
  clientCreated: boolean;
  /** The hosted site, when the project has one (sites.ts). */
  site?: SiteView | null;
}

/** The code check: where the working copy comes from, and who supplies it. */
function codeCheck(input: SetupInput): Pick<SetupCheck, 'state' | 'detail' | 'owner'> {
  if (input.kind === 'new') {
    if (input.repo) return { state: 'ready', detail: 'The repo for your site exists.', owner: 'us' };
    if (input.site?.state === 'ready') return { state: 'ready', detail: 'Your site’s code is hosted with it.', owner: 'us' };
    return { state: 'pending', detail: 'We create it when your site is set up.', owner: 'us' };
  }
  if (input.repoKind === 'repo' && input.repo) {
    return { state: 'ready', detail: 'A repo is connected.', owner: 'you' };
  }
  if (input.repoKind === 'zip') {
    return { state: 'pending', detail: 'Waiting for the zip; nothing runs until it arrives.', owner: 'us' };
  }
  return { state: 'missing', detail: 'Send a repo link, or a copy of the site.', owner: 'you' };
}

/**
 * Preview and domain: facts about the hosted site. An existing project we do
 * not host has none of them, so they stay `unknown` — hosting someone else's
 * stack means they bring its credentials, not that a check is failing.
 */
function siteChecks(input: SetupInput): SetupCheck[] {
  const site = input.site;
  const make = (key: string, label: string, owner: CheckOwner, blocking: boolean, state: CheckState, detail: string): SetupCheck => ({
    key,
    label,
    state,
    detail,
    owner,
    blocking,
  });
  if (!site) {
    if (input.kind !== 'new') {
      return [
        make('preview', 'Preview URL', 'us', true, 'unknown', 'Only for sites we host.'),
        make('domain', 'Your domain', 'you', false, 'unknown', 'Only for sites we host.'),
      ];
    }
    return [
      make('preview', 'Preview URL', 'you', true, 'missing', 'Set up your site to get a preview link.'),
      make('domain', 'Your domain', 'you', false, 'pending', 'Comes after your site is set up.'),
    ];
  }
  if (site.state === 'failed') {
    return [
      make('preview', 'Preview URL', 'us', true, 'missing', 'Setting up your site stopped. We have been told and will retry.'),
      make('domain', 'Your domain', 'you', false, 'pending', 'Comes after your site is set up.'),
    ];
  }
  if (site.state !== 'ready') {
    return [
      make('preview', 'Preview URL', 'us', true, 'pending', 'Your site is being made. The placeholder page is already up; the code follows.'),
      make('domain', 'Your domain', 'you', false, 'pending', 'Comes after your site is set up.'),
    ];
  }
  return [
    make('preview', 'Preview URL', 'us', true, site.previewUrl ? 'ready' : 'pending', site.previewUrl ? `Preview at ${site.previewUrl}` : 'Waiting for the preview address.'),
    site.customDomain
      ? make('domain', 'Your domain', 'you', false, 'ready', `Live at ${site.customDomain}.`)
      : make('domain', 'Your domain', 'you', false, 'missing', `Optional: connect your own domain. Until then it lives at ${site.productionUrl ?? 'its own address'}.`),
  ];
}

/**
 * How far a project is from being servable without a human preparing it.
 *
 * The checks are the ones this Worker can actually observe; `unknown` never
 * counts towards the total, so a score is a statement about facts, not about a
 * form. Autonomy needs every BLOCKING known check ready — an optional one (the
 * editor, a custom domain) is listed but never holds the project back.
 */
export function setupFor(input: SetupInput): Setup {
  const hasBrief = Boolean(input.brief.what && input.brief.goal);
  const hasWorkspace = input.onlineSlugs.includes(input.slug);
  const code: Pick<SetupCheck, 'state' | 'detail' | 'owner'> = input.clientCreated
    ? codeCheck(input)
    : { state: 'unknown', detail: 'Set up on our side.', owner: 'us' };

  const checks: SetupCheck[] = [
    {
      key: 'brief',
      label: 'Your brief',
      state: !input.clientCreated ? 'unknown' : hasBrief ? 'ready' : 'missing',
      detail: !input.clientCreated
        ? 'Set up on our side.'
        : hasBrief
          ? 'What it is and what done looks like are written down.'
          : 'Answer the three questions so the work has a brief.',
      owner: input.clientCreated ? 'you' : 'us',
      blocking: true,
    },
    {
      key: 'code',
      label: input.kind === 'new' ? 'The repo' : 'Your code',
      ...code,
      blocking: true,
    },
    {
      key: 'workspace',
      label: 'A machine with a copy',
      state: hasWorkspace ? 'ready' : 'missing',
      detail: hasWorkspace ? 'A machine holds a copy and can work on it.' : 'We have not put a copy on a machine yet.',
      owner: 'us',
      blocking: true,
    },
    {
      key: 'request',
      label: 'First request',
      state: input.ticketCount > 0 ? 'ready' : 'missing',
      detail: input.ticketCount > 0 ? 'The first request is filed.' : 'Nothing is asked for yet.',
      owner: 'you',
      blocking: true,
    },
    ...siteChecks(input),
  ];

  const known = checks.filter((check) => check.state !== 'unknown');
  const ready = known.filter((check) => check.state === 'ready').length;
  const nextCheck = known.find((check) => check.state !== 'ready' && check.blocking) ?? known.find((check) => check.state !== 'ready');

  return {
    checks,
    ready,
    total: known.length,
    autonomous: known.every((check) => check.state === 'ready' || !check.blocking),
    ...(nextCheck ? { next: nextCheck.detail } : {}),
  };
}

/** Slugs an online node currently holds a folder for. */
export async function onlineSlugs(env: Env): Promise<string[]> {
  const nodes = await nodesView(env);
  const slugs = new Set<string>();
  for (const node of nodes) {
    if (!node.online) continue;
    for (const slug of node.slugs) slugs.add(slug);
  }
  return [...slugs];
}
