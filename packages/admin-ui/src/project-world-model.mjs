/*
 * Pure model & isometric geometry for Admin ProjectWorld.
 * Zero React dependencies so state derivation and projection math can be
 * tested directly with node:test.
 *
 * Origin: ported from ptechsolutions-site
 *   - src/components/portal/project-world-model.js
 *   - src/components/portal/ProjectWorld.jsx
 *   - src/components/portal/project-world.css
 *   - src/components/portal/project-world-model.test.mjs
 *
 * Keep station geometry and derivation logic in sync with the portal model.
 * Admin differences:
 *   - Browser HTTPS probe omitted (operator view must not ping client sites).
 *   - Supports snake_case admin API aliases (repo_error, repo_wanted).
 *   - Computes operator ticket counts (needsYou, stalled > 45m) for agent/request.
 */

export const ISO_COS = Math.cos(Math.PI / 6); // cos(30deg) ≈ 0.8660254
export const ISO_SIN = 0.5; // sin(30deg)

export const DEFAULT_ISO = Object.freeze({
  scale: 44,
  originX: 325,
  originY: 92,
});

export const FLOOR_BOUNDS = Object.freeze({
  minX: 0,
  maxX: 8.6,
  minY: 0,
  maxY: 5.6,
});

export const OPEN_TICKET_STATUSES = new Set(['new', 'approved', 'in_progress', 'review']);
export const ACTIVE_TICKET_STATUSES = new Set(['in_progress', 'review']);
export const STALL_MS = 45 * 60 * 1000;

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

/** Station grid coordinates arranged along crisp 30° axes. */
export const STATION_POSITIONS = Object.freeze({
  hosting: { x: 1.5, y: 1.2, padHalf: 0.82 },
  https: { x: 1.5, y: 2.6, padHalf: 0.54 },
  domain: { x: 1.5, y: 4.2, padHalf: 0.64 },
  preview: { x: 3.5, y: 1.2, padHalf: 0.68 },
  deploy: { x: 5.5, y: 1.2, padHalf: 0.74 },
  code: { x: 7.5, y: 1.2, padHalf: 0.68 },
  request: { x: 5.0, y: 3.5, padHalf: 0.66 },
  agent: { x: 7.5, y: 3.5, padHalf: 0.74 },
});

export const VISITOR_POS = Object.freeze({ x: 1.5, y: 5.4 });

/** Generate dot-matrix floor coordinates, tagging which station tile owns each dot. */
export function floorDots(stations = [], step = 0.4, opts = DEFAULT_ISO) {
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

function hostnameOf(raw) {
  const s = cleanString(raw);
  if (!s) return null;
  const stripped = s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return stripped || null;
}

function extractAddress(site) {
  if (!site) return { raw: null, hostname: null, hasExplicitHttps: false, hasExplicitHttp: false };

  // Check explicit URL fields first to inspect protocol honestly.
  const urlCandidates = [
    cleanString(site.customDomain),
    cleanString(site.productionUrl),
    cleanString(site.cloudflare?.productionUrl),
    cleanString(site.url),
  ].filter(Boolean);

  const primaryUrl = urlCandidates[0] ?? null;
  const hasExplicitHttp = Boolean(primaryUrl && /^http:\/\//i.test(primaryUrl));
  const hasExplicitHttps =
    !hasExplicitHttp && urlCandidates.some((u) => /^https:\/\//i.test(u));

  // Display hostname prefers custom domain / domain / hostname, then production/url/preview.
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
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
}

function normalizeTimestampMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Unix seconds vs milliseconds heuristic
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

// Real keys from worker/src/setup.ts: brief, code, workspace, request, preview, domain.
const EXACT_CHECK_STATION = Object.freeze({
  domain: 'domain',
  dns: 'domain',
  email: 'domain',
  mail: 'domain',
  mx: 'domain',
  https: 'https',
  ssl: 'https',
  tls: 'https',
  hosting: 'hosting',
  host: 'hosting',
  code: 'code',
  repo: 'code',
  github: 'code',
  preview: 'preview',
  deploy: 'deploy',
});

function matchCheckText(text) {
  if (!text) return null;
  if (/https|ssl|tls|(?:^|[^a-z])cert(?:ificate)?(?:$|[^a-z])/.test(text)) return 'https';
  if (/domain|dns|e-?mail|(?:^|[^a-z])mail(?:$|[^a-z])|(?:^|[^a-z])mx(?:$|[^a-z])/.test(text)) return 'domain';
  if (/repo|github|(?:^|[^a-z])git(?:$|[^a-z])|(?:^|[^a-z])code(?:$|[^a-z])/.test(text)) return 'code';
  if (/preview|staging/.test(text)) return 'preview';
  if (/hosting|(?:^|[^a-z])host(?:$|[^a-z])|cloudflare/.test(text)) return 'hosting';
  if (/deploy|publish/.test(text)) return 'deploy';
  return null;
}

/**
 * Map a project.setup.checks entry onto its matching world station key,
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
  const readyCheck = checks.find((c) => c.state === 'ready');

  let { state, stateText, meta } = station;

  if (pendingCheck) {
    if (state !== 'bad') {
      const wasEmpty = state === 'off' || state === 'unknown';
      state = 'warn';
      if (wasEmpty && pendingCheck.label) {
        stateText = pendingCheck.label;
      }
    }
  } else if (
    readyCheck &&
    state === 'unknown' &&
    (station.key === 'https' || station.key === 'domain')
  ) {
    state = 'ok';
    if (station.key === 'https') {
      stateText = tx(t, 'world.https.state.ok', 'Locked with HTTPS');
      meta = { ...meta, verified: true, verifiedByCheck: true };
    } else {
      stateText = readyCheck.detail || tx(t, 'world.domain.state.checkReady', 'Domain ready');
      meta = { ...meta, verifiedByCheck: true };
    }
  }

  return {
    ...station,
    state,
    stateText,
    meta,
    checks,
  };
}

/**
 * Derive the 8 world stations from real admin/portal project data.
 *
 * Returns an array of:
 *   { key, title, shortLabel, explain, state, stateText, x, y, meta, checks }
 * where state is one of: 'ok' | 'active' | 'warn' | 'bad' | 'off' | 'unknown'.
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
  const previewUrl = cleanString(site?.previewUrl) ?? cleanString(site?.cloudflare?.previewUrl);

  // 1. Domain signpost ("Your web address")
  let domainState = 'off';
  let domainText = tx(t, 'world.domain.state.off', 'Not connected yet');
  if (site) {
    if (siteFailed) {
      domainState = 'bad';
      domainText = addr.hostname
        ? tx(t, 'world.domain.state.failedHost', 'Setup stopped for {host}', { host: addr.hostname })
        : tx(t, 'world.domain.state.failed', 'Address setup stopped');
    } else if (siteReady) {
      if (addr.hostname) {
        domainState = 'ok';
        domainText = tx(t, 'world.domain.state.live', 'Live at {host}', { host: addr.hostname });
      } else {
        domainState = 'unknown';
        domainText = tx(t, 'world.domain.state.missing', 'No web address reported yet');
      }
    } else {
      domainState = 'active';
      domainText = addr.hostname
        ? tx(t, 'world.domain.state.settingUpHost', 'Setting up {host}', { host: addr.hostname })
        : tx(t, 'world.domain.state.settingUp', 'Setting up your web address');
    }
  }

  // 2. Hosting building ("Where your site lives")
  const isCloudflare = site?.host === 'cloudflare';
  const hostLabel = isCloudflare
    ? tx(t, 'world.hosting.host.cloudflare', 'Cloudflare (your account)')
    : tx(t, 'world.hosting.host.ptech', 'PTech hosting');
  let hostingState = 'off';
  let hostingText = tx(t, 'world.hosting.state.none', 'No hosting set up yet');
  if (site) {
    if (siteFailed) {
      hostingState = 'bad';
      hostingText = tx(t, 'world.hosting.state.failed', '{host} — setup stopped', { host: hostLabel });
    } else if (siteReady) {
      hostingState = 'ok';
      hostingText = previewAhead
        ? tx(t, 'world.hosting.state.livePreview', 'Live on {host} (preview ready)', { host: hostLabel })
        : tx(t, 'world.hosting.state.live', 'Live on {host}', { host: hostLabel });
    } else {
      hostingState = 'active';
      hostingText = tx(t, 'world.hosting.state.building', 'Setting up on {host}', { host: hostLabel });
    }
  }

  // 3. Padlock arch ("Secure connection (https)")
  // Strict rule: ONLY 'ok' when site is ready AND URL explicitly uses https://.
  // Never claim HTTPS is valid without data.
  const httpsVerified = Boolean(siteReady && addr.hasExplicitHttps);
  const httpsState = httpsVerified ? 'ok' : 'unknown';
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

  // 4. Code repository filing cabinet ("Your code, with full history")
  const repoSlug = shortRepo(project?.repo);
  const repoError = cleanString(project?.repoError) ?? cleanString(project?.repo_error);
  const repoWanted = Boolean(project?.repoWanted || project?.repo_wanted);
  let codeState = 'off';
  let codeText = tx(t, 'world.code.state.missing', 'Not connected yet');
  if (repoError) {
    codeState = 'bad';
    codeText = tx(t, 'world.code.state.error', 'Connection problem — needs attention');
  } else if (repoSlug) {
    codeState = 'ok';
    codeText = tx(t, 'world.code.state.connected', 'Connected: {repo}', { repo: repoSlug });
  } else if (repoWanted) {
    codeState = 'active';
    codeText = tx(t, 'world.code.state.settingUp', 'Setting up your code repository');
  } else if (project?.kind === 'new') {
    codeState = 'ok';
    codeText = tx(t, 'world.code.state.ptech', 'Kept by PTech');
  }

  // 5. Deploy crane/conveyor ("Publishing changes")
  const latestDeploy = latestDeployOf(deploys);
  let deployState = 'off';
  let deployText = tx(t, 'world.deploy.state.neutral', 'Ready for the next update');
  let deployTime = null;
  if (latestDeploy) {
    const rawStatus = String(latestDeploy.status ?? latestDeploy.state ?? '').toLowerCase();
    deployTime = formatDeployTime(
      latestDeploy.created_at ?? latestDeploy.updated_at ?? latestDeploy.timestamp ?? latestDeploy.time,
      now,
    );
    if (['failed', 'error', 'canceled', 'cancelled'].includes(rawStatus)) {
      deployState = 'bad';
      deployText = deployTime
        ? tx(t, 'world.deploy.state.failedAt', 'Last publish failed ({time})', { time: deployTime })
        : tx(t, 'world.deploy.state.failed', 'Last publish failed');
    } else if (['building', 'running', 'deploying', 'pending', 'queued', 'in_progress'].includes(rawStatus)) {
      deployState = 'active';
      deployText = tx(t, 'world.deploy.state.building', 'Publishing update now');
    } else {
      deployState = 'ok';
      deployText = deployTime
        ? tx(t, 'world.deploy.state.okAt', 'Last published {time}', { time: deployTime })
        : tx(t, 'world.deploy.state.ok', 'Latest changes published');
    }
  } else if (!site) {
    deployState = 'off';
    deployText = tx(t, 'world.deploy.state.noSite', 'Waiting for a site to publish to');
  } else if (siteFailed) {
    deployState = 'bad';
    deployText = tx(t, 'world.deploy.state.paused', 'Paused — hosting setup stopped');
  } else if (siteBuilding) {
    deployState = 'active';
    deployText = tx(t, 'world.deploy.state.preparing', 'Preparing first publish');
  } else if (previewAhead) {
    deployState = 'warn';
    deployText = tx(t, 'world.deploy.state.previewAhead', 'New preview ready to publish');
  }

  // 6. Agent desk ("PTech's AI builder + human review")
  const inProgressCount = projectTickets.filter((tk) => tk.status === 'in_progress').length;
  const inReviewCount = projectTickets.filter((tk) => tk.status === 'review').length;
  const workingCount = inProgressCount + inReviewCount;
  let agentState = 'off';
  let agentText = tx(t, 'world.agent.state.idle', 'Standing by — no active build');
  if (workingCount > 0) {
    agentState = 'active';
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

  // 7. Request inbox ("Your requests")
  const openCount = projectTickets.filter((tk) => OPEN_TICKET_STATUSES.has(tk.status)).length;
  const requestState = openCount > 0 ? 'active' : 'off';
  const requestText =
    openCount === 0
      ? tx(t, 'world.request.state.none', 'No open requests')
      : openCount === 1
        ? tx(t, 'world.request.state.one', '1 open request')
        : tx(t, 'world.request.state.many', '{count} open requests', { count: openCount });

  // 8. Preview glass-cloche mini shop ("Preview")
  let previewState = 'off';
  let previewText = tx(t, 'world.preview.state.off', 'No preview yet');
  if (site && previewDeploy) {
    if (siteFailed) {
      previewState = 'bad';
      previewText = tx(t, 'world.preview.state.failed', 'Preview paused — site setup stopped');
    } else if (!siteReady) {
      previewState = 'active';
      previewText = tx(t, 'world.preview.state.building', 'Setting up preview');
    } else if (previewAhead) {
      previewState = 'active';
      previewText = tx(t, 'world.preview.state.ahead', 'A newer version is waiting to be published');
    } else {
      previewState = 'ok';
      previewText = tx(t, 'world.preview.state.ok', 'Matches your live site');
    }
  }

  const baseStations = [
    {
      key: 'domain',
      title: tx(t, 'world.domain.title', 'Your web address'),
      shortLabel: tx(t, 'world.domain.short', 'Web address'),
      explain: tx(
        t,
        'world.domain.explain',
        'The domain name people type into their browser to reach your website.',
      ),
      state: domainState,
      stateText: domainText,
      x: STATION_POSITIONS.domain.x,
      y: STATION_POSITIONS.domain.y,
      meta: { hostname: addr.hostname, url: addr.raw },
    },
    {
      key: 'hosting',
      title: tx(t, 'world.hosting.title', 'Where your site lives'),
      shortLabel: tx(t, 'world.hosting.short', 'Hosting'),
      explain: tx(
        t,
        'world.hosting.explain',
        'The always-on server that stores your finished website and delivers it to every visitor.',
      ),
      state: hostingState,
      stateText: hostingText,
      x: STATION_POSITIONS.hosting.x,
      y: STATION_POSITIONS.hosting.y,
      meta: {
        hostLabel,
        hostKind: site ? (isCloudflare ? 'cloudflare' : 'ptech') : null,
        previewAhead,
      },
    },
    {
      key: 'https',
      title: tx(t, 'world.https.title', 'Secure connection (HTTPS)'),
      shortLabel: tx(t, 'world.https.short', 'HTTPS'),
      explain: tx(
        t,
        'world.https.explain',
        'The browser padlock that encrypts traffic between visitors and your website.',
      ),
      state: httpsState,
      stateText: httpsText,
      x: STATION_POSITIONS.https.x,
      y: STATION_POSITIONS.https.y,
      meta: { verified: httpsVerified },
    },
    {
      key: 'preview',
      title: tx(t, 'world.preview.title', 'Preview'),
      shortLabel: tx(t, 'world.preview.short', 'Preview'),
      explain: tx(
        t,
        'world.preview.explain',
        'A private copy of your site where changes are checked before going live.',
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
      },
    },
    {
      key: 'code',
      title: tx(t, 'world.code.title', 'Your code, with full history'),
      shortLabel: tx(t, 'world.code.short', 'Code vault'),
      explain: tx(
        t,
        'world.code.explain',
        'A versioned filing cabinet of every file in your site so changes can always be reviewed or undone.',
      ),
      state: codeState,
      stateText: codeText,
      x: STATION_POSITIONS.code.x,
      y: STATION_POSITIONS.code.y,
      meta: { repoSlug, keptByPTech: !repoSlug && !repoError && project?.kind === 'new' },
    },
    {
      key: 'deploy',
      title: tx(t, 'world.deploy.title', 'Publishing changes'),
      shortLabel: tx(t, 'world.deploy.short', 'Publish'),
      explain: tx(
        t,
        'world.deploy.explain',
        'The automated conveyor that packages approved code and pushes updates onto your live hosting.',
      ),
      state: deployState,
      stateText: deployText,
      x: STATION_POSITIONS.deploy.x,
      y: STATION_POSITIONS.deploy.y,
      meta: { deployTime, hasDeploys: Boolean(latestDeploy), previewAhead },
    },
    {
      key: 'agent',
      title: tx(t, 'world.agent.title', "PTech's AI builder + human review"),
      shortLabel: tx(t, 'world.agent.short', 'Builder'),
      explain: tx(
        t,
        'world.agent.explain',
        'Our AI builds your requested changes in code while a PTech engineer reviews the result before it ships.',
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
      key: 'request',
      title: tx(t, 'world.request.title', 'Your requests'),
      shortLabel: tx(t, 'world.request.short', 'Requests'),
      explain: tx(
        t,
        'world.request.explain',
        'Your inbox for asking for new pages, wording edits, or fixes in plain English.',
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
  ];

  return baseStations.map((station) =>
    applyStationChecks(station, checksByStation.get(station.key) ?? [], t),
  );
}

/**
 * Derive the connecting isometric cables/roads showing both flows:
 *   visitor → domain → https → hosting
 *   request → agent → code → deploy → preview → hosting
 */
export function cablesFor(stations) {
  const byKey = Object.fromEntries((stations ?? []).map((s) => [s.key, s]));
  const st = (k) => byKey[k]?.state ?? 'off';
  const liveSite = st('hosting') === 'ok';
  const buildingSite = st('hosting') === 'active';
  const previewActive = st('preview') === 'active';
  const previewLive = st('preview') === 'ok' || previewActive;

  return [
    {
      id: 'visitor-domain',
      from: 'visitor',
      to: 'domain',
      flow: 'visitor',
      points: [
        [VISITOR_POS.x, VISITOR_POS.y],
        [STATION_POSITIONS.domain.x, STATION_POSITIONS.domain.y],
      ],
      active: liveSite || st('domain') === 'active',
      connected: st('domain') === 'ok' || st('domain') === 'active',
    },
    {
      id: 'domain-https',
      from: 'domain',
      to: 'https',
      flow: 'visitor',
      points: [
        [STATION_POSITIONS.domain.x, STATION_POSITIONS.domain.y],
        [STATION_POSITIONS.https.x, STATION_POSITIONS.https.y],
      ],
      active: liveSite || buildingSite,
      connected: st('domain') === 'ok' || buildingSite,
    },
    {
      id: 'https-hosting',
      from: 'https',
      to: 'hosting',
      flow: 'visitor',
      points: [
        [STATION_POSITIONS.https.x, STATION_POSITIONS.https.y],
        [STATION_POSITIONS.hosting.x, STATION_POSITIONS.hosting.y],
      ],
      active: liveSite || buildingSite,
      connected: liveSite || buildingSite,
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
      active: st('request') === 'active' || st('agent') === 'active',
      connected: st('request') === 'active' || st('agent') === 'active',
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
      connected: st('code') === 'ok' || st('agent') === 'active',
    },
    {
      id: 'code-deploy',
      from: 'code',
      to: 'deploy',
      flow: 'build',
      points: [
        [STATION_POSITIONS.code.x, STATION_POSITIONS.code.y],
        [STATION_POSITIONS.deploy.x, STATION_POSITIONS.deploy.y],
      ],
      active: st('deploy') === 'active' || buildingSite,
      connected: st('code') === 'ok' && st('deploy') !== 'off',
    },
    {
      id: 'deploy-preview',
      from: 'deploy',
      to: 'preview',
      flow: 'build',
      points: [
        [STATION_POSITIONS.deploy.x, STATION_POSITIONS.deploy.y],
        [STATION_POSITIONS.preview.x, STATION_POSITIONS.preview.y],
      ],
      active: st('deploy') === 'active' || previewActive || buildingSite,
      connected: previewLive || st('deploy') === 'ok' || st('deploy') === 'active',
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
      active: st('deploy') === 'active' || previewActive || buildingSite,
      connected: liveSite || previewLive,
    },
  ];
}

/* Ported from the portal (ptechsolutions-site src/components/portal/project-world-model.js); keep in sync. */
/* ————— request journey trace (ticket status → workshop stations) ————— */

/** The stations one request passes through, in journey order (preview before
 *  the production publish). Distinct from JOURNEY_CABLE_ORDER below, which is
 *  the physical cable wiring: the request's story stops at the preview for
 *  review ("request/agent/code reached, current=preview") while its cables
 *  still run through the deploy corner to reach it. */
export const JOURNEY_STATION_KEYS = Object.freeze([
  'request',
  'agent',
  'code',
  'preview',
  'deploy',
  'hosting',
]);

/** The same stations in the order the map's build cables wire them. */
const JOURNEY_CABLE_ORDER = Object.freeze(['request', 'agent', 'code', 'deploy', 'preview', 'hosting']);
const JOURNEY_CABLE_IDS = Object.freeze([
  'request-agent',
  'agent-code',
  'code-deploy',
  'deploy-preview',
  'preview-hosting',
]);

/** Honest mapping from a ticket status alone: where the request stands now. */
const JOURNEY_PLANS = Object.freeze({
  new: { current: 'request', reached: 0 },
  approved: { current: 'request', reached: 0 },
  declined: { current: 'request', reached: 0 },
  in_progress: { current: 'agent', reached: 1 },
  review: { current: 'preview', reached: 3 },
  done: { current: 'hosting', reached: 5 },
});

/** The plain-English tail of the journey sentence, per status. */
const JOURNEY_STATUS_SENTENCE = Object.freeze({
  new: ['world.journey.status.new', 'waiting for approval'],
  approved: ['world.journey.status.approved', 'approved, waiting for the builder'],
  in_progress: ['world.journey.status.in_progress', 'being built now'],
  review: ['world.journey.status.review', 'ready for review on the preview'],
  done: ['world.journey.status.done', 'live on your site'],
  declined: ['world.journey.status.declined', 'declined'],
});

/** Minutes of human review spent on a ticket; at least one once any time is recorded. */
function humanReviewMinutes(rawSeconds) {
  const s = Number(rawSeconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.max(1, Math.ceil(s / 60));
}

/** "$40" for whole dollars, "$40.50" otherwise — from price_cents only. */
function receiptMoney(cents) {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)}`;
}

/** The site's public address for an "Open site" chip, https:// for bare hosts. */
function journeySiteUrl(site) {
  const raw =
    cleanString(site?.customDomain) ??
    cleanString(site?.productionUrl) ??
    cleanString(site?.cloudflare?.productionUrl) ??
    cleanString(site?.url);
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/**
 * Trace one ticket across the workshop stations, honestly and from its
 * status alone. Returns null when the ticket or its status says nothing.
 *
 *   stations:       request | agent | code | preview | deploy | hosting
 *                   → 'reached' | 'current' | 'ahead'
 *   currentKey:     the station the request stands at now
 *   activeCableIds: build cables (cablesFor ids) lit up to the current station
 *   sentence:        "Asked via Claude 2h ago → being built now"
 *   previewUrl / siteUrl: addresses for the caption chips, when the site has them
 */
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

  // "Asked via Claude 2h ago" — only what the ticket actually says.
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
    activeCableIds: JOURNEY_CABLE_IDS.slice(0, JOURNEY_CABLE_ORDER.indexOf(plan.current)),
    sentence,
    previewUrl,
    siteUrl: journeySiteUrl(site),
  };
}

/** A ticket's clock: when it was last touched, or created if never touched. */
function ticketStamp(ticket) {
  return normalizeTimestampMs(ticket?.updated_at) ?? normalizeTimestampMs(ticket?.created_at) ?? 0;
}

function sameTicketId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

/** A project's tickets newest-updated first. */
function latestTickets(project, tickets, limit = Infinity) {
  const sorted = [...filterProjectTickets(project, tickets)]
    .filter(Boolean)
    .sort((a, b) => ticketStamp(b) - ticketStamp(a));
  return Number.isFinite(limit) ? sorted.slice(0, Math.max(0, limit)) : sorted;
}

/**
 * The ticket a freshly opened map traces by default: the most recently
 * updated open one, or null when nothing is open.
 */
export function defaultJourneyTicket(project, tickets) {
  const open = filterProjectTickets(project, tickets).filter((tk) => OPEN_TICKET_STATUSES.has(tk?.status));
  if (open.length === 0) return null;
  return open.reduce((best, tk) => (ticketStamp(tk) > ticketStamp(best) ? tk : best), open[0]);
}

/**
 * Pills for the journeys row: the project's latest `limit` tickets, newest
 * updated first. `ensure` (usually the default trace) is never dropped — when
 * newer closed tickets push it out of the window it takes the last slot, so
 * the default journey always has a visible pill.
 */
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

/**
 * Receipts for the request inbox station: the latest few tickets with a
 * "via <assistant_app>" badge when the ticket names one, and relative time.
 */
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

/**
 * One-line receipt for the builder desk: the latest done-or-review change,
 * e.g. "AI built the change · 12 min human review · $40". Missing parts are
 * omitted, and the AI meter (ai_micro_usd) is never shown to the client.
 */
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
  // A frozen $0 (a first preview is free) is data, not a missing part.
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

/**
 * The operator's view of preview drift: every change on the site's preview
 * that production does not have yet, one row per request (newest first), and
 * how long the oldest of them has waited to ship.
 *   { count, text: "2 changes on preview · unshipped 4h (since #42)", items }
 * Null when preview and live are the same version, when the site is not
 * ready, or when the deploy history cannot place both versions.
 */
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
  // Direct updates (no request behind them) fold into one row, newest position, oldest age.
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
