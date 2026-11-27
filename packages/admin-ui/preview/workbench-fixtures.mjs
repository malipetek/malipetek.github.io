/*
 * Synthetic fixtures for the workbench screenshot harness. `api()` answers
 * every GET the real AdminApp issues with production-shaped data, and every
 * mutation with { ok: true } after a short delay. Unknown GETs are recorded in
 * window.__unknown and logged so the capture report can list them.
 *
 * Shapes mirror worker/src: portal.ts (projects, sites, clients, tickets,
 * runs, settings, i18n), queue.ts (nodes, queue), health.ts, seo.ts,
 * marketing.ts (the marketing block below is copied from
 * packages/admin-ui/preview/marketing-preview.mjs).
 */
const NOW = Math.floor(Date.now() / 1000);
const H = 3600, D = 86400, OFF = 10800; // UTC+3, the desk's offsetMinutes
const localDay = (day) => Date.UTC(2026, 10, day) / 1000 - OFF;

if (typeof window !== 'undefined') {
  window.__unknown = window.__unknown ?? [];
  window.__calls = window.__calls ?? [];
}

/* —— projects, sites, clients —— */

const siteOf = (over) => ({
  id: 'site-x',
  name: null,
  isPrimary: true,
  state: 'ready',
  slug: 'x',
  host: 'ours',
  url: 'https://example.ptechsolutions.dev',
  hostname: 'example.ptechsolutions.dev',
  domain: 'ptechsolutions.dev',
  customDomain: null,
  previewUrl: 'https://x--preview.ptechsolutions.dev',
  productionUrl: 'https://example.ptechsolutions.dev',
  feedbackUrl: 'https://x--preview.ptechsolutions.dev?mf=fx-demo',
  error: null,
  previewDeploy: 'd-x-1',
  productionDeploy: 'd-x-1',
  rebuildRequestedAt: null,
  rebuildError: null,
  cloudflare: null,
  updatedAt: NOW - 2 * D,
  ...over,
});

const SITE_ACME = siteOf({
  id: 'site-acme',
  name: 'acmebakery.com',
  slug: 'acme-bakery',
  url: 'https://acmebakery.com',
  hostname: 'acmebakery.com',
  domain: 'acmebakery.com',
  customDomain: 'acmebakery.com',
  previewUrl: 'https://acme-bakery--preview.ptechsolutions.dev',
  productionUrl: 'https://acmebakery.com',
  feedbackUrl: 'https://acme-bakery--preview.ptechsolutions.dev?mf=fx-acme',
  previewDeploy: 'd-acme-05',
  productionDeploy: 'd-acme-04',
  updatedAt: NOW - 26 * H,
});
const SITE_PTECH = siteOf({
  id: 'site-ptech',
  name: 'ptechsolutions.net',
  slug: 'ptechsolutions',
  url: 'https://ptechsolutions.net',
  hostname: 'ptechsolutions.net',
  domain: 'ptechsolutions.net',
  customDomain: 'ptechsolutions.net',
  previewUrl: 'https://ptechsolutions--preview.ptechsolutions.dev',
  productionUrl: 'https://ptechsolutions.net',
  feedbackUrl: 'https://ptechsolutions--preview.ptechsolutions.dev?mf=fx-ptech',
  previewDeploy: 'd-ptech-12',
  productionDeploy: 'd-ptech-12',
  updatedAt: NOW - 2 * D,
});
const SITE_IRON = siteOf({
  id: 'site-iron',
  name: 'ironwoodautorepair.com',
  slug: 'ironwood-app',
  url: 'https://ironwoodautorepair.com',
  hostname: 'ironwoodautorepair.com',
  domain: 'ironwoodautorepair.com',
  customDomain: 'ironwoodautorepair.com',
  previewUrl: 'https://ironwood-app--preview.ptechsolutions.dev',
  productionUrl: 'https://ironwoodautorepair.com',
  feedbackUrl: 'https://ironwood-app--preview.ptechsolutions.dev?mf=fx-iron',
  previewDeploy: 'd-iron-02',
  productionDeploy: 'd-iron-02',
  updatedAt: NOW - 29 * D,
});

const DEPLOYS = {
  'site-acme': [
    { id: 'd-acme-05', site_id: 'site-acme', project_id: 'p-acme', kind: 'preview', branch: 'preview', status: 'ready', created_at: NOW - 26 * H },
    { id: 'd-acme-04', site_id: 'site-acme', project_id: 'p-acme', kind: 'production', branch: 'main', status: 'ready', created_at: NOW - 4 * D },
    { id: 'd-acme-03', site_id: 'site-acme', project_id: 'p-acme', kind: 'preview', branch: 'preview', status: 'ready', created_at: NOW - 5 * D },
    { id: 'd-acme-02', site_id: 'site-acme', project_id: 'p-acme', kind: 'production', branch: 'main', status: 'failed', created_at: NOW - 11 * D },
  ],
  'site-ptech': [
    { id: 'd-ptech-12', site_id: 'site-ptech', project_id: 'p-ptech', kind: 'production', branch: 'main', status: 'ready', created_at: NOW - 2 * D },
    { id: 'd-ptech-11', site_id: 'site-ptech', project_id: 'p-ptech', kind: 'preview', branch: 'preview', status: 'ready', created_at: NOW - 3 * D },
  ],
  'site-iron': [
    { id: 'd-iron-02', site_id: 'site-iron', project_id: 'p-iron', kind: 'production', branch: 'main', status: 'ready', created_at: NOW - 29 * D },
    { id: 'd-iron-01', site_id: 'site-iron', project_id: 'p-iron', kind: 'preview', branch: 'preview', status: 'ready', created_at: NOW - 30 * D },
  ],
};

const check = (key, label, state, detail, owner = 'us', blocking = true) => ({ key, label, state, detail, owner, blocking });
const setupOf = (checks, next) => {
  const known = checks.filter((c) => c.state !== 'unknown');
  return {
    checks,
    ready: known.filter((c) => c.state === 'ready').length,
    total: known.length,
    autonomous: known.every((c) => c.state === 'ready' || !c.blocking),
    ...(next ? { next } : {}),
  };
};

const PROJECTS = [
  {
    id: 'p-acme',
    slug: 'acme-bakery',
    name: 'Acme Bakery',
    kind: 'existing',
    repo: 'https://github.com/PTechGroup/acme-bakery',
    repo_kind: 'repo',
    repoKind: 'repo',
    repo_wanted: 0,
    repo_error: null,
    repo_claim_node: null,
    repo_claim_at: null,
    github_installation_id: 88112233,
    githubInstallationId: 88112233,
    githubAccount: 'PTechGroup',
    created_by: 'u-dana',
    owner_user_id: 'u-ali',
    onboarded_at: NOW - 80 * D,
    created_at: NOW - 80 * D,
    solutions: ['web'],
    brief: {
      what: 'A bakery website with the menu, the order form and opening hours.',
      goal: 'Customers find the menu on their phone and order cakes online.',
      manual: null,
    },
    clients: [
      { id: 'u-dana', email: 'dana@acmebakery.com', name: 'Dana Ruiz', pending: false, copy: true },
      { id: 'u-lena', email: 'lena@sugarwolf.com', name: 'Lena Wolf', pending: true, copy: false },
    ],
    site: SITE_ACME,
    sites: [SITE_ACME],
    repoStatus: { state: 'ready', detail: 'https://github.com/PTechGroup/acme-bakery' },
    setup: setupOf(
      [
        check('brief', 'Your brief', 'ready', 'What it is and what done looks like are written down.', 'you'),
        check('code', 'Your code', 'ready', 'Connected: PTechGroup/acme-bakery', 'you'),
        check('workspace', 'A machine with a copy', 'ready', 'A machine holds a copy and can work on it.'),
        check('request', 'First request', 'ready', 'The first request is filed.', 'you'),
        check('hosting', 'Hosting', 'ready', 'Live at acmebakery.com.', 'us'),
      ],
      null,
    ),
  },
  {
    id: 'p-iron',
    slug: 'ironwood-app',
    name: 'Ironwood Repairs',
    kind: 'existing',
    repo: null,
    repo_kind: 'none',
    repoKind: 'none',
    repo_wanted: 0,
    repo_error: null,
    repo_claim_node: null,
    repo_claim_at: null,
    github_installation_id: null,
    githubInstallationId: null,
    githubAccount: null,
    created_by: 'u-vic',
    owner_user_id: 'u-ali',
    onboarded_at: NOW - 30 * D,
    created_at: NOW - 30 * D,
    solutions: ['mobile-ios', 'app-release'],
    brief: {
      what: 'A repair-shop booking app for iPhone.',
      goal: 'Customers book a repair slot and get a reminder.',
      manual: null,
    },
    clients: [{ id: 'u-vic', email: 'vic@ironwoodautorepair.com', name: 'Vic Marlow', pending: false, copy: false }],
    site: SITE_IRON,
    sites: [SITE_IRON],
    repoStatus: { state: 'missing', detail: 'No repo, and none is being made. Work on it cannot start.' },
    setup: setupOf(
      [
        check('brief', 'Your brief', 'ready', 'What it is and what done looks like are written down.', 'you'),
        check('code', 'Your code', 'missing', 'No repo connected yet.', 'you'),
        check('workspace', 'A machine with a copy', 'missing', 'We have not put a copy on a machine yet.'),
        check('request', 'First request', 'ready', 'The first request is filed.', 'you'),
        check('hosting', 'Hosting', 'ready', 'Live at ironwoodautorepair.com.', 'us'),
      ],
      'No repo connected yet.',
    ),
  },
  {
    id: 'p-mali',
    slug: 'malipetek-dev',
    name: 'malipetek.dev',
    kind: 'existing',
    repo: 'https://github.com/malipetek/malipetek.github.io',
    repo_kind: 'repo',
    repoKind: 'repo',
    repo_wanted: 0,
    repo_error: null,
    repo_claim_node: null,
    repo_claim_at: null,
    github_installation_id: 88224455,
    githubInstallationId: 88224455,
    githubAccount: 'malipetek',
    created_by: null,
    owner_user_id: 'u-ali',
    onboarded_at: NOW - 400 * D,
    created_at: NOW - 400 * D,
    solutions: ['web'],
    brief: null,
    clients: [],
    site: null,
    sites: [],
    repoStatus: { state: 'ready', detail: 'https://github.com/malipetek/malipetek.github.io' },
    setup: setupOf(
      [
        check('brief', 'Your brief', 'unknown', 'Set up on our side.'),
        check('code', 'Your code', 'unknown', 'Set up on our side.'),
        check('workspace', 'A machine with a copy', 'ready', 'A machine holds a copy and can work on it.'),
        check('request', 'First request', 'ready', 'The first request is filed.', 'you'),
      ],
      null,
    ),
  },
  {
    id: 'p-ptech',
    slug: 'ptechsolutions',
    name: 'PTech Solutions',
    kind: 'existing',
    repo: 'https://github.com/PTechGroup/ptechsolutions',
    repo_kind: 'repo',
    repoKind: 'repo',
    repo_wanted: 0,
    repo_error: null,
    repo_claim_node: null,
    repo_claim_at: null,
    github_installation_id: 88112233,
    githubInstallationId: 88112233,
    githubAccount: 'PTechGroup',
    created_by: null,
    owner_user_id: 'u-ali',
    onboarded_at: NOW - 200 * D,
    created_at: NOW - 200 * D,
    solutions: ['web', 'ai-workspace'],
    brief: null,
    clients: [{ id: 'u-dana', email: 'dana@acmebakery.com', name: 'Dana Ruiz', pending: false, copy: false }],
    site: SITE_PTECH,
    sites: [SITE_PTECH],
    repoStatus: { state: 'ready', detail: 'https://github.com/PTechGroup/ptechsolutions' },
    setup: setupOf(
      [
        check('brief', 'Your brief', 'unknown', 'Set up on our side.'),
        check('code', 'Your code', 'unknown', 'Set up on our side.'),
        check('workspace', 'A machine with a copy', 'ready', 'A machine holds a copy and can work on it.'),
        check('request', 'First request', 'ready', 'The first request is filed.', 'you'),
        check('hosting', 'Hosting', 'ready', 'Live at ptechsolutions.net.', 'us'),
      ],
      null,
    ),
  },
];

const CLIENTS = [
  {
    id: 'u-ali',
    email: 'ali@malipetek.dev',
    name: 'Ali Petek',
    role: 'admin',
    handoff: null,
    locale: 'en-US',
    translation: 'deepseek',
    created_at: NOW - 400 * D,
    verified_at: NOW - 400 * D,
    first_preview_at: null,
    firstPreviewLimitUsd: null,
    invitedAt: null,
    pending: false,
    inviteExpiresAt: null,
    projectIds: [],
    ticket_count: 5,
    usage: { billedCents: 0, openCents: 0, aiCents: 0, ourCents: 0, tickets: 5 },
  },
  {
    id: 'u-dana',
    email: 'dana@acmebakery.com',
    name: 'Dana Ruiz',
    role: 'client',
    handoff: 'managed',
    locale: 'en-US',
    translation: 'deepseek',
    created_at: NOW - 80 * D,
    verified_at: NOW - 79 * D,
    first_preview_at: NOW - 78 * D,
    firstPreviewLimitUsd: null,
    invitedAt: NOW - 80 * D,
    pending: false,
    inviteExpiresAt: null,
    projectIds: ['p-acme', 'p-ptech'],
    ticket_count: 6,
    usage: { billedCents: 4520, openCents: 610, aiCents: 88, ourCents: 200, tickets: 6 },
  },
  {
    id: 'u-lena',
    email: 'lena@sugarwolf.com',
    name: 'Lena Wolf',
    role: 'client',
    handoff: null,
    locale: 'de-DE',
    translation: 'deepseek',
    created_at: NOW - 2 * D,
    verified_at: null,
    first_preview_at: null,
    firstPreviewLimitUsd: null,
    invitedAt: NOW - 2 * D,
    pending: true,
    inviteExpiresAt: NOW + 5 * D,
    projectIds: ['p-acme'],
    ticket_count: 0,
    usage: { billedCents: 0, openCents: 0, aiCents: 0, ourCents: 0, tickets: 0 },
  },
  {
    id: 'u-vic',
    email: 'vic@ironwoodautorepair.com',
    name: 'Vic Marlow',
    role: 'client',
    handoff: null,
    locale: 'tr',
    translation: 'deepseek',
    created_at: NOW - 30 * D,
    verified_at: NOW - 29 * D,
    first_preview_at: NOW - 29 * D,
    firstPreviewLimitUsd: 5,
    invitedAt: null,
    pending: false,
    inviteExpiresAt: null,
    projectIds: ['p-iron'],
    ticket_count: 3,
    usage: { billedCents: 0, openCents: 1240, aiCents: 64, ourCents: 500, tickets: 3 },
  },
];
const USAGE_TOTAL = { billedCents: 4520, openCents: 1850, aiCents: 152, ourCents: 700, tickets: 14 };

/* —— fleet —— */

const RUN_LIVE = {
  id: 501,
  ticket_id: 12,
  executor: 'dsh-go',
  model: 'deepseek-v4.1-flash',
  status: 'running',
  started_at: NOW - 620,
  finished_at: null,
  cost_micro_usd: 412000,
  summary: null,
  node_id: 'malipeteks-MacBook-Pro',
  attempt: 1,
  cancel_requested: 0,
  session_id: 'sess-7f3ac9',
  session_dir: null,
  lease_expires_at: NOW + 540,
  branch: 'dsh/12-catering-menu',
  shared_to: null,
  shared_ref: null,
  commit_sha: null,
  diff: null,
  diff_stat: null,
  verify_ok: null,
  verify_detail: null,
  title: 'Update the catering menu and photos',
  slug: 'acme-bakery',
};

const NODES = [
  {
    id: 'malipeteks-MacBook-Pro',
    hostname: 'malipeteks-macbook-pro',
    os: 'macOS 26.1 arm64',
    capabilities: ['os:macos', 'xcode', 'android', 'docker'],
    executors: ['dsh-go', 'dsh', 'dsh-claude', 'dsh-devin'],
    slugs: ['ptechsolutions', 'malipetek-dev', 'acme-bakery'],
    slots: 4,
    version: '0.9.4',
    draining: false,
    online: true,
    lastSeenAt: NOW - 12,
    health: {
      system: {
        load: [1.24, 1.12, 0.91],
        cpus: 10,
        memFreePct: 38,
        disk: { totalGb: 512, freeGb: 183 },
        battery: { percent: 81, onPower: true },
        uptimeSec: 4 * D,
      },
      executors: {
        'dsh-go': { ok: true, version: '1.4.2' },
        'dsh-claude': { ok: true, version: '2.0.1' },
        dsh: { ok: true },
        'dsh-devin': { ok: true, version: '3.0.1' },
      },
      process: {},
    },
    overrides: {},
    running: [
      { id: RUN_LIVE.id, node_id: 'malipeteks-MacBook-Pro', ticket_id: 12, executor: 'dsh-go', started_at: RUN_LIVE.started_at, lease_expires_at: RUN_LIVE.lease_expires_at, cancel_requested: 0, title: RUN_LIVE.title },
    ],
  },
  {
    id: 'g500',
    hostname: 'DTNMachineG500',
    os: 'Ubuntu 24.04 x86_64',
    capabilities: ['os:linux', 'docker', 'always-on'],
    executors: ['dsh-go', 'dsh'],
    slugs: ['ptechsolutions', 'acme-bakery'],
    slots: 2,
    version: '0.9.4',
    draining: false,
    online: true,
    lastSeenAt: NOW - 21,
    health: {
      system: { load: [0.31, 0.28, 0.22], cpus: 8, memFreePct: 64, disk: { totalGb: 1024, freeGb: 641 }, uptimeSec: 30 * D },
      executors: { 'dsh-go': { ok: true, version: '1.4.2' }, dsh: { ok: true } },
      process: {},
    },
    overrides: {},
    running: [],
  },
  {
    id: 'old-imac',
    hostname: 'old-imac',
    os: 'macOS 15.7 arm64',
    capabilities: ['os:macos', 'xcode'],
    executors: ['claude'],
    slugs: ['malipetek-dev'],
    slots: 1,
    version: '0.8.9',
    draining: false,
    online: false,
    lastSeenAt: NOW - 3 * D - 4 * H,
    health: {
      system: { load: [0.02, 0.01, 0.0], cpus: 4, memFreePct: 71, disk: { totalGb: 256, freeGb: 41 }, uptimeSec: 60 * D },
      executors: { claude: { ok: false, error: 'binary missing' } },
      process: { lastError: 'heartbeat timed out' },
    },
    overrides: {},
    running: [],
  },
];

/* —— tickets —— */

const T = (over) => ({
  id: 0,
  title: '',
  title_en: null,
  status: 'new',
  kind: 'client',
  source: 'portal',
  priority: 0,
  requires: [],
  executor: null,
  attention: 'checked',
  created_at: NOW - D,
  updated_at: NOW - H,
  client_waiting_since: null,
  project_id: null,
  project_slug: null,
  project_name: null,
  site_id: null,
  client_email: null,
  client_name: null,
  client_locale: 'en-US',
  human_seconds: 0,
  ai_micro_usd: 0,
  budget_cents: null,
  price_cents: null,
  first_preview: 0,
  first_preview_done_at: null,
  worked_by: null,
  assistant_app: null,
  ...over,
});

const TICKETS = [
  T({
    id: 12,
    title: 'Update the catering menu and photos',
    status: 'in_progress',
    kind: 'client',
    priority: 10,
    executor: 'dsh-go',
    created_at: NOW - 5 * H,
    updated_at: NOW - 600,
    project_id: 'p-acme',
    project_slug: 'acme-bakery',
    project_name: 'Acme Bakery',
    site_id: 'site-acme',
    client_email: 'dana@acmebakery.com',
    client_name: 'Dana Ruiz',
    human_seconds: 1400,
    ai_micro_usd: 412000,
    worked_by: 'fleet',
  }),
  T({
    id: 10,
    title: 'Homepage takes six seconds on a phone',
    status: 'review',
    kind: 'client',
    priority: 10,
    executor: 'dsh-claude',
    created_at: NOW - 2 * D,
    updated_at: NOW - 9 * H,
    client_waiting_since: NOW - 7 * H,
    project_id: 'p-acme',
    project_slug: 'acme-bakery',
    project_name: 'Acme Bakery',
    site_id: 'site-acme',
    client_email: 'dana@acmebakery.com',
    client_name: 'Dana Ruiz',
    human_seconds: 620,
    ai_micro_usd: 980000,
    worked_by: 'fleet',
  }),
  T({
    id: 14,
    title: 'Booking form says sent but nothing arrives',
    status: 'new',
    kind: 'client',
    priority: 0,
    created_at: NOW - 3 * H,
    updated_at: NOW - 3 * H,
    project_id: 'p-acme',
    project_slug: 'acme-bakery',
    project_name: 'Acme Bakery',
    site_id: 'site-acme',
    client_email: 'dana@acmebakery.com',
    client_name: 'Dana Ruiz',
  }),
  T({
    id: 11,
    title: 'Den Checkout-Ablauf ins Deutsche übersetzen',
    title_en: 'Translate the checkout flow to German',
    status: 'new',
    kind: 'client',
    source: 'assistant',
    assistant_app: 'ChatGPT',
    priority: 0,
    created_at: NOW - 26 * H,
    updated_at: NOW - 26 * H,
    project_id: 'p-acme',
    project_slug: 'acme-bakery',
    project_name: 'Acme Bakery',
    client_email: 'lena@sugarwolf.com',
    client_name: 'Lena Wolf',
    client_locale: 'de-DE',
  }),
  T({
    id: 8,
    title: 'Weekend hours on the homepage',
    status: 'new',
    kind: 'client',
    priority: -10,
    created_at: NOW - 2 * H,
    updated_at: NOW - 2 * H,
    project_id: 'p-acme',
    project_slug: 'acme-bakery',
    project_name: 'Acme Bakery',
    client_email: 'office@acmebakery.com',
    client_name: 'Front office',
  }),
  T({
    id: 7,
    title: 'Add online booking to the app',
    status: 'approved',
    kind: 'client',
    priority: 0,
    requires: ['xcode'],
    created_at: NOW - 2 * D,
    updated_at: NOW - 5400,
    project_id: 'p-iron',
    project_slug: 'ironwood-app',
    project_name: 'Ironwood Repairs',
    site_id: 'site-iron',
    client_email: 'vic@ironwoodautorepair.com',
    client_name: 'Vic Marlow',
    client_locale: 'tr',
    budget_cents: 5000,
  }),
  T({
    id: 13,
    title: 'Move the price list to a table',
    status: 'new',
    kind: 'client',
    priority: 50,
    first_preview: 0,
    created_at: NOW - 8 * H,
    updated_at: NOW - 8 * H,
    project_id: 'p-iron',
    project_slug: 'ironwood-app',
    project_name: 'Ironwood Repairs',
    client_email: 'vic@ironwoodautorepair.com',
    client_name: 'Vic Marlow',
    client_locale: 'tr',
  }),
  T({
    id: 9,
    title: 'SEO: title tags on the guide pages',
    status: 'approved',
    kind: 'system',
    priority: 10,
    executor: 'dsh-go',
    created_at: NOW - 20 * H,
    updated_at: NOW - 90,
    project_id: 'p-ptech',
    project_slug: 'ptechsolutions',
    project_name: 'PTech Solutions',
    worked_by: 'ali',
  }),
  T({
    id: 16,
    title: 'Content cycle: write 2 X + 1 LinkedIn posts',
    status: 'in_progress',
    kind: 'system',
    priority: 0,
    created_at: NOW - 4 * H,
    updated_at: NOW - 3 * H,
    project_id: 'p-ptech',
    project_slug: 'ptechsolutions',
    project_name: 'PTech Solutions',
    worked_by: 'ali',
    ai_micro_usd: 64000,
  }),
  T({
    id: 17,
    title: 'Guide cycle: website maintenance',
    status: 'review',
    kind: 'system',
    priority: 0,
    executor: 'dsh-claude',
    created_at: NOW - 2 * D,
    updated_at: NOW - 5 * H,
    project_id: 'p-ptech',
    project_slug: 'ptechsolutions',
    project_name: 'PTech Solutions',
    worked_by: 'ali',
    ai_micro_usd: 1430000,
  }),
  T({
    id: 15,
    title: 'Move the repair shop to Shopify',
    status: 'declined',
    kind: 'client',
    priority: -10,
    created_at: NOW - 14 * D,
    updated_at: NOW - 12 * D,
    project_id: 'p-iron',
    project_slug: 'ironwood-app',
    project_name: 'Ironwood Repairs',
    client_email: 'vic@ironwoodautorepair.com',
    client_name: 'Vic Marlow',
    client_locale: 'tr',
  }),
  T({
    id: 18,
    title: 'Fix the cookie banner overlap',
    status: 'done',
    kind: 'client',
    priority: 0,
    executor: 'dsh-go',
    created_at: NOW - 6 * D,
    updated_at: NOW - 4 * D,
    project_id: 'p-acme',
    project_slug: 'acme-bakery',
    project_name: 'Acme Bakery',
    site_id: 'site-acme',
    client_email: 'dana@acmebakery.com',
    client_name: 'Dana Ruiz',
    human_seconds: 480,
    ai_micro_usd: 210000,
    price_cents: 1430,
    worked_by: 'fleet',
  }),
  T({
    id: 19,
    title: 'Retire lab.malipetek.dev redirects',
    status: 'done',
    kind: 'system',
    priority: 0,
    created_at: NOW - 8 * D,
    updated_at: NOW - 6 * D,
    project_id: 'p-mali',
    project_slug: 'malipetek-dev',
    project_name: 'malipetek.dev',
    worked_by: 'ali',
    human_seconds: 900,
  }),
  T({
    id: 20,
    title: 'First preview: a booking page',
    status: 'done',
    kind: 'client',
    priority: 0,
    first_preview: 1,
    first_preview_done_at: NOW - 29 * D,
    created_at: NOW - 30 * D,
    updated_at: NOW - 29 * D,
    project_id: 'p-iron',
    project_slug: 'ironwood-app',
    project_name: 'Ironwood Repairs',
    site_id: 'site-iron',
    client_email: 'vic@ironwoodautorepair.com',
    client_name: 'Vic Marlow',
    client_locale: 'tr',
    ai_micro_usd: 183000,
    human_seconds: 1200,
    price_cents: null,
    worked_by: 'fleet',
  }),
];

const QUEUE = [
  {
    id: 9,
    title: 'SEO: title tags on the guide pages',
    kind: 'system',
    source: 'system',
    priority: 10,
    requires: [],
    executor: 'dsh-go',
    slug: 'ptechsolutions',
    clientEmail: 'ali@malipetek.dev',
    budgetCents: null,
    firstPreview: false,
    waitingSeconds: 90,
    eligible: ['malipeteks-MacBook-Pro', 'g500'],
    reason: 'Next claim by malipeteks-MacBook-Pro or g500.',
  },
  {
    id: 7,
    title: 'Add online booking to the app',
    kind: 'client',
    source: 'portal',
    priority: 0,
    requires: ['xcode'],
    executor: null,
    slug: 'ironwood-app',
    clientEmail: 'vic@ironwoodautorepair.com',
    budgetCents: 5000,
    firstPreview: false,
    waitingSeconds: 5400,
    eligible: [],
    reason: 'No node has cloned ironwood-app yet; it clones the repo on its next sync.',
  },
];

const RUN_FINISHED = {
  id: 500,
  ticket_id: 10,
  executor: 'dsh-claude',
  model: 'claude-opus-4-7',
  status: 'ok',
  started_at: NOW - 10 * H,
  finished_at: NOW - 9 * H,
  cost_micro_usd: 980000,
  summary: 'Deferred the hero images to a lazy-loaded carousel, inlined critical CSS and dropped the unused font. LCP on a 4G phone went from 6.1s to 2.3s.',
  node_id: 'malipeteks-MacBook-Pro',
  attempt: 1,
  cancel_requested: 0,
  session_id: 'sess-2b8de1',
  session_dir: null,
  lease_expires_at: null,
  branch: 'dsh/10-fast-homepage',
  shared_to: 'origin',
  shared_ref: 'preview',
  commit_sha: '9f3c1a2b4d5e6f7081a2b3c4d5e6f7081a2b3c4d',
  diff: 'diff --git a/index.html b/index.html\n@@ -12,6 +12,7 @@\n-  <img src="hero-4mb.jpg" />\n+  <img src="hero-320w.avif" loading="lazy" />',
  diff_stat: 'index.html | 4 ++--\n1 file changed, 2 insertions(+), 2 deletions(-)',
  verify_ok: 1,
  verify_detail: 'build passed',
  title: 'Homepage takes six seconds on a phone',
  slug: 'acme-bakery',
};
const RUN_FAILED = {
  id: 498,
  ticket_id: 11,
  executor: 'dsh',
  model: 'deepseek-v4.1',
  status: 'failed',
  started_at: NOW - 6 * H,
  finished_at: NOW - 5 * H - 40 * 60,
  cost_micro_usd: 62000,
  summary: null,
  node_id: 'g500',
  attempt: 2,
  cancel_requested: 0,
  session_id: null,
  session_dir: null,
  lease_expires_at: null,
  branch: null,
  shared_to: null,
  shared_ref: null,
  commit_sha: null,
  diff: null,
  diff_stat: null,
  verify_ok: null,
  verify_detail: null,
  title: 'Den Checkout-Ablauf ins Deutsche übersetzen',
  slug: 'acme-bakery',
};

const RUNS = { running: [RUN_LIVE], recent: [RUN_FAILED, RUN_FINISHED] };

/* —— ticket detail (thread, runs, steps, review) —— */

const STEPS_501 = [
  { seq: 1, at: NOW - 610, kind: 'node', text: 'Claimed #12 on malipeteks-MacBook-Pro (dsh-go, attempt 1)' },
  { seq: 2, at: NOW - 595, kind: 'tool', text: 'git: checked out preview from origin/main, created dsh/12-catering-menu' },
  { seq: 3, at: NOW - 560, kind: 'tool', text: 'read menu.html and assets/menu-2026.pdf' },
  { seq: 4, at: NOW - 510, kind: 'text', text: 'Replacing the autumn menu block with the winter items Dana listed; photos go to assets/menu/. ' },
  { seq: 5, at: NOW - 470, kind: 'tool', text: 'edit menu.html: 14 items updated, 3 photos added' },
  { seq: 6, at: NOW - 400, kind: 'tool', text: 'node build: astro build passed in 8.2s' },
  { seq: 7, at: NOW - 320, kind: 'text', text: 'Checking the order form still links the new menu section.' },
  { seq: 8, at: NOW - 180, kind: 'tool', text: 'screenshot: mobile 390px, desktop 1440px — menu renders, no overflow' },
];

const stepSeries = (runId, started, texts, live) => ({
  steps: texts.map((text, i) => ({ seq: i + 1, at: started + i * 180, kind: i === 0 ? 'node' : i === texts.length - 1 ? 'text' : 'tool', text })),
  live,
});

const DETAIL = {
  12: {
    messages: [
      {
        id: 901,
        author: 'client',
        body: 'Please put the winter catering menu on the site. The items are in the PDF I attached — same layout as last season, new photos where you have them. Prices are in the sheet on page two.',
        created_at: NOW - 5 * H,
        internal: 0,
        files: [{ id: 'f-1', name: 'winter-menu-2026.pdf', size: 241400 }],
      },
      { id: 902, author: 'system', body: 'Ali approved this request. A node picked it up.', created_at: NOW - 4 * H - 40 * 60, internal: 0 },
      { id: 903, author: 'ali', body: 'The photos from the PDF are too dark — I swapped in the three from the November shoot.', created_at: NOW - 2 * H, internal: 1 },
    ],
    runs: [RUN_LIVE],
    review: null,
    screenshots: [],
    land: { requestedAt: null, ref: null, sha: null },
    steps: STEPS_501,
    stepsLive: true,
  },
  10: {
    messages: [
      { id: 870, author: 'client', body: 'The homepage takes forever on my phone — about six seconds before I can tap anything. The menu link especially.', created_at: NOW - 2 * D, internal: 0 },
      { id: 871, author: 'system', body: 'Ali approved this request. A node picked it up.', created_at: NOW - 2 * D + 1200, internal: 0 },
      { id: 872, author: 'runner', body: RUN_FINISHED.summary, created_at: NOW - 9 * H, internal: 0 },
      { id: 873, author: 'client', body: 'Looks faster, thank you! The order button still feels slow though — can you check that too?', created_at: NOW - 7 * H, internal: 0 },
    ],
    runs: [RUN_FINISHED],
    review: {
      runId: 500,
      verdict: 'pass',
      headline: 'Homepage LCP drops from 6.1s to 2.3s; the order button delay is a separate issue.',
      points: [
        'Hero image was a 4MB JPEG; now a responsive AVIF with lazy loading.',
        'Critical CSS inlined; the unused display font dropped.',
        'The order button still loads a 900KB script — worth a follow-up ticket.',
      ],
      model: 'dsh-claude review',
      createdAt: NOW - 9 * H + 300,
      buildOk: true,
    },
    screenshots: [],
    land: { requestedAt: null, ref: 'dsh/10-fast-homepage', sha: '9f3c1a2b4d5e6f7081a2b3c4d5e6f7081a2b3c4d' },
    steps: stepSeries(500, NOW - 10 * H, ['Claimed #10 on malipeteks-MacBook-Pro (dsh-claude, attempt 1)', 'lighthouse: LCP 6.1s, TBT 340ms', 'edit index.html: avif hero, critical css', 'astro build passed', 'Done. Preview pushed to the preview deploy.'], false).steps,
    stepsLive: false,
  },
  17: {
    messages: [
      { id: 910, author: 'system', body: 'Guide cycle filed for target "website maintenance".', created_at: NOW - 2 * D, internal: 0 },
      { id: 911, author: 'runner', body: 'Drafted src/content/guides/website-maintenance.md (1,240 words): what a maintenance plan covers, what it should cost, and when a care plan beats a one-off fix. Opened PR #47 on ptechsolutions.', created_at: NOW - 6 * H, internal: 0 },
    ],
    runs: [
      {
        id: 497,
        ticket_id: 17,
        executor: 'dsh-claude',
        model: 'claude-opus-4-7',
        status: 'ok',
        started_at: NOW - 7 * H,
        finished_at: NOW - 6 * H,
        cost_micro_usd: 1430000,
        summary: 'Drafted src/content/guides/website-maintenance.md (1,240 words) and opened PR #47.',
        node_id: 'g500',
        attempt: 1,
        cancel_requested: 0,
        session_id: 'sess-51ca02',
        session_dir: null,
        lease_expires_at: null,
        branch: 'dsh/17-guide-maintenance',
        shared_to: 'origin',
        shared_ref: 'dsh/17-guide-maintenance',
        commit_sha: 'aabbccddeeff00112233445566778899aabbccdd',
        diff: 'diff --git a/src/content/guides/website-maintenance.md b/src/content/guides/website-maintenance.md\nnew file mode 100644',
        diff_stat: 'src/content/guides/website-maintenance.md | 412 ++++\n1 file changed',
        verify_ok: 1,
        verify_detail: 'checkGuide passed',
        title: 'Guide cycle: website maintenance',
        slug: 'ptechsolutions',
      },
    ],
    review: {
      runId: 497,
      verdict: 'attention',
      headline: 'Guide draft is clean; two claims need a fact check before merge.',
      points: [
        'PR #47 adds exactly one guide file, frontmatter valid, 1,240 words.',
        'The pricing paragraph quotes a range that is not in src/lib/pricing.js.',
        'The FAQ "do I need a maintenance plan" reads like an ad — tighten or cut.',
      ],
      model: 'dsh-claude review',
      createdAt: NOW - 5 * H - 40 * 60,
      buildOk: true,
    },
    screenshots: [],
    land: { requestedAt: null, ref: 'dsh/17-guide-maintenance', sha: 'aabbccddeeff00112233445566778899aabbccdd' },
    steps: stepSeries(497, NOW - 7 * H, ['Claimed #17 on g500 (dsh-claude, attempt 1)', 'read guides.json and src/lib/pricing.js', 'write website-maintenance.md', 'open PR #47', 'Done.'], false).steps,
    stepsLive: false,
  },
};

const genericMessages = (t) => [
  {
    id: t.id * 100 + 1,
    author: t.kind === 'system' ? 'system' : 'client',
    body:
      t.kind === 'system'
        ? `System task: ${t.title}.`
        : `From ${t.client_name ?? t.client_email}: ${t.title}.`,
    created_at: t.created_at,
    internal: 0,
  },
];

const ticketDetail = (id) => {
  const ticket = TICKETS.find((x) => String(x.id) === String(id));
  if (!ticket) return { error: 'not_found' };
  const extra = DETAIL[ticket.id] ?? { messages: genericMessages(ticket), runs: [], review: null, screenshots: [], land: { requestedAt: null, ref: null, sha: null }, steps: [], stepsLive: false };
  return {
    ticket: { ...ticket },
    messages: extra.messages,
    runs: extra.runs,
    review: extra.review,
    screenshots: extra.screenshots,
    land: extra.land,
    __steps: extra.steps,
    __stepsLive: extra.stepsLive,
  };
};

/* —— settings + catalog —— */

const SETTINGS = {
  stallMinutes: 30,
  maxAttempts: 3,
  notifyRunFinished: true,
  autoApproveCents: 2500,
  defaultPriority: 0,
  sitesDomain: 'ptechsolutions.dev',
  clientPublish: true,
  first_preview_limit_usd: 2,
};

const CATALOG = {
  capabilities: [
    { id: 'os:macos', label: 'macOS', hint: 'Xcode, iOS simulators, Apple tooling' },
    { id: 'os:linux', label: 'Linux', hint: 'the G500, servers' },
    { id: 'xcode', label: 'Xcode', hint: 'iOS / macOS builds' },
    { id: 'android', label: 'Android SDK', hint: 'Android builds and emulators' },
    { id: 'docker', label: 'Docker', hint: 'containers' },
    { id: 'gpu', label: 'GPU', hint: 'local models, rendering' },
    { id: 'always-on', label: 'Always on', hint: 'never sleeps — long jobs' },
    { id: 'sandbox', label: 'Cloud sandbox', hint: 'Cloudflare, later' },
  ],
  executors: [
    { id: 'dsh-go', label: 'Flash', hint: 'the Harness on OpenCode Go, DeepSeek v4.1 flash; the default' },
    { id: 'dsh-claude', label: 'Opus', hint: 'the Harness driving Claude Code (Opus); for hard work' },
    { id: 'dsh', label: 'DeepSeek', hint: 'the Harness on the DeepSeek account' },
    { id: 'dsh-devin', label: 'SWE-2', hint: 'the Harness driving Devin (SWE-2, free)' },
    { id: 'dsh-opencode', label: 'OpenCode (ACP)', hint: 'OpenCode driven over ACP; pinned tickets only' },
    { id: 'claude', label: 'Claude Code CLI', hint: 'outside the Harness; pinned tickets only' },
    { id: 'opencode', label: 'OpenCode CLI', hint: 'outside the Harness; pinned tickets only' },
    { id: 'devin', label: 'Devin CLI', hint: 'outside the Harness; pinned tickets only' },
  ],
  solutions: [
    { id: 'web', label: 'Website', summary: 'Design, build, or improve a website that works on phones and desktops.', requires: [], integrations: [], deliverables: ['Responsive website', 'Review link', 'Launch and editing notes'], questions: ['Who will visit the site?'] },
    { id: 'mobile-ios', label: 'iOS app', summary: 'Build or improve an app for iPhone and iPad.', requires: ['os:macos', 'xcode'], integrations: [{ id: 'app-store-connect', optional: false }], deliverables: ['iOS app', 'TestFlight build', 'Handover notes'], questions: ['What should people be able to do the first time they open the app?'] },
    { id: 'app-release', label: 'App Store and Play submissions', summary: 'Prepare an existing app for store review, testing, and release.', requires: ['os:macos'], integrations: [{ id: 'app-store-connect', optional: false }, { id: 'google-play', optional: false }], deliverables: ['Store listing and submission checklist', 'Test releases', 'Review and rollout notes'], questions: ['Is this the first release or an update?'] },
    { id: 'ai-workspace', label: 'AI workspace', summary: 'Give your team reusable AI instructions and safe access to its everyday tools.', requires: [], integrations: [], deliverables: ['Reusable skills and workflows', 'Tool connections agreed with your team', 'Examples and handover notes'], questions: ['Which repeated tasks take your team the most time?'] },
    { id: 'server', label: 'Server or container', summary: 'Set up or improve the hosting that keeps your service running.', requires: ['docker'], integrations: [{ id: 'hetzner', optional: true }], deliverables: ['Repeatable service setup', 'Monitoring and recovery notes', 'Operating and cost notes'], questions: ['What service needs to stay online?'] },
  ],
  integrations: [
    { id: 'app-store-connect', label: 'App Store Connect', vendor: 'Apple', fields: [{ name: 'ASC_ISSUER_ID', label: 'Issuer ID', secret: false }, { name: 'ASC_KEY_ID', label: 'Key ID', secret: false }, { name: 'ASC_PRIVATE_KEY', label: 'Private key (.p8)', secret: true, multiline: true }], steps: ['Open Users and Access → Integrations → App Store Connect API.', 'Create a key with the App Manager role and copy the Issuer ID and Key ID.'], docs: 'https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api', scope: 'App Manager can manage releases.' },
    { id: 'google-play', label: 'Google Play Console', vendor: 'Google', fields: [{ name: 'PLAY_SERVICE_ACCOUNT_JSON', label: 'Service account JSON', secret: true, multiline: true }], steps: ['Create a service account in Google Cloud and link it in Play Console.'], docs: 'https://developers.google.com/android-publisher', scope: 'Release manager on this app only.' },
  ],
};

/* —— health —— */

const HEALTH = {
  checks: [
    { name: 'portal', label: 'Portal reachable', status: 'ok', detail: 'https://ptechsolutions.net answered 200 in 182ms', latencyMs: 182, checkedAt: NOW - 120, failingSince: null },
    { name: 'oauth:return', label: 'OAuth clients', status: 'ok', detail: 'Every registered client has a reachable return address', latencyMs: 404, checkedAt: NOW - 120, failingSince: null },
    { name: 'deploy', label: 'Deploy matches master', status: 'ok', detail: 'ptechsolutions-intercom runs the sha master was at two deploys ago', latencyMs: 260, checkedAt: NOW - 120, failingSince: null },
    { name: 'node:malipeteks-MacBook-Pro', label: 'Node malipeteks-MacBook-Pro', status: 'ok', detail: 'heartbeat 12s ago · v0.9.4 · 1/4 slots', latencyMs: null, checkedAt: NOW - 12, failingSince: null },
    { name: 'node:g500', label: 'Node g500', status: 'ok', detail: 'heartbeat 21s ago · v0.9.4 · 0/2 slots', latencyMs: null, checkedAt: NOW - 21, failingSince: null },
    { name: 'node:old-imac', label: 'Node old-imac', status: 'fail', detail: 'last heartbeat 3d 4h ago (threshold 12h)', latencyMs: null, checkedAt: NOW - 120, failingSince: NOW - 3 * D - 4 * H },
    { name: 'clones', label: 'Project clones', status: 'ok', detail: 'No repo errors on any project', latencyMs: null, checkedAt: NOW - 120, failingSince: null },
    { name: 'stuck', label: 'Stuck tickets', status: 'ok', detail: 'Nothing in progress for more than 45 minutes without a report', latencyMs: null, checkedAt: NOW - 120, failingSince: null },
    { name: 'deepseek', label: 'DeepSeek translation + chat', status: 'ok', detail: 'bridge and chat answered in 743ms', latencyMs: 743, checkedAt: NOW - 120, failingSince: null },
  ],
  failing: 1,
  ranAt: NOW - 120,
};

const I18N = {
  ready: true,
  repo: 'malipetek/malipetek.github.io',
  requestedAt: null,
  runningSince: null,
  checkedAt: NOW - 800,
  auto: false,
  englishChanged: false,
  last: {
    at: NOW - 9 * D,
    trigger: 'manual',
    ok: true,
    keys: 412,
    locales: 34,
    removed: 3,
    commit: 'a1b2c3d4e5',
    error: null,
    rejected: {},
    failed: {},
  },
};

/* —— SEO —— */

const seoSeries = (base, spread, n = 14) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.now() - (n - 1 - i) * D * 1000);
    return { day: d.toISOString().slice(0, 10), averageScore: base + Math.round(Math.sin(i * 0.9) * spread), pages: 41 };
  });

const seoDay = (back) => new Date(Date.now() - back * D * 1000).toISOString().slice(0, 10);

const SEO_OVERVIEW = {
  day: seoDay(1),
  hosts: [
    {
      host: 'ptechsolutions.net',
      averageScore: 87,
      pages: 41,
      day: seoDay(1),
      findings: { high: 2, medium: 4, low: 6, open: 12 },
      series: seoSeries(86, 5),
    },
  ],
  state: { lastAuditAt: NOW - 20 * H, lastGeoAt: NOW - 3 * D, lastCitationsAt: NOW - 4 * D, lastRanksAt: NOW - 11 * D },
  cycle: { auto: true, openFindings: 12, wouldFile: false, openTicketId: 17, held: { held: true, until: seoDay(-6), since: seoDay(3) } },
  coverage: [
    { kind: 'keyword', target: 'website maintenance', guide: { url: 'https://ptechsolutions.net/guides/website-maintenance', title: 'Website maintenance' } },
    { kind: 'keyword', target: 'vibe contracting', inProgress: 17 },
    { kind: 'question', target: 'who builds small business websites fast', lastAttemptAt: NOW - 9 * D },
    { kind: 'question', target: 'ai developer for small business', guide: null },
    { kind: 'keyword', target: 'small business website developer', guide: { url: 'https://ptechsolutions.net/guides/small-business-website', title: 'Small business websites' } },
    { kind: 'question', target: 'what does a website cost for a bakery', guide: null },
    { kind: 'keyword', target: 'contract software developer', guide: null },
  ],
  geo: {
    rate: 0.42,
    mentions: 5,
    runs: 12,
    weeks: Array.from({ length: 8 }, (_, i) => {
      const d = new Date(Date.now() - (7 - i) * 7 * D * 1000);
      const runs = 4;
      const mentions = [0, 1, 1, 2, 1, 2, 1, 2][i];
      return { week: d.toISOString().slice(0, 10), runs, mentions, rate: mentions / runs };
    }),
  },
  citations: { todo: 3, drafted: 1, live: 2, verified: 4, skipped: 2 },
  rank: { rankReady: true, latestDay: seoDay(11), avgPosition: 23, inTop10: 2, inTop100: 6, swing: 4, keywords: 8, pending: 2 },
  settings: {
    autoCycle: true,
    volatilityHold: true,
    guidesAuto: true,
    guidesPerWeek: 2,
    guidesAutoMerge: true,
    geoQuestions: ['who builds small business websites fast', 'what is vibe contracting'],
    rankKeywords: ['vibe contracting', 'website maintenance', 'small business website developer'],
    rankLocation: { locationCode: 2840, languageCode: 'en' },
  },
  events: [
    { id: 'ev-1', kind: 'fix', day: seoDay(8), label: 'Missing meta descriptions on /guides', source: 'cycle' },
    { id: 'ev-2', kind: 'guide', day: seoDay(12), label: 'Guide: small business website cost' },
    { id: 'ev-3', kind: 'core_update', day: seoDay(16), label: 'Google core update noticed', source: 'note' },
  ],
  guidesAt: NOW - 20 * H,
};

const seoRankSeries = Array.from({ length: 10 }, (_, i) => ({
  day: seoDay((9 - i) * 7),
  avgPosition: 31 - i,
  inTop10: i > 5 ? 2 : 1,
  inTop100: 4 + Math.min(3, Math.round(i / 3)),
}));

const SEO_RANKS = {
  rows: [
    { keyword: 'vibe contracting', position: 1, prevPosition: 2, change: 1, url: 'https://ptechsolutions.net/', topDomains: ['ptechsolutions.net', 'wix.com', 'squarespace.com'] },
    { keyword: 'website maintenance', position: 7, prevPosition: 9, change: 2, url: 'https://ptechsolutions.net/guides/website-maintenance', topDomains: ['ptechsolutions.net', 'wpbeginner.com'] },
    { keyword: 'small business website developer', position: 34, prevPosition: 30, change: -4, url: 'https://ptechsolutions.net/', topDomains: ['upwork.com', 'fiverr.com', 'squarespace.com', 'clutch.co'] },
    { keyword: 'ai developer for small business', position: null, prevPosition: null, change: null, url: null, topDomains: ['clutch.co', 'upwork.com'] },
    { keyword: 'contract software developer', position: 61, prevPosition: 61, change: 0, url: 'https://ptechsolutions.net/', topDomains: ['toptal.com'] },
  ],
  keywords: ['vibe contracting', 'website maintenance', 'small business website developer', 'ai developer for small business', 'contract software developer'],
  series: seoRankSeries,
  avgPosition: 23,
  inTop10: 2,
  inTop100: 5,
  swing: 4,
  pending: 2,
  latestDay: seoDay(11),
  rankReady: true,
  location: { locationCode: 2840, languageCode: 'en' },
};

const SEO_PAGES = {
  day: seoDay(1),
  days: [seoDay(1), seoDay(2), seoDay(3)],
  averageScore: 78,
  pages: [
    { id: 'p1', host: 'ptechsolutions.net', path: '/', status: 200, title: 'PTech — AI work, shipped', titleLen: 28, description: 'Small software jobs, done by an agent, checked by a person.', descLen: 66, canonical: 'https://ptechsolutions.net', score: 94, issues: [], hreflangCount: 0, jsonldTypes: ['Organization', 'WebSite'], h1Count: 1, ms: 210, inSitemap: true, inLlms: true },
    { id: 'p2', host: 'ptechsolutions.net', path: '/guides/website-maintenance', status: 200, title: 'Website maintenance pricing', titleLen: 27, description: 'What a maintenance plan covers and what it should cost.', descLen: 60, canonical: 'https://ptechsolutions.net/guides/website-maintenance', score: 88, issues: [{ code: 'h1_count:2', severity: 'medium', detail: 'Two h1 elements on the page.' }], hreflangCount: 0, jsonldTypes: ['Article', 'FAQPage'], h1Count: 2, ms: 190, inSitemap: true, inLlms: false },
    { id: 'p3', host: 'ptechsolutions.net', path: '/pricing', status: 200, title: 'Pricing', titleLen: 7, description: null, descLen: 0, canonical: null, score: 61, issues: [{ code: 'no_description', severity: 'high', detail: 'The page has no meta description.' }, { code: 'title_short', severity: 'low', detail: 'Title is under 15 characters.' }], hreflangCount: 0, jsonldTypes: [], h1Count: 1, ms: 1800, inSitemap: true, inLlms: false },
    { id: 'p4', host: 'ptechsolutions.net', path: '/old-page', status: 200, title: 'Old page that still answers', titleLen: 29, description: 'A page kept for an old link.', descLen: 32, canonical: 'https://ptechsolutions.net/old-page', score: 52, issues: [{ code: 'no_jsonld', severity: 'medium', detail: 'No JSON-LD block found.' }], hreflangCount: 0, jsonldTypes: [], h1Count: 0, ms: 160, inSitemap: false, inLlms: false },
  ],
};

const SEO_FINDINGS = {
  counts: { high: 2, medium: 4, low: 6, open: 12, resolved: 4 },
  findings: [
    { id: 'f-1', host: 'ptechsolutions.net', path: '/pricing', code: 'no_description', severity: 'high', detail: 'The page has no meta description; results show whatever Google picks.', firstSeen: NOW - 20 * D, lastSeen: NOW - D, resolvedAt: null, ticketId: 9 },
    { id: 'f-2', host: 'ptechsolutions.net', path: '/old-page', code: 'no_jsonld', severity: 'medium', detail: 'No JSON-LD block found.', firstSeen: NOW - 20 * D, lastSeen: NOW - D, resolvedAt: null, ticketId: null },
    { id: 'f-3', host: 'ptechsolutions.net', path: '/guides/website-maintenance', code: 'h1_count:2', severity: 'medium', detail: 'Two h1 elements on the page.', firstSeen: NOW - 6 * D, lastSeen: NOW - D, resolvedAt: null, ticketId: null },
    { id: 'f-4', host: 'ptechsolutions.net', path: '/about', code: 'title_short', severity: 'low', detail: 'Title is under 30 characters.', firstSeen: NOW - 20 * D, lastSeen: NOW - D, resolvedAt: null, ticketId: null },
    { id: 'f-5', host: 'ptechsolutions.net', path: '/old-contact', code: '404_in_sitemap', severity: 'high', detail: 'Sitemap lists a page that answers 404.', firstSeen: NOW - 14 * D, lastSeen: NOW - 4 * D, resolvedAt: NOW - 4 * D, ticketId: 19 },
  ],
};

const SEO_GEO = {
  engineReady: true,
  summary: { rate: 0.42, mentions: 5, runs: 12 },
  weeks: SEO_OVERVIEW.geo.weeks,
  questions: ['Who builds small business websites fast?', 'Is there a service that does tiny website changes without a retainer?', 'Who offers AI-assisted web development for small businesses?', 'What is vibe contracting?'],
  runs: [
    { id: 'g-1', day: seoDay(3), question: 'Who builds small business websites fast?', mentionsUs: true, competitors: ['wix.com', 'squarespace.com'], citedUrls: ['https://ptechsolutions.net/', 'https://ptechsolutions.net/guides/website-maintenance'], engine: 'deepseek', answerExcerpt: 'PTech is a small studio that ships websites quickly…' },
    { id: 'g-2', day: seoDay(3), question: 'Who offers AI-assisted web development for small businesses?', mentionsUs: false, competitors: ['upwork.com', 'toptal.com'], citedUrls: ['https://www.upwork.com/', 'https://www.toptal.com/'], engine: 'deepseek', answerExcerpt: 'Several marketplaces list vetted AI developers…' },
    { id: 'g-3', day: seoDay(3), question: 'What is vibe contracting?', mentionsUs: true, competitors: [], citedUrls: ['https://ptechsolutions.net/'], engine: 'deepseek', answerExcerpt: 'A way of buying small software jobs by the second…' },
  ],
};

const SEO_CITATIONS = {
  counts: { todo: 3, drafted: 1, live: 2, verified: 4, skipped: 2, total: 12 },
  statuses: ['todo', 'drafted', 'live', 'verified', 'skipped'],
  citations: [
    { id: 'c-1', platform: 'Bing Places', domain: 'bingplaces.com', dr: 92, profileUrl: 'https://www.bing.com/maps/?cid=demo', status: 'verified', lastChecked: NOW - 4 * D, linkVerifiedAt: NOW - 4 * D, note: null },
    { id: 'c-2', platform: 'Apple Maps', domain: 'mapsconnect.apple.com', dr: 95, profileUrl: null, status: 'todo', lastChecked: null, linkVerifiedAt: null, note: 'Needs a business phone number.' },
    { id: 'c-3', platform: 'Foursquare', domain: 'foursquare.com', dr: 86, profileUrl: 'https://foursquare.com/v/ptech-demo', status: 'live', lastChecked: NOW - 9 * D, linkVerifiedAt: NOW - 9 * D, note: null },
    { id: 'c-4', platform: 'Yellow Pages', domain: 'yellowpages.com', dr: 83, profileUrl: null, status: 'drafted', lastChecked: null, linkVerifiedAt: null, note: 'Draft description saved by the last fix cycle.' },
  ],
};

/* —— admin/marketing + workbench router —— */
const settings = {
  live: true, dailyCap: 100, perRun: 10, startHour: 8, endHour: 17,
  offsetMinutes: 180, weekdaysOnly: true,
  postalAddress: '30 N Gould St Ste N, Sheridan, WY 82801, United States',
  fromName: 'Muhammet Ali Petek', voiceNotes: '', provider: 'cloudflare',
  postApproval: true, reviewFirst: false, image: 'first',
  autoResume: true, obsShare: 50, postHoldHours: 24,
};

const FOOTER = '\n\n--\nMuhammet Ali Petek\n30 N Gould St Ste N, Sheridan, WY 82801, United States\n\nReply "no" and I will not write again.';

// [site-or-null, business, email-local-or-full-address]
const POOL = [
  ['corroof.com', 'CorRoof', 'mike'],
  ['berniesplumbing.com', "Bernie's Plumbing", 'bernie'],
  ['empireburger.com', 'Empire Burger', 'dana'],
  ['sugarwolfbakery.com', 'Sugar Wolf Bakery', 'lena'],
  ['harborpestcontrol.com', 'Harbor Pest Control', 'sam'],
  ['mainstreetpharmacy.com', 'Main Street Pharmacy', null],
  ['sunsetsewing.com', 'Sunset Sewing & Alterations', 'rosa'],
  ['copperkettlecafe.com', 'Copper Kettle Cafe', 'tom'],
  ['ironwoodautorepair.com', 'Ironwood Auto Repair', 'vic'],
  ['bluebirdbakeryco.com', 'Bluebird Bakery Co.', 'june'],
  ['pinecrestlandscaping.com', 'Pinecrest Landscaping', 'gord'],
  ['brightpathdental.com', 'Bright Path Dental', 'allen'],
  ['redrockroadhouse.com', 'Red Rock Roadhouse', 'beth'],
  ['silverlineelectrical.com', 'Silver Line Electrical', 'wade'],
  ['meadowlarkfarmstand.com', 'Meadowlark Farm Stand', 'hollis'],
  ['stonebridgechiro.com', 'Stonebridge Chiropractic', 'cole'],
  ['lakesidecoffee.com', 'Lakeside Coffee', 'nina'],
  ['peakperformancefitness.com', 'Peak Performance Fitness', 'ray'],
  ['goodfenceco.com', 'Good Fencer Co.', 'walt'],
  ['tidytenant.com', 'Tidy Tenant Cleaning', 'maria'],
  ['northstarhvac.com', 'Northstar HVAC', 'ed'],
  ['willowandwrenflorals.com', 'Willow & Wren Florals', 'abby'],
  ['drifthomebrew.com', 'Drift Homebrew', 'kurt'],
  ['sunsetbikerepair.com', 'Sunset Bike Repair', 'felix'],
  ['magnoliabakeshop.com', 'Magnolia Bake Shop', 'pearl'],
  ['granitepeakpizza.com', 'Granite Peak Pizza', 'lou'],
  ['fairvieweyecare.com', 'Fairview Eye Care', 'shah'],
  ['highdesertwinery.com', 'High Desert Winery', 'gail'],
  ['valleyair.com', 'Valley Air Conditioning', 'roy'],
  ['mapleroofing.com', 'Maple Roofing & Gutters', 'hank'],
  ['sweetpeaevents.com', 'Sweet Pea Events', 'tess'],
  ['ironhorsefarrier.com', 'Iron Horse Farrier', 'jim'],
  ['dawnpatroldonuts.com', 'Dawn Patrol Donuts', 'ash'],
  ['copperstatecleaners.com', 'Copper State Cleaners', 'dot'],
  ['bluebonnettax.com', 'Bluebonnet Tax & Books', 'ruth'],
  ['trailheadoutfitters.com', 'Trailhead Outfitters', 'rex'],
  ['honeydoestudio.com', 'Honey Doe Studio', 'wren'],
  ['quailrunestate.com', 'Quail Run Vineyards', 'marcy'],
  ['premierdoggrooming.com', 'Premier Dog Grooming', 'kay'],
  ['quicklubeautocare.com', 'Quick Lube Auto Care', 'rob'],
  ['rosewoodcafe.com', 'Rosewood Cafe', 'elle'],
  ['firstlightchapel.org', 'First Light Chapel', 'jim'],
  ['greenleaforganics.com', 'Greenleaf Organics', 'holly'],
  ['brickhousebrewery.com', 'Brick House Brewery', 'mack'],
  ['seasideicecream.com', 'Seaside Ice Cream', 'fran'],
  ['twinpinesprint.com', 'Twin Pines Print & Design', 'greg'],
  [null, 'Sunrise Window Cleaning', 'sunrisewindowcleaning@gmail.com'],
  [null, 'Mesa Verde Alterations', 'mesaverdealt@gmail.com'],
  [null, 'Canyon 459 Locksmith', 'canyon459lock@gmail.com'],
  [null, 'Bluebonnet Tire Repair', 'bluebonnettire@gmail.com'],
];

const ROLE = ['info', 'hello', 'contact', 'office', 'mail', 'enquiries'];
const GAPS = [
  'the copyright in the footer still says 2014',
  'the menu is a PDF, which is painful on a phone',
  'the homepage takes about six seconds to load on mobile data',
  'there is no meta description, so search results show whatever Google picks',
  'the contact form says "sent" but nothing arrives',
  'the phone number in the header is an old one',
  'the site only redirects to https after the page has loaded',
  'there is no way to order or book online',
  'the testimonials are from 2019',
  'the events page still lists shows from last spring',
  'the online booking calendar has been down since June',
  'the shop section still shows last year\'s prices',
];
const NAMES = ['Mike', 'Bernie', 'Dana', 'Lena', 'Sam', 'Rosa', 'Tom', 'Vic', 'June', 'Gord', 'Allen', 'Beth', 'Wade', 'Hollis', 'Cole', 'Nina', 'Ray', 'Walt', 'Maria', 'Ed'];

const contacts = [];
for (let i = 0; i < 200; i++) {
  const cycle = Math.floor(i / POOL.length);
  const p = POOL[i % POOL.length];
  const [site, business, local] = p;
  const base = local && local.indexOf('@') === -1 ? local : ROLE[(i * 7) % ROLE.length];
  const email = local && local.indexOf('@') !== -1
    ? local
    : (base + (cycle ? String(cycle + 1) : '')) + '@' + site;
  const observed = i < 14; // withGap: 14 on production today
  const gap = observed ? GAPS[i % GAPS.length] : null;
  const status = i % 13 === 5 ? 'contacted'
    : i === 37 || i === 71 ? 'paused'
    : i === 129 || i === 188 ? 'bounced'
    : i === 164 ? 'opted_out'
    : 'queued';
  const contacted = status === 'contacted';
  contacts.push({
    id: 5000 + i,
    email,
    name: site ? NAMES[i % NAMES.length] : null,
    business,
    site,
    source: site ? 'first-import' : 'osm-co-mail-only',
    sourceUrl: i === 0 ? 'https://www.dandb.com/businessdirectory/corroof.com' : null,
    gap,
    consentBasis: 'legitimate_interest',
    status,
    notes: i === 3 ? 'Asked about the maintenance plan on the call.' : null,
    createdAt: NOW - (5 + ((i * 11) % 60)) * D - (i % 97) * H,
    updatedAt: NOW - ((i * 13) % 5000) - (i % 60) * 60,
    lastContactedAt: contacted ? NOW - (2 + (i % 8)) * D : null,
    optedOutAt: status === 'opted_out' ? NOW - 5 * D : null,
    sourceKind: site ? (i % 19 === 0 ? 'osm-co-mail-only' : 'first-import') : 'osm-co-mail-only',
    country: i % 31 === 0 ? null : i % 47 === 0 ? 'CA' : 'US',
    sentCount: contacted ? 1 + (i % 3) : 0,
    nextAt: status === 'queued' ? NOW + ((i * 37) % 400) * 1800
      : contacted && i % 2 ? NOW + ((i * 29) % 200) * 7200 : null,
  });
}
const byId = (id) => contacts.find((c) => c.id === id) ?? null;
const C = (i) => contacts[i]; // fixture index → contact row

/* —— the real sequence copy, fields filled per contact —— */

const fill = (text, c) => {
  const first = (c.name || '').trim().split(/\s+/)[0] || '';
  return text
    .replaceAll('{{greeting}}', first ? 'Hi ' + first + ',' : 'Hi,')
    .replaceAll('{{business}}', c.business || c.site || 'your business')
    .replaceAll('{{site}}', c.site || 'your site')
    .replaceAll('{{gap}}', c.gap || 'there are a couple of small things I would fix first');
};

const STEP_BODIES = {
  cold_a: {
    first: ['{{greeting}}', '', 'Do you want help using AI on your business and getting your projects online?', '', "It's called vibe contracting: you connect to my service, and I, a veteran programmer, help you use AI and deploy what you build.", '', 'It costs $100 an hour, billed by the second, so most jobs come to less than $10.', '', "Reply with what you're working on and I'll tell you how I'd help.", '', 'Muhammet', 'ptechsolutions.net'],
    followup_1: ['{{greeting}}', '', 'Did you see my note about vibe contracting? If you are working on something, reply with a line and I\'ll tell you how I\'d help.', '', 'Muhammet'],
    followup_2: ['{{greeting}}', '', 'Last note from me. If you want help with AI or getting a project online later, you can ask at ptechsolutions.net/portal, with no call or quote first.', '', 'Muhammet'],
  },
  cold_b: {
    first: ['{{greeting}}', '', 'Do you want help using AI on your business and getting your projects online?', '', "It's called vibe contracting: you connect to my service, and I, a veteran programmer, help you use AI and deploy what you build.", '', 'It costs $100 an hour, billed by the second, so most jobs come to less than $10.', '', "Reply with what you're working on and I'll tell you how I'd help.", '', 'Muhammet', 'ptechsolutions.net'],
    followup_1: ['{{greeting}}', '', 'Did you see my note about vibe contracting? If you are working on something, reply with a line and I\'ll tell you how I\'d help.', '', 'Muhammet'],
    followup_2: ['{{greeting}}', '', 'Last note from me. If you want help with AI or getting a project online later, you can ask at ptechsolutions.net/portal, with no call or quote first.', '', 'Muhammet'],
  },
  cold_obs: {
    first: ['{{greeting}}', '', '{{gap}}', '', 'I can fix that for you. It\'s called vibe contracting: you connect to my service, and I, a veteran programmer, help you use AI and deploy the change.', '', 'It costs $100 an hour, billed by the second, so most jobs come to less than $10.', '', 'Want me to fix it?', '', 'Muhammet', 'ptechsolutions.net'],
    followup_1: ['{{greeting}}', '', 'Should I go ahead with the fix on {{site}}? A one-line reply is enough.', '', 'Muhammet'],
    followup_2: ['{{greeting}}', '', 'Last note from me. If you want it fixed later, you can ask at ptechsolutions.net/portal, with no call or quote first.', '', 'Muhammet'],
  },
  nosite: {
    first: ['{{greeting}}', '', 'I found {{business}} on OpenStreetMap. The listing has your email but no website.', '', 'I build small business sites. An AI agent does the typing, and I approve the job and check the result before anything goes live. You pay for my time by the second, at $100 an hour, with no quote and no minimum. A one-page site with your services, hours and phone number is a short job.', '', 'If you want one, reply with a line about the business and I will tell you what it would take.', '', 'Muhammet', 'ptechsolutions.net'],
    followup_1: ['{{greeting}}', '', 'Should I sketch a one-page site for {{business}}, or is it not worth it right now? Either answer helps me.', '', 'Muhammet'],
    followup_2: ['{{greeting}}', '', 'Last note from me. If you want a site later, you can ask through ptechsolutions.net/portal, with no call or quote first.', '', 'Muhammet'],
  },
  warm: {
    first: ['{{greeting}}', '', "I've started something I call vibe contracting: you connect to my service, and I help you use AI and deploy what you build.", '', 'It costs $100 an hour, billed by the second, so most jobs come to less than $10.', '', "I'm looking for the first few jobs to put through it. Is there something on {{site}} you have been putting off? If not, an introduction to someone who could use it would help just as much.", '', 'Muhammet'],
    followup_1: ['{{greeting}}', '', 'What is the smallest thing on {{site}} you have been meaning to fix? Small jobs are where this costs least: you pay for the minutes I spend, and the agent\'s part costs cents.', '', 'Muhammet'],
    followup_2: ['{{greeting}}', '', 'I will stop filling your inbox. If something small comes up, the door is open: ptechsolutions.net/portal.', '', 'Muhammet'],
  },
};
const STEP_SUBJECT = {
  cold_a: { first: 'Vibe contracting', followup_1: 'Re: Vibe contracting', followup_2: 'Re: Vibe contracting' },
  cold_b: { first: 'Vibe contracting for {{site}}', followup_1: 'Re: Vibe contracting for {{site}}', followup_2: 'Re: Vibe contracting for {{site}}' },
  cold_obs: { first: '{{site}}', followup_1: '{{site}}', followup_2: '{{site}}' },
  nosite: { first: 'A website for {{business}}', followup_1: 'Re: A website for {{business}}', followup_2: 'Re: A website for {{business}}' },
  warm: { first: 'A small experiment (and a favour)', followup_1: 'Re: A small experiment (and a favour)', followup_2: 'Re: A small experiment (and a favour)' },
};
const STEP_DAY = { first: 0, followup_1: 4, followup_2: 10 };
const SEQ_LABEL = {
  cold_a: 'Cold A: someone who built it with AI',
  cold_b: 'Cold B: a business owner with a small list',
  cold_obs: 'Cold: opens on the observation of their site',
  nosite: 'No website: an email on the map, no site',
  warm: 'Warm: past collaborators',
};
const SEQ_NEEDS_GAP = { cold_a: true, cold_b: true, cold_obs: true, nosite: false, warm: false };

const email = (id, contact, kind, step, subject, body, over) => Object.assign({
  id, channel: 'email', kind, contactId: contact.id, contactEmail: contact.email,
  campaign: 'launch', step, subject, body, status: 'scheduled',
  scheduledAt: null, sentAt: null, url: null, error: null,
  createdAt: NOW - 2 * D, editedAt: null, reviewedAt: null, provider: 'cloudflare',
}, over || {});

const msgs = [];
// scheduled, in send order — the first two are due now
msgs.push(email(7001, C(0), 'first', 0, 'corroof.com', fill(STEP_BODIES.cold_obs.first.join('\n'), C(0)), { scheduledAt: NOW - 600, createdAt: NOW - 2 * D }));
msgs.push(email(7002, C(1), 'first', 0, 'berniesplumbing.com', fill(STEP_BODIES.cold_obs.first.join('\n'), C(1)), { scheduledAt: NOW - 300, createdAt: NOW - 2 * D }));
msgs.push(email(7003, C(2), 'first', 0, 'Vibe contracting', fill(STEP_BODIES.cold_a.first.join('\n'), C(2)), { scheduledAt: NOW + 1500, createdAt: NOW - 2 * D }));
msgs.push(email(7004, C(3), 'first', 0, 'Vibe contracting for sugarwolfbakery.com', fill(STEP_BODIES.cold_b.first.join('\n'), C(3)), { scheduledAt: NOW + 2700, createdAt: NOW - 2 * D }));
msgs.push(email(7005, C(4), 'followup_1', 1, 'harborpestcontrol.com', fill(STEP_BODIES.cold_obs.followup_1.join('\n'), C(4)), { scheduledAt: NOW + 3900, createdAt: NOW - 26 * H }));
msgs.push(email(7006, C(10), 'first', 0, 'pinecrestlandscaping.com', fill(STEP_BODIES.cold_obs.first.join('\n'), C(10)), { scheduledAt: NOW + 86400 + 5400, createdAt: NOW - 26 * H }));
msgs.push(email(7007, C(44), 'first', 0, 'A website for Sunrise Window Cleaning', fill(STEP_BODIES.nosite.first.join('\n'), C(44)), { scheduledAt: NOW + 2 * D + 3600, createdAt: NOW - 26 * H }));
msgs.push(email(7008, C(6), 'followup_2', 2, 'sunsetsewing.com', fill(STEP_BODIES.cold_obs.followup_2.join('\n'), C(6)), { scheduledAt: NOW + 2 * D + 86400, createdAt: NOW - 4 * D }));
msgs.push(email(7009, C(12), 'first', 0, 'brightpathdental.com', fill(STEP_BODIES.cold_obs.first.join('\n'), C(12)), { scheduledAt: NOW + 3 * D, createdAt: NOW - 26 * H, reviewedAt: NOW - 20 * H }));
msgs.push(email(7010, C(14), 'first', 0, 'Vibe contracting', fill(STEP_BODIES.cold_a.first.join('\n'), C(14)), { scheduledAt: NOW + 3 * D + 7200, createdAt: NOW - 26 * H }));
// sent, on the old send days
const SENT_AT = [NOW - 14 * D - 20 * H, NOW - 14 * D - 16 * H, NOW - 13 * D - 22 * H, NOW - 13 * D - 18 * H, NOW - 12 * D - 21 * H, NOW - 12 * D - 15 * H];
const SENT_IDX = [30, 55, 80, 105, 130, 160];
const SENT_SEQ = [['cold_obs', 'first'], ['cold_a', 'first'], ['cold_obs', 'followup_1'], ['cold_b', 'first'], ['cold_obs', 'first'], ['cold_a', 'followup_1']];
for (let i = 0; i < 6; i++) {
  const [seq, stepKind] = SENT_SEQ[i];
  const c = C(SENT_IDX[i]);
  msgs.push(email(7011 + i, c, stepKind, STEP_DAY[stepKind], fill(STEP_SUBJECT[seq][stepKind], c), fill(STEP_BODIES[seq][stepKind].join('\n'), c), {
    status: 'sent', scheduledAt: SENT_AT[i] - 600, sentAt: SENT_AT[i], createdAt: SENT_AT[i] - 3 * D, provider: 'cloudflare',
  }));
}
msgs.push(email(7017, C(15), 'first', 0, 'meadowlarkfarmstand.com', fill(STEP_BODIES.cold_obs.first.join('\n'), C(15)), {
  status: 'failed', scheduledAt: NOW - 13 * D - 10 * H, error: 'cloudflare: 550 5.1.1 the recipient rejected the message', createdAt: NOW - 4 * D,
}));
msgs.push(email(7018, C(22), 'first', 0, 'northstarhvac.com', fill(STEP_BODIES.cold_obs.first.join('\n'), C(22)), { status: 'cancelled', scheduledAt: NOW + 5 * D, createdAt: NOW - 3 * D }));
msgs.push(email(7019, C(48), 'followup_1', 1, 'quailrunestate.com', fill(STEP_BODIES.cold_obs.followup_1.join('\n'), C(48)), { status: 'cancelled', scheduledAt: NOW + 6 * D, createdAt: NOW - 8 * D }));

// posts: three scheduled drafts of the current cycle all open the same way
const post = (id, channel, step, body, over) => Object.assign({
  id, channel, kind: 'auto', contactId: null, contactEmail: null, campaign: 'auto', step,
  subject: null, body, status: 'scheduled', scheduledAt: null, sentAt: null,
  url: null, error: null, createdAt: NOW - 30 * H, editedAt: null, reviewedAt: null, provider: null,
}, over || {});
const X1 = 'Vibe contracting is how a two-person shop ships a website change without a retainer. You describe it, approve a preview, and it goes live. No ticket queue, no monthly fee.';
const X2 = 'Vibe contracting is the short version of "just get it done": say what you need, check the preview, say yes. Priced by the minute, not the package.';
const LI1 = 'Vibe contracting is how small businesses stop waiting on a developer for small website changes.\n\nYou describe the change, a preview shows exactly what will move, and it goes live when you approve it. No retainer, no quote, no ticket queue.\n\nIt is billed by the second at $100 an hour, so a one-minute fix costs about $1.67. Most jobs finish under ten dollars.\n\nIf your site needs a small change this week, reply here or ask through the portal.';
msgs.push(post(7101, 'x', 0, X1, { scheduledAt: Date.parse('2026-11-21T10:00:00+03:00') / 1000 }));
msgs.push(post(7102, 'linkedin', 1, LI1, { scheduledAt: Date.parse('2026-11-24T10:00:00+03:00') / 1000 }));
msgs.push(post(7103, 'x', 2, X2, { scheduledAt: Date.parse('2026-11-26T10:00:00+03:00') / 1000 }));
const PUB = [
  ['x', 'A client asked for a pricing page at 9pm. By 9:20 it was live. That is vibe contracting: describe it, approve the preview, it ships.', NOW - 9 * D - 5 * H, 'https://x.com/malipetek/status/1991000000000000001'],
  ['linkedin', 'Most small businesses do not need a developer on retainer. They need someone who answers when the website needs a small change. Vibe contracting is that: describe it, approve the preview, it ships. Billed by the second.', NOW - 7 * D - 4 * H, 'https://www.linkedin.com/feed/update/urn:li:activity:7260000000000000001/'],
  ['x', 'The preview-before-publish step is the part people skip and regret. With vibe contracting you see exactly what changes before it goes live.', NOW - 4 * D - 6 * H, 'https://x.com/malipetek/status/1991000000000000002'],
  ['x', 'Billed by the second means a one-minute fix costs about $1.67. No quotes, no minimums, no retainers.', NOW - 2 * D - 7 * H, 'https://x.com/malipetek/status/1991000000000000003'],
  ['linkedin', 'A website that only gets looked at twice a year still needs changes twice a year. Small jobs, billed by the minute, no account manager in between.', NOW - 1 * D - 3 * H, 'https://www.linkedin.com/feed/update/urn:li:activity:7260000000000000002/'],
];
for (let i = 0; i < PUB.length; i++) {
  const [channel, body, sentAt, url] = PUB[i];
  msgs.push(post(7110 + i, channel, i % 3, body, { status: 'sent', scheduledAt: sentAt - 3600, sentAt, url, createdAt: sentAt - 3 * D, provider: 'publisher' }));
}
msgs.push(post(7115, 'x', 0, 'Weekend websites get the shortest queues. Vibe contracting is how a request on Friday still ships on Friday.', {
  status: 'failed', scheduledAt: NOW - 1 * D - 8 * H, error: 'publisher: the X composer did not open — the browser session may be signed out', createdAt: NOW - 3 * D,
}));

/* —— stats: 19 day rows so the Nov 2–6 send days show; 14 would end Nov 20 —— */
const SENT_DAYS = { 2: 64, 3: 65, 4: 63, 5: 66, 6: 62 };
const BOUNCE_DAYS = { 2: 3, 3: 3, 4: 2, 5: 3, 6: 2 };
const OPTOUT_DAYS = { 3: 1, 5: 1, 8: 1, 12: 1, 15: 1, 18: 1 };
const PUBLISHED_DAYS = { 11: 1, 13: 1, 16: 1, 18: 1, 19: 1 };
const statDays = [];
for (let d = 2; d <= 20; d++) {
  statDays.push({
    day: localDay(d),
    sent: SENT_DAYS[d] || (d === 20 ? 1 : 0),
    reply: 0,
    bounce: BOUNCE_DAYS[d] || 0,
    opt_out: OPTOUT_DAYS[d] || 0,
    complaint: 0,
    published: PUBLISHED_DAYS[d] || 0,
  });
}
statDays.reverse(); // newest first, like the endpoint

const OPT_OUT_TEXT = ['no thanks', 'please remove me from your list', 'not interested, thanks', 'unsubscribe', 'stop emailing me', 'we already have someone for this'];
const OPT_OUT_CONTACTS = [C(3), C(8), C(21), C(36), C(52), C(77)];
const replies = [
  {
    id: 5999,
    kind: 'reply',
    text: 'Hi Muhammet, yes please send over the details for the site change. We need the booking page updated before the holidays.',
    at: NOW - 2 * D - 4 * H,
    contact: { id: C(9).id, email: C(9).email, name: C(9).name, business: C(9).business, site: C(9).site, status: 'contacted' },
  },
  ...OPT_OUT_CONTACTS.map((c, i) => ({
    id: 6000 + i,
    kind: 'opt_out',
    text: OPT_OUT_TEXT[i],
    at: NOW - (3 + i * 2.7) * D - (i * 5 + 2) * H,
    contact: { id: c.id, email: c.email, name: c.name, business: c.business, site: c.site, status: 'opted_out' },
  })),
];

const events = [
  { id: 9100, kind: 'sent', detail: 'cold_obs step 0 via cloudflare', email: 'mike@corroof.com', createdAt: NOW - 3000 },
  { id: 9099, kind: 'auto_resumed', detail: 'paused since 6 Nov, cap ramps from 20/day', email: null, createdAt: NOW - 3600 },
  { id: 9098, kind: 'auto_approved', detail: 'x post held 24h, released to its slot', email: null, createdAt: NOW - 8100 },
  { id: 9097, kind: 'auto_approved', detail: 'linkedin post held 24h, released to its slot', email: null, createdAt: NOW - 8800 },
  { id: 9096, kind: 'dmarc_report', detail: 'google.com aggregate report: 312 messages, 0% spam', email: null, createdAt: NOW - 20000 },
  { id: 9095, kind: 'opt_out', detail: 'reply: we already have someone for this', email: 'dot@copperstatecleaners.com', createdAt: NOW - 57000 },
  { id: 9094, kind: 'bounce', detail: '550 5.1.1 user unknown', email: 'info@longgone-example.com', createdAt: NOW - 90000 },
  { id: 9093, kind: 'dmarc_report', detail: 'outlook.com aggregate report: 96 messages, 0% spam', email: null, createdAt: NOW - 150000 },
  { id: 9092, kind: 'opt_out', detail: 'reply: unsubscribe', email: 'contact@drifthomebrew.com', createdAt: NOW - 210000 },
  { id: 9091, kind: 'bounce', detail: '550 5.4.1 recipient address rejected', email: 'webmaster@oldsite-example.net', createdAt: NOW - 300000 },
  { id: 9090, kind: 'sent', detail: 'cold_a step 0 via cloudflare', email: 'roy@valleyair.com', createdAt: NOW - 14 * D - 5 * H },
  { id: 9089, kind: 'bounce', detail: '550 5.1.1 user unknown', email: 'sales@closed-example.com', createdAt: NOW - 14 * D - 4 * H },
  { id: 9088, kind: 'opt_out', detail: 'reply: no thanks', email: 'frontdesk@shuttered-example.com', createdAt: NOW - 9 * D - 3 * H },
  { id: 9087, kind: 'sent', detail: 'cold_obs step 1 via cloudflare', email: 'tess@sweetpeaevents.com', createdAt: NOW - 12 * D - 6 * H },
];

const overview = {
  settings,
  sender: 'hello@ptechsolutions.net',
  inbox: 'hello',
  bound: true,
  senderState: { provider: 'cloudflare', ready: true },
  providers: { cloudflare: true, ses: false },
  health: { sent: 63, bounces: 2, complaints: 0, bounceRate: 2 / 63, complaintRate: 0, trip: null, maxBounceRate: 0.04, maxComplaintRate: 0.002 },
  postsAwaiting: 0,
  pulse: {
    lastSentAt: localDay(20) + 11 * H,
    nextEmailAt: NOW + 1500,
    lastPublishedAt: NOW - D - 3 * H,
    lastPublishedChannel: 'linkedin',
    nextPostAt: Date.parse('2026-11-21T10:00:00+03:00') / 1000,
    nextPostChannel: 'x',
    postsQueued: 3,
    postsFailed: 1,
    lastObservedAt: NOW - 3 * H,
  },
  window: { open: true },
  today: 1,
  autoResume: { enabled: true, autoPausedAt: null, resumesAfter: null, resumedAt: NOW - H, cap: 20 },
  observe: { pending: 2490, observed: 39, withGap: 14, byKind: { none: 20, no_description: 6, old_copyright: 8, unreachable: 5 } },
  domains: { checked: 120, undeliverable: 0 },
  counts: {
    contacts: { new: 0, queued: 2529, contacted: 300, replied: 0, opted_out: 6, bounced: 13, paused: 4 },
    messages: { draft: 0, scheduled: 8189, sending: 0, sent: 325, failed: 1, cancelled: 38 },
  },
  due: { email: 10, x: 0, linkedin: 0 },
  nextAt: NOW + 300,
  events,
  sequences: ['cold_a', 'cold_b', 'cold_obs', 'nosite', 'warm'].map((key) => ({
    key,
    label: SEQ_LABEL[key],
    needsGap: SEQ_NEEDS_GAP[key],
    stats: key === 'cold_a' || key === 'cold_b'
      ? { sent: 160, replies: 0, optedOut: 0, bounced: 0 }
      : { sent: 0, replies: 0, optedOut: 0, bounced: 0 },
  })),
};

const SOURCES = [
  { source: 'first-import', contacts: 2838, queued: 2515, reached: 319, replied: 0, bounced: 13, optedOut: 6, complaints: 0, firstAt: NOW - 45 * D },
  { source: 'osm-co-mail-only', contacts: 14, queued: 14, reached: 0, replied: 0, bounced: 0, optedOut: 0, complaints: 0, firstAt: NOW - 4 * D },
];

const DEEPSEEK = {
  ok: true, bridge: true, chat: true, deepseek: true, engine: 'deepseek',
  text: 'Çabuk kahverengi tilki tembel köpeğin üzerinden atlar.',
  fallback: { text: 'Çabuk kahverengi tilki tembel köpeğin üzerinden atlıyor.', error: null },
  ms: 743,
};
/* —— routing —— */

const TOTALS = { '': 2852, new: 0, queued: 2529, contacted: 300, replied: 0, opted_out: 6, bounced: 13, paused: 4 };

const contactsPage = (q) => {
  const status = q.get('status') || '';
  const query = (q.get('q') || '').trim().toLowerCase();
  const source = q.get('source') || '';
  const offset = Math.max(0, Number(q.get('offset')) || 0);
  let rows = contacts;
  if (status) rows = rows.filter((c) => c.status === status);
  if (query) rows = rows.filter((c) => [c.email, c.name, c.business, c.site].some((v) => (v || '').toLowerCase().includes(query)));
  if (source === '(none)') rows = rows.filter((c) => !c.sourceKind);
  else if (source) rows = rows.filter((c) => c.sourceKind === source);
  const total = query || source ? rows.length : (TOTALS[status] ?? rows.length);
  return { contacts: rows.slice(offset, offset + 200), total, offset, page: 200 };
};

const messagesPage = (q) => {
  const status = q.get('status') || '';
  const channel = q.get('channel') || '';
  const next = q.get('order') === 'next';
  let rows = msgs;
  if (status) rows = rows.filter((m) => m.status === status);
  if (channel) rows = rows.filter((m) => m.channel === channel);
  const key = (m) => (m.scheduledAt ?? m.createdAt);
  rows = [...rows].sort((a, b) => (next ? key(a) - key(b) : key(b) - key(a)) || (next ? a.id - b.id : b.id - a.id));
  return { messages: rows.slice(0, 200) };
};

const contactEvents = (c) => [
  { id: c.id * 10 + 5, messageId: null, kind: 'observed', detail: c.gap ? 'gap: ' + c.gap : 'site clean', createdAt: c.updatedAt },
  { id: c.id * 10 + 4, messageId: null, kind: 'queued', detail: 'first-import → cold_obs', createdAt: c.createdAt + 3600 },
  { id: c.id * 10 + 3, messageId: null, kind: 'domain_checked', detail: 'mx ok', createdAt: c.createdAt + 1800 },
];

const contactDetail = (id) => {
  const c = byId(id);
  if (!c) return { error: 'not_found' };
  const list = msgs.filter((m) => m.contactId === id);
  return {
    contact: c,
    messages: list,
    events: contactEvents(c),
  };
};

const messageDetail = (id) => {
  const m = msgs.find((x) => x.id === id);
  if (!m) return { error: 'not_found' };
  const c = m.contactId ? byId(m.contactId) : null;
  let preview;
  if (m.channel === 'email') {
    preview = {
      from: 'Muhammet Ali Petek <hello@ptechsolutions.net>',
      replyTo: 'hello@ptechsolutions.net',
      to: m.contactEmail,
      subject: m.subject,
      text: m.body + FOOTER,
      image: m.step === 0 ? 'https://ptechsolutions.net/email/conveyor.gif' : null,
      headers: {
        'List-Unsubscribe': '<https://ptechsolutions.net/api/marketing/u/' + id + '/9f8e7d6c5b4a3210>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      provider: m.provider || 'cloudflare',
    };
  } else {
    preview = { checks: null, length: m.body.length, max: m.channel === 'x' ? 280 : 3000 };
  }
  return {
    message: m,
    contact: c,
    preview,
    events: [
      { id: id * 10 + 2, kind: m.status === 'sent' ? 'sent' : m.status, detail: m.status === 'sent' ? 'via ' + (m.provider || 'cloudflare') : null, createdAt: m.sentAt || m.scheduledAt || m.createdAt },
      { id: id * 10 + 1, kind: 'queued', detail: 'campaign ' + m.campaign, createdAt: m.createdAt },
    ],
  };
};

const seqPreview = (sequence) => {
  const c = C(0); // corroof: has an observation, so the specific versions show
  const steps = ['first', 'followup_1', 'followup_2'].map((kind) => ({
    kind,
    day: STEP_DAY[kind],
    subject: fill(STEP_SUBJECT[sequence][kind], c),
    body: fill(STEP_BODIES[sequence][kind].join('\n'), c),
    plain: null,
    usesPlain: false,
  }));
  return { sequence, label: SEQ_LABEL[sequence], contact: c, footer: FOOTER, steps };
};

const projectBy = (id) => PROJECTS.find((p) => String(p.id) === String(id));

const RECIPIENTS = {
  'p-acme': [
    { userId: 'u-dana', email: 'dana@acmebakery.com', name: 'Dana Ruiz', memberType: 'client' },
    { userId: 'u-lena', email: 'lena@sugarwolf.com', name: 'Lena Wolf', memberType: 'client' },
    { userId: 'u-dev', email: 'dev@ptech.dev', name: 'Sam Chen', memberType: 'trusted_developer' },
  ],
  'p-iron': [{ userId: 'u-vic', email: 'vic@ironwoodautorepair.com', name: 'Vic Marlow', memberType: 'client' }],
  'p-ptech': [
    { userId: 'u-dana', email: 'dana@acmebakery.com', name: 'Dana Ruiz', memberType: 'client' },
    { userId: 'u-dev', email: 'dev@ptech.dev', name: 'Sam Chen', memberType: 'trusted_developer' },
  ],
};

const MEMBERSHIPS = {
  'p-acme': { ownerUserId: 'u-ali', memberships: [{ userId: 'u-dev', email: 'dev@ptech.dev', name: 'Sam Chen', memberType: 'trusted_developer', createdAt: NOW - 40 * D }], clients: [{ id: 'u-dana', email: 'dana@acmebakery.com', name: 'Dana Ruiz' }, { id: 'u-lena', email: 'lena@sugarwolf.com', name: 'Lena Wolf' }] },
  'p-iron': { ownerUserId: 'u-ali', memberships: [], clients: [{ id: 'u-vic', email: 'vic@ironwoodautorepair.com', name: 'Vic Marlow' }] },
  'p-ptech': { ownerUserId: 'u-ali', memberships: [{ userId: 'u-dev', email: 'dev@ptech.dev', name: 'Sam Chen', memberType: 'trusted_developer', createdAt: NOW - 100 * D }], clients: [{ id: 'u-dana', email: 'dana@acmebakery.com', name: 'Dana Ruiz' }] },
  'p-mali': { ownerUserId: 'u-ali', memberships: [], clients: [] },
};

const SECRETS = {
  'p-acme': [{ name: 'CLOUDFLARE_API_TOKEN' }, { name: 'FORMSPREE_ID' }],
  'p-iron': [{ name: 'ASC_PRIVATE_KEY' }],
};

const INTEGRATIONS = {
  'p-acme': { solutions: ['web'], integrations: [] },
  'p-iron': { solutions: ['mobile-ios', 'app-release'], integrations: [
    { id: 'app-store-connect', label: 'App Store Connect', required: true, connected: false, missing: ['ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_PRIVATE_KEY'], verifiedAt: NOW - 10 * D, verifyError: '401 Unauthorized: the key id does not exist on this issuer' },
    { id: 'google-play', label: 'Google Play Console', required: true, connected: false, missing: ['PLAY_SERVICE_ACCOUNT_JSON'], verifiedAt: null, verifyError: null },
  ] },
  'p-ptech': { solutions: ['web', 'ai-workspace'], integrations: [] },
  'p-mali': { solutions: ['web'], integrations: [] },
};

/* —— Where it goes live (GET /admin/projects/:id/cloudflare) —— */

const CLOUDFLARE = {
  'p-acme': {
    connected: true, via: 'oauth', connectionId: 7, accountId: 'ac1acme00000000000000000000000aa',
    connections: [{ id: 7, email: 'dana@acmebakery.com', accounts: [{ id: 'ac1acme00000000000000000000000aa', name: "Dana's account" }] }],
    owner: 'dana@acmebakery.com',
    projectRepo: 'PTechGroup/acme-bakery',
    detected: null,
    pages: { ok: true, items: [{ name: 'acme-bakery', subdomain: 'acme-bakery.pages.dev', productionBranch: 'main', domains: ['acmebakery.com'], source: null }] },
    workers: { ok: true, items: [{ name: 'acme-mailer', modifiedOn: '2026-11-18T09:12:00Z' }, { name: 'petekkoleji-mailer', modifiedOn: '2026-11-20T10:00:00Z' }] },
    domains: { ok: true, items: [
      { host: 'acmebakery.com', kind: 'pages', name: 'acme-bakery', via: 'CNAME acme-bakery.pages.dev' },
      { host: 'www.acmebakery.com', kind: 'dns', name: 'acme-bakery.pages.dev', via: 'CNAME acme-bakery.pages.dev (proxied)' },
    ] },
    target: { provider: 'cloudflare', kind: 'pages', name: 'acme-bakery', productionBranch: 'main', builds: 'fleet', connectionId: 7, accountId: 'ac1acme00000000000000000000000aa' },
  },
  'p-ptech': {
    connected: true, via: 'oauth', connectionId: 3, accountId: 'cf0ptech00000000000000000000000bb',
    connections: [{ id: 3, email: 'ali@malipetek.dev', accounts: [{ id: 'cf0ptech00000000000000000000000bb', name: 'PTech' }] }],
    owner: 'ali@malipetek.dev',
    projectRepo: 'PTechGroup/ptechsolutions',
    detected: { provider: 'cloudflare', kind: 'pages', name: 'ptechsolutions', productionBranch: 'main', builds: 'provider' },
    pages: { ok: true, items: [{ name: 'ptechsolutions', subdomain: 'ptechsolutions.pages.dev', productionBranch: 'main', domains: ['ptechsolutions.net'], source: { type: 'github', repo: 'PTechGroup/ptechsolutions', productionBranch: 'main', previews: true } }] },
    workers: { ok: true, items: [{ name: 'ptech-portal', modifiedOn: '2026-11-24T14:30:00Z' }] },
    domains: { ok: true, items: [
      { host: 'ptechsolutions.net', kind: 'pages', name: 'ptechsolutions', via: 'CNAME ptechsolutions.pages.dev' },
      { host: 'portal.ptechsolutions.net', kind: 'workers', name: 'ptech-portal', via: 'route portal.ptechsolutions.net/*' },
    ] },
    target: { provider: 'cloudflare', kind: 'workers', name: 'ptech-portal', productionBranch: 'main', builds: 'fleet', connectionId: 3, accountId: 'cf0ptech00000000000000000000000bb' },
  },
  'p-mali': {
    connected: true, via: 'oauth', connectionId: 3, accountId: 'cf0ptech00000000000000000000000bb',
    connections: [{ id: 3, email: 'ali@malipetek.dev', accounts: [{ id: 'cf0ptech00000000000000000000000bb', name: 'PTech' }] }],
    owner: 'ali@malipetek.dev',
    projectRepo: 'malipetek/malipetek.github.io',
    detected: { provider: 'cloudflare', kind: 'pages', name: 'malipetek-dev', productionBranch: 'master', builds: 'provider' },
    pages: { ok: true, items: [{ name: 'malipetek-dev', subdomain: 'malipetek-dev.pages.dev', productionBranch: 'master', domains: ['malipetek.dev'], source: { type: 'github', repo: 'malipetek/malipetek.github.io', productionBranch: 'master', previews: true } }] },
    workers: { ok: true, items: [] },
    domains: { ok: true, items: [{ host: 'malipetek.dev', kind: 'pages', name: 'malipetek-dev', via: 'CNAME malipetek-dev.pages.dev' }] },
    target: { provider: 'cloudflare', kind: 'pages', name: 'malipetek-dev', productionBranch: 'master', builds: 'provider', connectionId: 3, accountId: 'cf0ptech00000000000000000000000bb' },
  },
  'p-iron': { connected: false, needsOwner: false, lapsed: false, connections: [], owner: 'vic@ironwoodautorepair.com', pages: null, workers: null, domains: null, target: null },
};

const CREDENTIAL_ACCESS = {
  'p-acme': [{ runId: 501, nodeId: 'malipeteks-MacBook-Pro', integrations: ['cloudflare'], at: NOW - 600 }],
};

const SEARCH_HITS = [
  { id: 12, snippet: 'Update the catering menu and photos' },
  { id: 10, snippet: 'Homepage takes six seconds on a phone' },
  { id: 18, snippet: 'Fix the cookie banner overlap' },
];

const stepsFor = (runId, after) => {
  const detail = Object.values(DETAIL).find((d) => d.runs?.some((r) => r.id === Number(runId)));
  const run = detail?.runs?.find((r) => r.id === Number(runId));
  if (!run) return { steps: [], live: false };
  const all = detail.steps ?? [];
  return { steps: all.filter((s) => s.seq > after), live: detail.stepsLive === true };
};

export const api = async (method, url, body) => {
  if (typeof window !== 'undefined') window.__calls?.push({ method, url, body });
  const u = new URL(url, 'http://preview');
  const p = u.pathname;
  const q = u.searchParams;

  if (method !== 'GET') {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (p === '/admin/marketing/run') return { sent: 10, failed: 0 };
    if (p === '/admin/marketing/contacts/import') return { added: 0, queued: 0, emails: 0, paused: 0, skipped: [] };
    if (p === '/admin/work') return { ok: true, id: 21 };
    if (p === '/admin/marketing/messages/rerender') return { ok: true, moved: 0 };
    const reveal = p.match(/^\/admin\/projects\/[^/]+\/secrets\/[^/]+\/reveal$/);
    if (reveal) return { ok: true, value: 'synthetic-preview-value' };
    return { ok: true };
  }

  if (p === '/portal/me') {
    return {
      user: { id: 'u-ali', name: 'Ali Petek', email: 'ali@malipetek.dev', role: 'admin' },
      access: { superAdmin: true, canUseWorkbench: true, developerProjectIds: [] },
    };
  }
  if (p === '/admin/tickets') return { tickets: TICKETS };
  if (p === '/admin/projects') return { projects: PROJECTS };
  if (p === '/admin/runs') return RUNS;
  if (p === '/admin/clients') return { clients: CLIENTS, total: USAGE_TOTAL };
  if (p === '/admin/nodes') return { nodes: NODES };
  if (p === '/admin/queue') return { queue: QUEUE };
  if (p === '/admin/settings') return { settings: SETTINGS, catalog: CATALOG };
  if (p === '/admin/health') return HEALTH;
  if (p === '/admin/health/deepseek') return DEEPSEEK;
  if (p === '/admin/i18n') return I18N;
  if (p === '/admin/search') return { hits: SEARCH_HITS };

  const tm = p.match(/^\/admin\/tickets\/(\d+)$/);
  if (tm) {
    const detail = ticketDetail(Number(tm[1]));
    const { __steps, __stepsLive, ...rest } = detail;
    return rest;
  }
  const sm = p.match(/^\/admin\/runs\/(\d+)\/steps$/);
  if (sm) return stepsFor(Number(sm[1]), Number(q.get('after') ?? 0));

  const pm = p.match(/^\/admin\/projects\/([^/]+)(\/.*)?$/);
  if (pm) {
    const id = decodeURIComponent(pm[1]);
    const sub = pm[2] ?? '';
    if (sub === '' || sub === '/') return { project: projectBy(id) };
    if (sub === '/recipients') return { recipients: RECIPIENTS[id] ?? [] };
    if (sub === '/memberships') return MEMBERSHIPS[id] ?? { ownerUserId: 'u-ali', memberships: [], clients: [] };
    if (sub === '/secrets') return { secrets: SECRETS[id] ?? [] };
    if (sub === '/integrations') return INTEGRATIONS[id] ?? { solutions: [], integrations: [] };
    if (sub === '/cloudflare') return CLOUDFLARE[id] ?? { connected: false, connections: [], owner: null, target: null };
    if (sub === '/credential-access') return { access: CREDENTIAL_ACCESS[id] ?? [] };
    if (sub === '/site/deploys') {
      const siteId = q.get('siteId');
      return { deploys: DEPLOYS[siteId] ?? Object.values(DEPLOYS).flat().filter((d) => d.project_id === id) };
    }
  }

  // Marketing desk (fixtures copied from marketing-preview.mjs).
  const cm = p.match(/^\/admin\/marketing\/contacts\/(\d+)$/);
  if (cm) return contactDetail(Number(cm[1]));
  const mm = p.match(/^\/admin\/marketing\/messages\/(\d+)$/);
  if (mm) return messageDetail(Number(mm[1]));
  if (p === '/admin/marketing') return overview;
  if (p === '/admin/marketing/contacts') return contactsPage(q);
  if (p === '/admin/marketing/stats') return { days: statDays, offsetMinutes: OFF / 60 };
  if (p === '/admin/marketing/replies') return { replies };
  if (p === '/admin/marketing/review') return reviewQueue(Math.max(1, Math.min(100, Number(q.get('limit')) || 50)));
  if (p === '/admin/marketing/sources') return { sources: SOURCES };
  if (p === '/admin/marketing/sequences/preview') return seqPreview(q.get('sequence') || 'cold_a');
  if (p === '/admin/marketing/messages') return messagesPage(q);

  // SEO desk.
  if (p === '/admin/seo/overview') return SEO_OVERVIEW;
  if (p === '/admin/seo/ranks') return SEO_RANKS;
  if (p === '/admin/seo/pages') return SEO_PAGES;
  if (p === '/admin/seo/findings') {
    const status = q.get('status') || 'open';
    const host = q.get('host') || '';
    let rows = SEO_FINDINGS.findings;
    if (status === 'open') rows = rows.filter((f) => !f.resolved_at);
    if (status === 'resolved') rows = rows.filter((f) => f.resolved_at);
    if (host) rows = rows.filter((f) => f.host === host);
    return { status, findings: rows, counts: SEO_FINDINGS.counts };
  }
  if (p === '/admin/seo/geo') return SEO_GEO;
  if (p === '/admin/seo/citations') return SEO_CITATIONS;

  const label = `GET ${url}`;
  if (typeof window !== 'undefined') window.__unknown?.push(label);
  console.warn(`[workbench-preview] Unknown API: ${label}`);
  return {};
};
