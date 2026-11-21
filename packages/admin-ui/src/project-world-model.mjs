/*
 * Pure model & isometric geometry for Admin ProjectWorld (M1 5-station topology).
 * Zero React dependencies so state derivation and projection math can be
 * tested directly with node:test.
 *
 * Station verdicts implemented from docs/admin-ui-refresh/02-isometric-review.md:
 *   - Keep:  request, agent, code, preview, hosting
 *   - Merge: domain + https → hosting (Live site)
 *   - Merge: deploy → preview (build/publish pipeline) & hosting (last published)
 *
 * Admin guarantees:
 *   - No browser HTTPS reachability probe (operator view never pings client sites).
 *   - Supports snake_case admin API aliases (repo_error, repo_wanted).
 *   - Computes operator ticket counts (needsYou, stalled > 45m) for agent/request.
 *   - Honest HTTPS verification: only verified on explicit https:// + ready site
 *     or an explicit ready ssl/https setup check.
 */

export const ISO_COS = Math.cos(Math.PI / 6); // cos(30deg) ≈ 0.8660254
export const ISO_SIN = 0.5; // sin(30deg)

export const DEFAULT_ISO = Object.freeze({
  scale: 48,
  originX: 300,
  originY: 66,
});

export const FLOOR_BOUNDS = Object.freeze({
  minX: 0.2,
  maxX: 6.8,
  minY: 0.2,
  maxY: 4.4,
});

export const OPEN_TICKET_STATUSES = new Set(['new', 'approved', 'in_progress', 'review']);
export const ACTIVE_TICKET_STATUSES = new Set(['in_progress', 'review']);
export const STALL_MS = 45 * 60 * 1000;

/** Pipeline order used for keyboard arrow traversal and the narrow route list. */
export const STATION_ORDER = Object.freeze(['request', 'agent', 'code', 'preview', 'hosting']);

/**
 * Isometric projection with 30° axes.
 * +x goes down-right, +y goes down-left, +z goes straight up.
 */
export function iso(x, y, z = 0, opts = DEFAULT_ISO) {
  const scale = Number.isFinite(opts?.scale) ? opts.scale : DEFAULT_ISO.scale;
  const originX = Number.isFinite(opts?.originX) ? opts.originX : DEFAULT_ISO.originX;
  const originY = Number.isFinite(opts?.originY) ? opts.originY : DEFAULT_ISO.originY;
  const nx = Number.isFinite(x) ? x : 0;
  const ny = Number.isFinite(y) ? y : 0;
  const nz = Number.isFinite(z) ? z : 0;
  return {
    x: round2(originX + (nx - ny) * ISO_COS * scale),
    y: round2(originY + (nx + ny) * ISO_SIN * scale - nz * scale),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Convert an array of 3D [x, y, z] points into an SVG polygon points string. */
export function isoPoints(points3d, opts = DEFAULT_ISO) {
  return points3d
    .map(([x, y, z = 0]) => {
      const p = iso(x, y, z, opts);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

/**
 * Project an axis-aligned 3D box from (x, y, z) with extents (dx, dy, dz)
 * into three visible isometric faces:
 *   - top   (z + dz, lightest tone)
 *   - left  (y + dy, front-left mid tone)
 *   - right (x + dx, front-right shadow tone)
 */
export function isoBox(x, y, z, dx, dy, dz, opts = DEFAULT_ISO) {
  const x1 = x + dx;
  const y1 = y + dy;
  const z1 = z + dz;
  return {
    top: isoPoints(
      [
        [x, y, z1],
        [x1, y, z1],
        [x1, y1, z1],
        [x, y1, z1],
      ],
      opts,
    ),
    left: isoPoints(
      [
        [x, y1, z1],
        [x1, y1, z1],
        [x1, y1, z],
        [x, y1, z],
      ],
      opts,
    ),
    right: isoPoints(
      [
        [x1, y, z1],
        [x1, y1, z1],
        [x1, y1, z],
        [x1, y, z],
      ],
      opts,
    ),
    base: isoPoints(
      [
        [x, y, z],
        [x1, y, z],
        [x1, y1, z],
        [x, y1, z],
      ],
      opts,
    ),
    centerTop: iso(x + dx / 2, y + dy / 2, z1, opts),
  };
}

/**
 * Translation helper: returns the translated string from t(key, vars) if
 * present, falling back to `english` (with {var} interpolation) whenever
 * t(key) returns the key itself.
 */
export function tx(t, key, english, vars) {
  if (typeof t === 'function') {
    const out = vars !== undefined ? t(key, vars) : t(key);
    if (typeof out === 'string' && out !== key && out.length > 0) {
      return out;
    }
  }
  if (!vars) return english;
  return String(english).replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/** Station grid coordinates arranged along crisp 30° axes (5 functional stations). */
export const STATION_POSITIONS = Object.freeze({
  hosting: { x: 1.3, y: 1.3, padHalf: 0.78 },
  preview: { x: 3.5, y: 1.3, padHalf: 0.68 },
  code: { x: 5.7, y: 1.3, padHalf: 0.68 },
  request: { x: 2.8, y: 3.4, padHalf: 0.66 },
  agent: { x: 5.3, y: 3.4, padHalf: 0.72 },
});

export const VISITOR_POS = Object.freeze({ x: 1.3, y: 2.75 });

/** Optional floor dot coordinates (kept exported for compatibility; omitted from M1 SVG). */
export function floorDots(stations = [], step = 0.5, opts = DEFAULT_ISO) {
  const dots = [];
  const activeZones = stations
    .filter((s) => s.state === 'active')
    .map((s) => {
      const pos = STATION_POSITIONS[s.key];
      const r = (pos?.padHalf ?? 0.7) + 0.18;
      return { key: s.key, x: s.x, y: s.y, r };
    });

  for (let gx = FLOOR_BOUNDS.minX + 0.2; gx <= FLOOR_BOUNDS.maxX - 0.1; gx = round2(gx + step)) {
    for (let gy = FLOOR_BOUNDS.minY + 0.2; gy <= FLOOR_BOUNDS.maxY - 0.1; gy = round2(gy + step)) {
      const hit = activeZones.find((z) => Math.abs(gx - z.x) <= z.r && Math.abs(gy - z.y) <= z.r);
      const p = iso(gx, gy, 0, opts);
      dots.push({
        id: `${gx}_${gy}`,
        gx,
        gy,
        x: p.x,
        y: p.y,
        active: Boolean(hit),
        stationKey: hit?.key ?? null,
      });
    }
  }
  return dots;
}

/* ————— site, repo, deploy & ticket inspection helpers ————— */

function pickSite(project, sites) {
  const list =
    Array.isArray(sites) && sites.length > 0
      ? sites
      : Array.isArray(project?.sites) && project.sites.length > 0
        ? project.sites
        : project?.site
          ? [project.site]
          : [];
  if (!list.length) return null;
  return list.find((s) => s?.isPrimary) ?? list.find((s) => s?.state === 'ready') ?? list[0] ?? null;
}

function cleanString(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function clip(text, max = 22) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function hostnameOf(raw) {
  const s = cleanString(raw);
  if (!s) return null;
  const stripped = s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return stripped || null;
}

function safeHref(raw) {
  const s = cleanString(raw);
  if (!s) return null;
  const ssh = /^git@([^:]+):(.+)$/.exec(s);
  const candidate = ssh ? `https://${ssh[1]}/${ssh[2]}` : /^https?:\/\//i.test(s) ? s : null;
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    return u.href.replace(/\.git\/?$/, '');
  } catch {
    return null;
  }
}

function extractAddress(site) {
  if (!site) return { raw: null, hostname: null, hasExplicitHttps: false, hasExplicitHttp: false };

  const urlCandidates = [
    cleanString(site.customDomain),
    cleanString(site.productionUrl),
    cleanString(site.cloudflare?.productionUrl),
    cleanString(site.url),
  ].filter(Boolean);

  const primaryUrl = urlCandidates[0] ?? null;
  const hasExplicitHttp = Boolean(primaryUrl && /^http:\/\//i.test(primaryUrl));
  const hasExplicitHttps = !hasExplicitHttp && urlCandidates.some((u) => /^https:\/\//i.test(u));

  const displayRaw =
    cleanString(site.customDomain) ??
    cleanString(site.domain) ??
    cleanString(site.hostname) ??
    cleanString(site.productionUrl) ??
    cleanString(site.cloudflare?.productionUrl) ??
    cleanString(site.url) ??
    cleanString(site.previewUrl) ??
    cleanString(site.cloudflare?.previewUrl) ??
    null;

  return {
    raw: primaryUrl ?? displayRaw,
    hostname: hostnameOf(displayRaw),
    hasExplicitHttps,
    hasExplicitHttp,
  };
}

function shortRepo(repo) {
  const s = cleanString(repo);
  if (!s) return null;
  return s
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

function normalizeTimestampMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) return asNum > 1e12 ? asNum : asNum * 1000;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatDeployTime(rawTime, nowMs) {
  const ts = normalizeTimestampMs(rawTime);
  if (ts === null) return null;
  const ref = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const diffSec = Math.max(0, Math.floor((ref - ts) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return `${diffDay}d ago`;
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function latestDeployOf(deploys) {
  if (!Array.isArray(deploys) || deploys.length === 0) return null;
  let best = deploys[0];
  let bestTs = normalizeTimestampMs(best?.created_at ?? best?.updated_at ?? best?.timestamp ?? best?.time);
  for (let i = 1; i < deploys.length; i++) {
    const d = deploys[i];
    const ts = normalizeTimestampMs(d?.created_at ?? d?.updated_at ?? d?.timestamp ?? d?.time);
    if (ts !== null && (bestTs === null || ts > bestTs)) {
      best = d;
      bestTs = ts;
    }
  }
  return best;
}

function filterProjectTickets(project, tickets) {
  if (!Array.isArray(tickets)) return [];
  const pid = project?.id;
  if (pid === null || pid === undefined) return tickets.filter(Boolean);
  return tickets.filter((tk) => {
    if (!tk) return false;
    if (tk.project_id === null || tk.project_id === undefined) return true;
    return String(tk.project_id) === String(pid);
  });
}

/**
 * Operator-only ticket counts computable from loaded tickets:
 *   - needsYou: status 'new' or 'review'
 *   - stalled:  status 'in_progress' with updated_at older than 45 min
 *               (null if tickets are not loaded, or if in_progress tickets lack updated_at)
 */
export function operatorTicketCounts(project, tickets, now) {
  if (!Array.isArray(tickets)) {
    return { needsYou: null, stalled: null, newCount: null, reviewCount: null };
  }
  const projectTickets = filterProjectTickets(project, tickets);
  const nowMs = normalizeTimestampMs(now) ?? Date.now();
  let newCount = 0;
  let reviewCount = 0;
  let inProgressTotal = 0;
  let inProgressTimed = 0;
  let stalledCount = 0;

  for (const tk of projectTickets) {
    if (tk.status === 'new') {
      newCount += 1;
    } else if (tk.status === 'review') {
      reviewCount += 1;
    } else if (tk.status === 'in_progress') {
      inProgressTotal += 1;
      const updatedMs = normalizeTimestampMs(tk.updated_at);
      if (updatedMs !== null) {
        inProgressTimed += 1;
        if (nowMs - updatedMs > STALL_MS) {
          stalledCount += 1;
        }
      }
    }
  }

  return {
    needsYou: newCount + reviewCount,
    stalled: inProgressTotal === 0 || inProgressTimed > 0 ? stalledCount : null,
    newCount,
    reviewCount,
  };
}

/* ————— setup check mapping (exact keys from worker/src/setup.ts + substrings) ————— */

// Merged 5-station mapping: domain/dns/email/https/ssl → hosting; deploy → preview.
const EXACT_CHECK_STATION = Object.freeze({
  domain: 'hosting',
  dns: 'hosting',
  email: 'hosting',
  mail: 'hosting',
  mx: 'hosting',
  https: 'hosting',
  ssl: 'hosting',
  tls: 'hosting',
  hosting: 'hosting',
  host: 'hosting',
  code: 'code',
  repo: 'code',
  github: 'code',
  preview: 'preview',
  deploy: 'preview',
});

function isHttpsCheck(check) {
  const key = typeof check?.key === 'string' ? check.key.toLowerCase() : '';
  const label = typeof check?.label === 'string' ? check.label.toLowerCase() : '';
  const re = /https|ssl|tls|(?:^|[^a-z])cert(?:ificate)?(?:$|[^a-z])/;
  return re.test(key) || re.test(label);
}

function isDomainCheck(check) {
  const key = typeof check?.key === 'string' ? check.key.toLowerCase() : '';
  const label = typeof check?.label === 'string' ? check.label.toLowerCase() : '';
  const re = /domain|dns|e-?mail|(?:^|[^a-z])mail(?:$|[^a-z])|(?:^|[^a-z])mx(?:$|[^a-z])/;
  return re.test(key) || re.test(label);
}

function matchCheckText(text) {
  if (!text) return null;
  if (/https|ssl|tls|(?:^|[^a-z])cert(?:ificate)?(?:$|[^a-z])/.test(text)) return 'hosting';
  if (/domain|dns|e-?mail|(?:^|[^a-z])mail(?:$|[^a-z])|(?:^|[^a-z])mx(?:$|[^a-z])/.test(text)) return 'hosting';
  if (/repo|github|(?:^|[^a-z])git(?:$|[^a-z])|(?:^|[^a-z])code(?:$|[^a-z])/.test(text)) return 'code';
  if (/preview|staging|deploy|publish/.test(text)) return 'preview';
  if (/hosting|(?:^|[^a-z])host(?:$|[^a-z])|cloudflare/.test(text)) return 'hosting';
  return null;
}

/**
 * Map a project.setup.checks entry onto its matching 5-station world key,
 * or null if the check does not correspond to a mapped infrastructure station.
 */
export function stationForCheck(check) {
  if (!check || typeof check !== 'object') return null;
  const key = typeof check.key === 'string' ? check.key.trim().toLowerCase() : '';
  const label = typeof check.label === 'string' ? check.label.trim().toLowerCase() : '';

  if (key && Object.prototype.hasOwnProperty.call(EXACT_CHECK_STATION, key)) {
    return EXACT_CHECK_STATION[key];
  }
  return matchCheckText(key) ?? matchCheckText(label);
}

function normalizeSetupChecks(project, t, nowMs) {
  const raw = project?.setup?.checks;
  const byStation = new Map();
  if (!Array.isArray(raw)) return byStation;

  for (const check of raw) {
    if (!check || typeof check !== 'object') continue;
    const state = typeof check.state === 'string' ? check.state.trim().toLowerCase() : '';
    if (!state || state === 'unknown') continue;

    const stationKey = stationForCheck(check);
    if (!stationKey) continue;

    const owner = check.owner === 'you' || check.owner === 'us' ? check.owner : null;
    const ownerLabel =
      owner === 'you'
        ? tx(t, 'world.check.owner.you', 'You')
        : owner === 'us'
          ? tx(t, 'world.check.owner.us', 'PTech')
          : null;
    const whoText = ownerLabel ? tx(t, 'world.check.who', 'Who: {who}', { who: ownerLabel }) : null;

    const rawTime =
      check.checked_at ?? check.checkedAt ?? check.at ?? check.updated_at ?? check.updatedAt ?? check.updated ?? null;
    const checkedAt = normalizeTimestampMs(rawTime);
    const rel = checkedAt !== null ? formatDeployTime(checkedAt, nowMs) : null;
    const checkedText = rel ? tx(t, 'world.check.checkedAt', 'Checked {time}', { time: rel }) : null;

    const normalized = {
      key: cleanString(check.key) ?? stationKey,
      label: cleanString(check.label) ?? cleanString(check.key) ?? stationKey,
      detail: cleanString(check.detail) ?? '',
      state,
      owner,
      ownerLabel,
      whoText,
      blocking: Boolean(check.blocking),
      checkedAt,
      checkedText,
    };

    if (!byStation.has(stationKey)) byStation.set(stationKey, []);
    byStation.get(stationKey).push(normalized);
  }

  return byStation;
}

function applyStationChecks(station, mappedChecks, t) {
  const checks = Array.isArray(mappedChecks) ? mappedChecks : [];
  if (checks.length === 0) {
    return { ...station, checks: [] };
  }

  const pendingCheck = checks.find((c) => c.state === 'pending');
  const readyHttpsCheck = checks.find((c) => c.state === 'ready' && isHttpsCheck(c));
  const readyDomainCheck = checks.find((c) => c.state === 'ready' && isDomainCheck(c));

  let { state, stateText, shortStatus, meta } = station;

  // Upgrade HTTPS metadata on hosting only on an explicit ready SSL/HTTPS check.
  if (station.key === 'hosting' && readyHttpsCheck && !meta?.httpsVerified) {
    meta = {
      ...meta,
      httpsVerified: true,
      httpsVerifiedByCheck: true,
      httpsText: tx(t, 'world.https.state.ok', 'Locked with HTTPS'),
    };
  }

  if (pendingCheck) {
    if (state !== 'bad' && state !== 'active') {
      const wasEmpty = state === 'off' || state === 'unknown';
      state = 'warn';
      if (wasEmpty && pendingCheck.label) {
        stateText = pendingCheck.label;
        shortStatus = clip(pendingCheck.label, 20);
      }
    }
  } else if (station.key === 'hosting' && readyDomainCheck && state === 'unknown') {
    state = 'ok';
    const nextAddr = readyDomainCheck.detail || tx(t, 'world.domain.state.checkReady', 'Domain ready');
    stateText = nextAddr;
    meta = { ...meta, addressText: nextAddr, verifiedByCheck: true };
  }

  return {
    ...station,
    state,
    stateText,
    shortStatus,
    meta,
    checks,
  };
}

/**
 * Derive the 5 functional world stations from real admin/portal project data.
 *
 * Returns an array of:
 *   { key, title, shortLabel, shortStatus, explain, state, stateText, x, y, meta, checks }
 * where state is one of: 'ok' | 'active' | 'warn' | 'bad' | 'off' | 'unknown'.
 * Only genuinely running/building processes use state === 'active'.
 */
export function stationsFor({ project = null, sites = [], tickets = undefined, deploys = null, t = (k) => k, now } = {}) {
  const site = pickSite(project, sites);
  const addr = extractAddress(site);
  const projectTickets = filterProjectTickets(project, tickets ?? []);
  const opCounts = operatorTicketCounts(project, tickets, now);
  const checksByStation = normalizeSetupChecks(project, t, now);
  const siteReady = site?.state === 'ready';
  const siteFailed = site?.state === 'failed';
  const siteBuilding = Boolean(site && !siteReady && !siteFailed);
  const previewDeploy = cleanString(site?.previewDeploy);
  const productionDeploy = cleanString(site?.productionDeploy);
  const previewAhead = Boolean(siteReady && previewDeploy && previewDeploy !== productionDeploy);
  const previewUrl = safeHref(site?.previewUrl) ?? safeHref(site?.cloudflare?.previewUrl);
  const liveUrl = safeHref(addr.raw) ?? (addr.hostname ? `https://${addr.hostname}` : null);
  const latestDeploy = latestDeployOf(deploys);
  const latestDeployStatus = latestDeploy ? String(latestDeploy.status ?? latestDeploy.state ?? '').toLowerCase() : '';
  const deployTime = latestDeploy
    ? formatDeployTime(
        latestDeploy.created_at ?? latestDeploy.updated_at ?? latestDeploy.timestamp ?? latestDeploy.time,
        now,
      )
    : null;
  const deployFailed = ['failed', 'error', 'canceled', 'cancelled'].includes(latestDeployStatus);
  const deployBuilding = ['building', 'running', 'deploying', 'pending', 'queued', 'in_progress'].includes(latestDeployStatus);
  const drift = unshippedPreview({ project, sites, deploys, tickets: tickets ?? [], t, now });

  // 1. Live site (hosting + domain + https merged)
  const isCloudflare = site?.host === 'cloudflare';
  const hostLabel = isCloudflare
    ? tx(t, 'world.hosting.host.cloudflare', 'Cloudflare (your account)')
    : tx(t, 'world.hosting.host.ptech', 'PTech hosting');

  const httpsVerified = Boolean(siteReady && addr.hasExplicitHttps);
  let httpsText;
  if (httpsVerified) {
    httpsText = tx(t, 'world.https.state.ok', 'Locked with HTTPS');
  } else if (!site) {
    httpsText = tx(t, 'world.https.state.noSite', 'Unknown — no live site yet');
  } else if (siteFailed) {
    httpsText = tx(t, 'world.https.state.failed', 'Unknown — site is not live');
  } else if (!siteReady) {
    httpsText = tx(t, 'world.https.state.waiting', 'Unknown — checked once live');
  } else if (addr.hasExplicitHttp) {
    httpsText = tx(t, 'world.https.state.http', 'Unknown — address is not HTTPS');
  } else {
    httpsText = tx(t, 'world.https.state.unverified', 'Unknown — HTTPS address not reported');
  }

  let hostingState = 'off';
  let addressText = tx(t, 'world.domain.state.off', 'Not connected yet');
  let hostingText = tx(t, 'world.hosting.state.none', 'No hosting set up yet');
  let hostingShort = tx(t, 'world.hosting.short.none', 'Not live');

  if (site) {
    if (siteFailed) {
      hostingState = 'bad';
      addressText = addr.hostname
        ? tx(t, 'world.domain.state.failedHost', 'Setup stopped for {host}', { host: addr.hostname })
        : tx(t, 'world.domain.state.failed', 'Address setup stopped');
      hostingText = tx(t, 'world.hosting.state.failed', '{host} — setup stopped', { host: hostLabel });
      hostingShort = tx(t, 'world.hosting.short.failed', 'Setup stopped');
    } else if (siteReady) {
      if (addr.hostname) {
        hostingState = 'ok';
        addressText = tx(t, 'world.domain.state.live', 'Live at {host}', { host: addr.hostname });
        hostingText = previewAhead
          ? tx(t, 'world.hosting.state.livePreview', 'Live at {addr} · {host} (preview ahead)', {
              addr: addr.hostname,
              host: hostLabel,
            })
          : tx(t, 'world.hosting.state.live', 'Live at {addr} · {host}', {
              addr: addr.hostname,
              host: hostLabel,
            });
        hostingShort = clip(addr.hostname, 22);
      } else {
        hostingState = 'unknown';
        addressText = tx(t, 'world.domain.state.missing', 'No web address reported yet');
        hostingText = tx(t, 'world.hosting.state.noAddr', 'On {host} — no web address reported yet', { host: hostLabel });
        hostingShort = tx(t, 'world.hosting.short.unknown', 'Address unknown');
      }
    } else {
      hostingState = 'active';
      addressText = addr.hostname
        ? tx(t, 'world.domain.state.settingUpHost', 'Setting up {host}', { host: addr.hostname })
        : tx(t, 'world.domain.state.settingUp', 'Setting up your web address');
      hostingText = tx(t, 'world.hosting.state.building', 'Setting up on {host}', { host: hostLabel });
      hostingShort = tx(t, 'world.hosting.short.building', 'Setting up…');
    }
  }

  // 2. Preview & publishing (preview + deploy merged)
  let previewState = 'off';
  let previewText = tx(t, 'world.preview.state.off', 'No preview yet');
  let previewShort = tx(t, 'world.preview.short.off', 'No preview');

  if (deployFailed) {
    previewState = 'bad';
    previewText = deployTime
      ? tx(t, 'world.deploy.state.failedAt', 'Last publish failed ({time})', { time: deployTime })
      : tx(t, 'world.deploy.state.failed', 'Last publish failed');
    previewShort = tx(t, 'world.preview.short.failed', 'Publish failed');
  } else if (deployBuilding) {
    previewState = 'active';
    previewText = tx(t, 'world.deploy.state.building', 'Publishing update now');
    previewShort = tx(t, 'world.preview.short.publishing', 'Publishing…');
  } else if (site && siteFailed) {
    previewState = 'bad';
    previewText = tx(t, 'world.preview.state.failed', 'Preview paused — site setup stopped');
    previewShort = tx(t, 'world.preview.short.paused', 'Paused');
  } else if (site && siteBuilding) {
    previewState = 'active';
    previewText = tx(t, 'world.preview.state.building', 'Setting up preview');
    previewShort = tx(t, 'world.preview.short.building', 'Building…');
  } else if (site && previewDeploy) {
    if (previewAhead) {
      previewState = 'warn';
      previewText = drift
        ? drift.text
        : tx(t, 'world.preview.state.ahead', 'A newer version is waiting to be published');
      previewShort = drift
        ? tx(t, 'world.preview.short.unshipped', '{n} unshipped', { n: drift.count })
        : tx(t, 'world.preview.short.ahead', 'Ready to publish');
    } else {
      previewState = 'ok';
      previewText = deployTime
        ? tx(t, 'world.preview.state.okAt', 'Matches live · published {time}', { time: deployTime })
        : tx(t, 'world.preview.state.ok', 'Matches your live site');
      previewShort = tx(t, 'world.preview.short.ok', 'Matches live');
    }
  }

  // 3. Code repository
  const repoSlug = shortRepo(project?.repo);
  const repoUrl = safeHref(project?.repo);
  const repoError = cleanString(project?.repoError) ?? cleanString(project?.repo_error);
  const repoWanted = Boolean(project?.repoWanted || project?.repo_wanted);
  let codeState = 'off';
  let codeText = tx(t, 'world.code.state.missing', 'Not connected yet');
  let codeShort = tx(t, 'world.code.short.missing', 'Not linked');
  if (repoError) {
    codeState = 'bad';
    codeText = tx(t, 'world.code.state.error', 'Connection problem — needs attention');
    codeShort = tx(t, 'world.code.short.error', 'Connection error');
  } else if (repoSlug) {
    codeState = 'ok';
    codeText = tx(t, 'world.code.state.connected', 'Connected: {repo}', { repo: repoSlug });
    codeShort = clip(repoSlug, 21);
  } else if (repoWanted) {
    codeState = 'active';
    codeText = tx(t, 'world.code.state.settingUp', 'Setting up your code repository');
    codeShort = tx(t, 'world.code.short.settingUp', 'Setting up…');
  } else if (project?.kind === 'new') {
    codeState = 'ok';
    codeText = tx(t, 'world.code.state.ptech', 'Kept by PTech');
    codeShort = tx(t, 'world.code.short.ptech', 'Kept by PTech');
  }

  // 4. Builder (agent + human review)
  const inProgressCount = projectTickets.filter((tk) => tk.status === 'in_progress').length;
  const inReviewCount = projectTickets.filter((tk) => tk.status === 'review').length;
  const workingCount = inProgressCount + inReviewCount;
  let agentState = 'off';
  let agentText = tx(t, 'world.agent.state.idle', 'Standing by — no active build');
  let agentShort = tx(t, 'world.agent.short.idle', 'Idle');
  if (workingCount > 0) {
    if (opCounts.stalled > 0) {
      agentState = 'bad';
      agentShort = tx(t, 'world.agent.short.stalled', '{n} stalled', { n: opCounts.stalled });
    } else if (inProgressCount > 0) {
      agentState = 'active';
      agentShort = tx(t, 'world.agent.short.building', 'Building {n}', { n: inProgressCount });
    } else {
      agentState = 'warn';
      agentShort = tx(t, 'world.agent.short.review', '{n} in review', { n: inReviewCount });
    }
    if (inProgressCount > 0 && inReviewCount > 0) {
      agentText = tx(
        t,
        'world.agent.state.both',
        'Working on {count} requests ({building} building, {review} in review)',
        { count: workingCount, building: inProgressCount, review: inReviewCount },
      );
    } else if (inReviewCount > 0) {
      agentText =
        inReviewCount === 1
          ? tx(t, 'world.agent.state.reviewOne', '1 request in human review')
          : tx(t, 'world.agent.state.reviewMany', '{count} requests in human review', { count: inReviewCount });
    } else {
      agentText =
        inProgressCount === 1
          ? tx(t, 'world.agent.state.buildOne', 'Building 1 request')
          : tx(t, 'world.agent.state.buildMany', 'Building {count} requests', { count: inProgressCount });
    }
  }

  // 5. Requests inbox
  const openCount = projectTickets.filter((tk) => OPEN_TICKET_STATUSES.has(tk.status)).length;
  const needsCount = opCounts.needsYou ?? 0;
  const requestState = needsCount > 0 ? 'warn' : openCount > 0 ? 'ok' : 'off';
  const requestText =
    openCount === 0
      ? tx(t, 'world.request.state.none', 'No open requests')
      : openCount === 1
        ? tx(t, 'world.request.state.one', '1 open request')
        : tx(t, 'world.request.state.many', '{count} open requests', { count: openCount });
  const requestShort =
    needsCount > 0
      ? tx(t, 'world.request.short.needs', '{n} {verb} you', { n: needsCount, verb: needsCount === 1 ? 'needs' : 'need' })
      : openCount > 0
        ? tx(t, 'world.request.short.open', '{n} open', { n: openCount })
        : tx(t, 'world.request.short.none', 'Clear');

  const baseStations = [
    {
      key: 'request',
      title: tx(t, 'world.request.title', 'Requests'),
      shortLabel: tx(t, 'world.request.short', 'Requests'),
      shortStatus: requestShort,
      explain: tx(
        t,
        'world.request.explain',
        'Open client and internal work waiting for triage, build, or review.',
      ),
      state: requestState,
      stateText: requestText,
      x: STATION_POSITIONS.request.x,
      y: STATION_POSITIONS.request.y,
      meta: {
        count: openCount,
        needsYou: opCounts.needsYou,
        stalled: opCounts.stalled,
        newCount: opCounts.newCount,
        reviewCount: opCounts.reviewCount,
      },
    },
    {
      key: 'agent',
      title: tx(t, 'world.agent.title', 'Builder & review'),
      shortLabel: tx(t, 'world.agent.short', 'Builder'),
      shortStatus: agentShort,
      explain: tx(
        t,
        'world.agent.explain',
        'AI agent builds and human review before changes reach preview.',
      ),
      state: agentState,
      stateText: agentText,
      x: STATION_POSITIONS.agent.x,
      y: STATION_POSITIONS.agent.y,
      meta: {
        count: workingCount,
        inProgress: inProgressCount,
        inReview: inReviewCount,
        needsYou: opCounts.needsYou,
        stalled: opCounts.stalled,
      },
    },
    {
      key: 'code',
      title: tx(t, 'world.code.title', 'Code repository'),
      shortLabel: tx(t, 'world.code.short', 'Code'),
      shortStatus: codeShort,
      explain: tx(
        t,
        'world.code.explain',
        'Versioned repository and GitHub connection holding every change.',
      ),
      state: codeState,
      stateText: codeText,
      x: STATION_POSITIONS.code.x,
      y: STATION_POSITIONS.code.y,
      meta: {
        repoSlug,
        repoUrl,
        keptByPTech: !repoSlug && !repoError && project?.kind === 'new',
      },
    },
    {
      key: 'preview',
      title: tx(t, 'world.preview.title', 'Preview & publish'),
      shortLabel: tx(t, 'world.preview.short', 'Preview'),
      shortStatus: previewShort,
      explain: tx(
        t,
        'world.preview.explain',
        'Private staging copy where builds are verified before publishing live.',
      ),
      state: previewState,
      stateText: previewText,
      x: STATION_POSITIONS.preview.x,
      y: STATION_POSITIONS.preview.y,
      meta: {
        ahead: previewAhead,
        previewDeploy,
        productionDeploy,
        previewUrl,
        deployTime,
        hasDeploys: Boolean(latestDeploy),
        driftCount: drift?.count ?? 0,
      },
    },
    {
      key: 'hosting',
      title: tx(t, 'world.hosting.title', 'Live site'),
      shortLabel: tx(t, 'world.hosting.short', 'Live site'),
      shortStatus: hostingShort,
      explain: tx(
        t,
        'world.hosting.explain',
        'Production web address, HTTPS connection, and hosting provider.',
      ),
      state: hostingState,
      stateText: hostingText,
      x: STATION_POSITIONS.hosting.x,
      y: STATION_POSITIONS.hosting.y,
      meta: {
        hostLabel,
        hostKind: site ? (isCloudflare ? 'cloudflare' : 'ptech') : null,
        hostname: addr.hostname,
        url: addr.raw,
        liveUrl,
        addressText,
        httpsVerified,
        httpsText,
        previewAhead,
        deployTime,
      },
    },
  ];

  return baseStations.map((station) =>
    applyStationChecks(station, checksByStation.get(station.key) ?? [], t),
  );
}

/**
 * Derive the connecting isometric cables/roads showing both flows:
 *   visitor → hosting
 *   request → agent → code → preview → hosting
 */
export function cablesFor(stations) {
  const byKey = Object.fromEntries((stations ?? []).map((s) => [s.key, s]));
  const st = (k) => byKey[k]?.state ?? 'off';
  const liveSite = st('hosting') === 'ok';
  const buildingSite = st('hosting') === 'active';
  const previewActive = st('preview') === 'active';
  const previewLive = st('preview') === 'ok' || st('preview') === 'warn' || previewActive;

  return [
    {
      id: 'visitor-hosting',
      from: 'visitor',
      to: 'hosting',
      flow: 'visitor',
      points: [
        [VISITOR_POS.x, VISITOR_POS.y],
        [STATION_POSITIONS.hosting.x, STATION_POSITIONS.hosting.y],
      ],
      active: buildingSite,
      connected: liveSite || buildingSite || st('hosting') === 'warn',
    },
    {
      id: 'request-agent',
      from: 'request',
      to: 'agent',
      flow: 'build',
      points: [
        [STATION_POSITIONS.request.x, STATION_POSITIONS.request.y],
        [STATION_POSITIONS.agent.x, STATION_POSITIONS.agent.y],
      ],
      active: st('agent') === 'active',
      connected: st('request') !== 'off' || st('agent') !== 'off',
    },
    {
      id: 'agent-code',
      from: 'agent',
      to: 'code',
      flow: 'build',
      points: [
        [STATION_POSITIONS.agent.x, STATION_POSITIONS.agent.y],
        [STATION_POSITIONS.code.x, STATION_POSITIONS.code.y],
      ],
      active: st('agent') === 'active',
      connected: st('code') === 'ok' || st('agent') !== 'off',
    },
    {
      id: 'code-preview',
      from: 'code',
      to: 'preview',
      flow: 'build',
      points: [
        [STATION_POSITIONS.code.x, STATION_POSITIONS.code.y],
        [STATION_POSITIONS.preview.x, STATION_POSITIONS.preview.y],
      ],
      active: previewActive || buildingSite,
      connected: st('code') === 'ok' && st('preview') !== 'off',
    },
    {
      id: 'preview-hosting',
      from: 'preview',
      to: 'hosting',
      flow: 'build',
      points: [
        [STATION_POSITIONS.preview.x, STATION_POSITIONS.preview.y],
        [STATION_POSITIONS.hosting.x, STATION_POSITIONS.hosting.y],
      ],
      active: previewActive || buildingSite,
      connected: liveSite || previewLive,
    },
  ];
}

/* ————— request journey trace (ticket status → 5 workshop stations) ————— */

export const JOURNEY_STATION_KEYS = Object.freeze([
  'request',
  'agent',
  'code',
  'preview',
  'hosting',
]);

const JOURNEY_CABLE_IDS = Object.freeze([
  'request-agent',
  'agent-code',
  'code-preview',
  'preview-hosting',
]);

const JOURNEY_PLANS = Object.freeze({
  new: { current: 'request', reached: 0 },
  approved: { current: 'request', reached: 0 },
  declined: { current: 'request', reached: 0 },
  in_progress: { current: 'agent', reached: 1 },
  review: { current: 'preview', reached: 3 },
  done: { current: 'hosting', reached: 4 },
});

const JOURNEY_STATUS_SENTENCE = Object.freeze({
  new: ['world.journey.status.new', 'waiting for approval'],
  approved: ['world.journey.status.approved', 'approved, waiting for the builder'],
  in_progress: ['world.journey.status.in_progress', 'being built now'],
  review: ['world.journey.status.review', 'ready for review on the preview'],
  done: ['world.journey.status.done', 'live on your site'],
  declined: ['world.journey.status.declined', 'declined'],
});

function humanReviewMinutes(rawSeconds) {
  const s = Number(rawSeconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.max(1, Math.ceil(s / 60));
}

function receiptMoney(cents) {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)}`;
}

function journeySiteUrl(site) {
  const raw =
    cleanString(site?.customDomain) ??
    cleanString(site?.productionUrl) ??
    cleanString(site?.cloudflare?.productionUrl) ??
    cleanString(site?.url);
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export function journeyFor(ticket, { sites = [], t = (k) => k, now } = {}) {
  if (!ticket || typeof ticket !== 'object') return null;
  const plan = JOURNEY_PLANS[ticket.status];
  if (!plan) return null;

  const stations = {};
  const at = JOURNEY_STATION_KEYS.indexOf(plan.current);
  JOURNEY_STATION_KEYS.forEach((key, idx) => {
    stations[key] = key === plan.current ? 'current' : idx < at ? 'reached' : 'ahead';
  });

  const site = pickSite(null, sites);
  const previewUrl = cleanString(site?.previewUrl) ?? cleanString(site?.cloudflare?.previewUrl) ?? null;

  const askedBits = [tx(t, 'world.journey.asked', 'Asked')];
  const app = cleanString(ticket.assistant_app);
  if (app) askedBits.push(tx(t, 'world.journey.via', 'via {app}', { app }));
  const askedWhen = formatDeployTime(ticket.created_at, now);
  if (askedWhen) askedBits.push(askedWhen);

  const [tailKey, tailDefault] = JOURNEY_STATUS_SENTENCE[ticket.status];
  let sentence = `${askedBits.join(' ')} → ${tx(t, tailKey, tailDefault)}`;

  const minutes = humanReviewMinutes(ticket.human_seconds);
  if (minutes > 0) {
    sentence = `${sentence} · ${tx(t, 'world.journey.human', '{min} min of human review', { min: minutes })}`;
  }

  return {
    ticketId: ticket.id ?? null,
    status: ticket.status,
    stations,
    currentKey: plan.current,
    activeCableIds: JOURNEY_CABLE_IDS.slice(0, at),
    sentence,
    previewUrl,
    siteUrl: journeySiteUrl(site),
  };
}

function ticketStamp(ticket) {
  return normalizeTimestampMs(ticket?.updated_at) ?? normalizeTimestampMs(ticket?.created_at) ?? 0;
}

function sameTicketId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function latestTickets(project, tickets, limit = Infinity) {
  const sorted = [...filterProjectTickets(project, tickets)]
    .filter(Boolean)
    .sort((a, b) => ticketStamp(b) - ticketStamp(a));
  return Number.isFinite(limit) ? sorted.slice(0, Math.max(0, limit)) : sorted;
}

export function defaultJourneyTicket(project, tickets) {
  const open = filterProjectTickets(project, tickets).filter((tk) => OPEN_TICKET_STATUSES.has(tk?.status));
  if (open.length === 0) return null;
  return open.reduce((best, tk) => (ticketStamp(tk) > ticketStamp(best) ? tk : best), open[0]);
}

export function journeyPillTickets(project, tickets, { limit = 5, ensure = null } = {}) {
  const sorted = latestTickets(project, tickets);
  const pills = sorted.slice(0, Math.max(0, limit));
  if (ensure !== null && ensure !== undefined && !pills.some((tk) => sameTicketId(tk.id, ensure.id))) {
    const missing = sorted.find((tk) => sameTicketId(tk.id, ensure.id));
    if (missing) {
      if (pills.length < Math.max(0, limit)) pills.push(missing);
      else if (pills.length > 0) pills[pills.length - 1] = missing;
    }
  }
  return pills;
}

export function requestReceipts(project, tickets, { t = (k) => k, now, limit = 3 } = {}) {
  return latestTickets(project, tickets, limit)
    .map((tk) => {
      const app = cleanString(tk.assistant_app);
      const when = formatDeployTime(tk.updated_at ?? tk.created_at, now);
      const id = tk.id ?? null;
      return {
        id,
        title: cleanString(tk.title) ?? (id !== null ? `#${id}` : null),
        via: app ? tx(t, 'world.journey.via', 'via {app}', { app }) : null,
        whenText: when,
      };
    })
    .filter((r) => r.id !== null && r.title);
}

export function agentReceipt(project, tickets, { t = (k) => k } = {}) {
  const eligible = filterProjectTickets(project, tickets).filter(
    (tk) => tk && (tk.status === 'done' || tk.status === 'review'),
  );
  if (eligible.length === 0) return null;
  const latest = eligible.reduce((best, tk) => (ticketStamp(tk) > ticketStamp(best) ? tk : best), eligible[0]);

  const parts = [tx(t, 'world.journey.receipt.built', 'AI built the change')];
  const minutes = humanReviewMinutes(latest.human_seconds);
  if (minutes > 0) {
    parts.push(tx(t, 'world.journey.receipt.human', '{min} min human review', { min: minutes }));
  }
  const rawPrice = latest.price_cents;
  const cents = Number(rawPrice);
  if (
    rawPrice !== null &&
    rawPrice !== undefined &&
    String(rawPrice).trim() !== '' &&
    Number.isFinite(cents) &&
    cents >= 0
  ) {
    parts.push(receiptMoney(cents));
  }
  return parts.join(' · ');
}

/* ————— unshipped preview: what is on the preview and not live yet ————— */

function spanShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function unshippedPreview({ project = null, sites = [], deploys = null, tickets = [], t = (k) => k, now } = {}) {
  const site = pickSite(project, sites);
  if (!site || site.state !== 'ready' || !site.previewDeploy) return null;
  if (site.productionDeploy && String(site.previewDeploy) === String(site.productionDeploy)) return null;
  const list = (Array.isArray(deploys) ? deploys : []).filter((d) => d && d.id !== undefined && d.id !== null);
  const at = (d) => normalizeTimestampMs(d?.created_at) ?? 0;
  const preview = list.find((d) => String(d.id) === String(site.previewDeploy));
  if (!preview) return null;
  const live = site.productionDeploy ? list.find((d) => String(d.id) === String(site.productionDeploy)) : null;
  if (site.productionDeploy && !live) return null;
  const from = live ? at(live) : -Infinity;
  const nowMs = normalizeTimestampMs(now) ?? Date.now();
  const byTicket = new Map((Array.isArray(tickets) ? tickets : []).filter(Boolean).map((tk) => [String(tk.id), tk]));
  const seen = new Set();
  const items = [];
  for (const d of [...list].sort((a, b) => at(b) - at(a))) {
    if (at(d) <= from || at(d) > at(preview)) continue;
    const hasTicket = d.ticket_id !== null && d.ticket_id !== undefined;
    const key = hasTicket ? `t:${d.ticket_id}` : `d:${d.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tk = hasTicket ? byTicket.get(String(d.ticket_id)) : null;
    const title = hasTicket
      ? (cleanString(tk?.title) ? `#${d.ticket_id} ${cleanString(tk.title)}` : `#${d.ticket_id}`)
      : tx(t, 'world.drift.direct', 'Direct site update');
    items.push({ key, ticketId: hasTicket ? d.ticket_id : null, title, stamp: at(d), age: at(d) ? spanShort(nowMs - at(d)) : null });
  }
  if (!items.length) return null;
  let rows = items;
  const direct = items.filter((i) => i.ticketId === null);
  if (direct.length > 1) {
    const first = items.indexOf(direct[0]);
    const oldestDirect = direct.reduce((a, b) => (b.stamp && (!a.stamp || b.stamp < a.stamp) ? b : a));
    const folded = { ...oldestDirect, key: 'direct', title: tx(t, 'world.drift.directMany', '{n} direct site updates', { n: direct.length }) };
    const rest = items.filter((i) => i.ticketId !== null);
    rest.splice(first, 0, folded);
    rows = rest;
  }
  const oldest = items.reduce((a, b) => (b.stamp && (!a.stamp || b.stamp < a.stamp) ? b : a));
  const parts = [tx(t, items.length === 1 ? 'world.drift.one' : 'world.drift.many', items.length === 1 ? '1 change on preview' : '{n} changes on preview', { n: items.length })];
  if (oldest.stamp) {
    const age = spanShort(nowMs - oldest.stamp);
    parts.push(oldest.ticketId !== null
      ? tx(t, 'world.drift.sinceTicket', 'unshipped {age} (since #{id})', { age, id: oldest.ticketId })
      : tx(t, 'world.drift.since', 'unshipped {age}', { age }));
  }
  return { count: items.length, text: parts.join(' · '), items: rows.map(({ stamp, ...rest }) => rest) };
}
