/*
 * Unit tests for packages/admin-ui/src/project-world-model.mjs (M1 5-station model).
 *
 * Covers:
 *   - Isometric projection and 3-face box geometry
 *   - 5-station consolidation (domain+https merged into hosting; deploy merged into preview & hosting)
 *   - Honest HTTPS verification without browser probing
 *   - Active vs waiting state semantics (no idle pulsing on waiting preview/requests)
 *   - Setup check mapping & timestamps
 *   - Operator ticket counts (needsYou, stalled > 45m)
 *   - Request journey tracing across the 5 stations
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as model from './project-world-model.mjs';
import {
  DEFAULT_ISO,
  ISO_COS,
  ISO_SIN,
  JOURNEY_STATION_KEYS,
  STALL_MS,
  STATION_ORDER,
  cablesFor,
  floorDots,
  iso,
  isoBox,
  journeyFor,
  operatorTicketCounts,
  stationForCheck,
  stationsFor,
  tx,
} from './project-world-model.mjs';

const byKey = (stations) => Object.fromEntries(stations.map((s) => [s.key, s]));

describe('iso() and isometric box projection', () => {
  it('projects origin and 30° axes accurately', () => {
    const opts = { scale: 50, originX: 200, originY: 100 };
    assert.deepEqual(iso(0, 0, 0, opts), { x: 200, y: 100 });

    const px = iso(1, 0, 0, opts);
    assert.ok(Math.abs(px.x - (200 + 50 * ISO_COS)) < 0.02);
    assert.ok(Math.abs(px.y - (100 + 50 * ISO_SIN)) < 0.02);

    const py = iso(0, 1, 0, opts);
    assert.ok(Math.abs(py.x - (200 - 50 * ISO_COS)) < 0.02);
    assert.ok(Math.abs(py.y - (100 + 50 * ISO_SIN)) < 0.02);

    const pz = iso(0, 0, 2, opts);
    assert.deepEqual(pz, { x: 200, y: 0 });
  });

  it('uses DEFAULT_ISO when options are omitted and avoids NaN on invalid inputs', () => {
    assert.deepEqual(iso(0, 0, 0), { x: DEFAULT_ISO.originX, y: DEFAULT_ISO.originY });
    const safe = iso(NaN, undefined, Infinity);
    assert.ok(Number.isFinite(safe.x) && Number.isFinite(safe.y));
  });

  it('builds three visible isometric polygon faces in isoBox()', () => {
    const box = isoBox(1, 2, 0, 1, 1, 1);
    for (const face of [box.top, box.left, box.right]) {
      assert.equal(face.split(' ').length, 4);
    }
  });
});

describe('stationsFor() — 5 functional stations & hosting/domain/https merge', () => {
  it('returns exactly 5 functional stations for a project with no site', () => {
    const stations = stationsFor({
      project: { id: 'p1', name: 'Bakery', kind: 'existing' },
      sites: [],
      tickets: [],
    });
    const map = byKey(stations);

    assert.deepEqual(stations.map((s) => s.key), [...STATION_ORDER]);
    assert.equal(Object.keys(map).length, 5);
    assert.equal(map.hosting.state, 'off');
    assert.equal(map.hosting.meta.addressText, 'Not connected yet');
    assert.equal(map.hosting.meta.httpsVerified, false);
    assert.equal(map.preview.state, 'off');
    assert.equal(map.code.state, 'off');
    assert.equal(map.agent.state, 'off');
    assert.equal(map.request.state, 'off');
    for (const s of stations) {
      assert.ok(typeof s.shortStatus === 'string' && s.shortStatus.length > 0, `Station ${s.key} needs shortStatus`);
    }
  });

  it('merges hostname, host provider, and explicit HTTPS into the Live site (hosting) station', () => {
    const cfMap = byKey(
      stationsFor({
        project: { id: 'p1', name: 'Bakery', repo: 'https://github.com/acme/bakery' },
        sites: [
          {
            id: 's1',
            state: 'ready',
            host: 'cloudflare',
            customDomain: 'https://example.com',
            productionUrl: 'https://bakery.pages.dev',
          },
        ],
        tickets: [],
      }),
    );

    assert.equal(cfMap.hosting.state, 'ok');
    assert.equal(cfMap.hosting.meta.addressText, 'Live at example.com');
    assert.match(cfMap.hosting.stateText, /Live at example\.com/);
    assert.match(cfMap.hosting.stateText, /Cloudflare \(your account\)/);
    assert.equal(cfMap.hosting.meta.httpsVerified, true);
    assert.match(cfMap.hosting.meta.httpsText, /HTTPS/);

    const ptechMap = byKey(
      stationsFor({
        project: { id: 'p2', name: 'Florist' },
        sites: [
          {
            id: 's2',
            state: 'ready',
            host: 'ours',
            url: 'https://florist.example.org',
          },
        ],
        tickets: [],
      }),
    );

    assert.equal(ptechMap.hosting.state, 'ok');
    assert.equal(ptechMap.hosting.meta.addressText, 'Live at florist.example.org');
    assert.match(ptechMap.hosting.stateText, /PTech hosting/);
    assert.equal(ptechMap.hosting.meta.httpsVerified, true);
  });

  it('handles a failed site cleanly without claiming HTTPS', () => {
    const map = byKey(
      stationsFor({
        project: { id: 'p1', name: 'Bakery' },
        sites: [
          {
            id: 's1',
            state: 'failed',
            host: 'cloudflare',
            productionUrl: 'https://bakery.example.com',
          },
        ],
        tickets: [],
      }),
    );

    assert.equal(map.hosting.state, 'bad');
    assert.match(map.hosting.stateText, /Cloudflare \(your account\)/);
    assert.equal(map.hosting.meta.httpsVerified, false);
    assert.equal(map.preview.state, 'bad');
  });

  it('handles a building/waiting site as active and keeps HTTPS unverified', () => {
    const map = byKey(
      stationsFor({
        project: { id: 'p1', name: 'Bakery' },
        sites: [
          {
            id: 's1',
            state: 'creating',
            host: 'ours',
            url: 'https://bakery.example.com',
          },
        ],
      }),
    );

    assert.equal(map.hosting.state, 'active');
    assert.equal(map.preview.state, 'active');
    assert.equal(map.hosting.meta.httpsVerified, false);
  });

  it('never marks unknown or non-HTTPS connections as verified', () => {
    const cases = [
      { id: 's1', state: 'ready', domain: 'example.com' },
      { id: 's2', state: 'ready', hostname: 'shop.example.com' },
      { id: 's3', state: 'ready', url: 'http://example.com' },
      { id: 's4', state: 'building', url: 'https://example.com' },
      { id: 's5', state: 'ready' },
    ];

    for (const site of cases) {
      const map = byKey(stationsFor({ project: { id: 'p1' }, sites: [site] }));
      assert.equal(map.hosting.meta.httpsVerified, false, `Expected unverified https for ${JSON.stringify(site)}`);
      assert.match(map.hosting.meta.httpsText, /^Unknown/);
    }
  });
});

describe('stationsFor() — code repository states', () => {
  it('distinguishes connected repo, kept by PTech, missing repo, and repoError / repo_error', () => {
    const connected = byKey(
      stationsFor({ project: { id: 'p1', repo: 'https://github.com/acme/site.git' } }),
    );
    assert.equal(connected.code.state, 'ok');
    assert.match(connected.code.stateText, /acme\/site/);
    assert.equal(connected.code.meta.repoUrl, 'https://github.com/acme/site');

    const keptByPTech = byKey(stationsFor({ project: { id: 'p2', kind: 'new' } }));
    assert.equal(keptByPTech.code.state, 'ok');
    assert.match(keptByPTech.code.stateText, /Kept by PTech/i);

    const missing = byKey(stationsFor({ project: { id: 'p3', kind: 'existing' } }));
    assert.equal(missing.code.state, 'off');
    assert.match(missing.code.stateText, /Not connected/i);

    const broken = byKey(
      stationsFor({
        project: {
          id: 'p4',
          repo: 'https://github.com/acme/site',
          repoError: 'github: permissions requested are not granted',
        },
      }),
    );
    assert.equal(broken.code.state, 'bad');

    const brokenSnake = byKey(
      stationsFor({
        project: {
          id: 'p5',
          repo: 'https://github.com/acme/site',
          repo_error: 'git clone denied',
        },
      }),
    );
    assert.equal(brokenSnake.code.state, 'bad');
  });
});

describe('stationsFor() — preview/deploy merge, agent, and request inbox', () => {
  it('surfaces deploy building/failed states on preview and last published time on hosting/preview', () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const liveSite = {
      id: 's1',
      state: 'ready',
      url: 'https://example.com',
      previewDeploy: 'd2',
      productionDeploy: 'd2',
    };

    const okDeploy = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [liveSite],
        deploys: [
          { id: 'd1', status: 'failed', created_at: Math.floor((now - 3600_000 * 5) / 1000) },
          { id: 'd2', status: 'ready', created_at: Math.floor((now - 600_000) / 1000) },
        ],
        now,
      }),
    );
    assert.equal(okDeploy.preview.state, 'ok');
    assert.match(okDeploy.preview.stateText, /10m ago/);
    assert.equal(okDeploy.hosting.meta.deployTime, '10m ago');

    const buildingDeploy = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [liveSite],
        deploys: [{ id: 'd3', status: 'building', created_at: Math.floor(now / 1000) }],
        now,
      }),
    );
    assert.equal(buildingDeploy.preview.state, 'active');

    const failedDeploy = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [liveSite],
        deploys: [{ id: 'd4', status: 'failed', created_at: Math.floor((now - 120_000) / 1000) }],
        now,
      }),
    );
    assert.equal(failedDeploy.preview.state, 'bad');
    assert.match(failedDeploy.preview.stateText, /2m ago/);
  });

  it('uses warn (not active) for preview ahead so idle waiting previews never pulse', () => {
    const ahead = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [
          {
            id: 's1',
            state: 'ready',
            productionUrl: 'https://bakery.ptechsolutions.dev',
            previewDeploy: 'd101',
            productionDeploy: 'd100',
          },
        ],
      }),
    );
    assert.equal(ahead.preview.state, 'warn');
    assert.equal(ahead.preview.stateText, 'A newer version is waiting to be published');

    const sameAsLive = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [
          {
            id: 's1',
            state: 'ready',
            productionUrl: 'https://bakery.ptechsolutions.dev',
            previewDeploy: 'd100',
            productionDeploy: 'd100',
          },
        ],
      }),
    );
    assert.equal(sameAsLive.preview.state, 'ok');
    assert.equal(sameAsLive.preview.stateText, 'Matches your live site');
  });

  it('marks agent active when building, bad when stalled, warn when review-only, and request warn when needsYou', () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const sec = (ms) => Math.floor(ms / 1000);
    const tickets = [
      { id: 1, project_id: 'p1', status: 'new', updated_at: sec(now - 300_000) },
      { id: 2, project_id: 'p1', status: 'approved', updated_at: sec(now - 300_000) },
      { id: 3, project_id: 'p1', status: 'in_progress', updated_at: sec(now - 300_000) },
      { id: 4, project_id: 'p1', status: 'review', updated_at: sec(now - 300_000) },
      { id: 5, project_id: 'p1', status: 'done', updated_at: sec(now - 300_000) },
      { id: 6, project_id: 'p1', status: 'declined', updated_at: sec(now - 300_000) },
      { id: 7, project_id: 'other', status: 'in_progress', updated_at: sec(now - 300_000) },
    ];

    const map = byKey(
      stationsFor({
        project: { id: 'p1', name: 'Bakery' },
        sites: [{ id: 's1', state: 'ready', url: 'https://example.com' }],
        tickets,
        now,
      }),
    );

    assert.equal(map.request.state, 'warn');
    assert.equal(map.request.stateText, '4 open requests');
    assert.equal(map.agent.state, 'active');
    assert.match(map.agent.stateText, /2/);
    assert.equal(map.agent.meta.count, 2);

    const cables = cablesFor(Object.values(map));
    const reqAgent = cables.find((c) => c.id === 'request-agent');
    const agentCode = cables.find((c) => c.id === 'agent-code');
    assert.equal(reqAgent.active, true);
    assert.equal(agentCode.active, true);

    const dots = floorDots(Object.values(map));
    assert.ok(dots.some((d) => d.active && d.stationKey === 'agent'));

    const reviewOnly = byKey(
      stationsFor({
        project: { id: 'p1' },
        tickets: [{ id: 1, project_id: 'p1', status: 'review', updated_at: sec(now - 300_000) }],
        now,
      }),
    );
    assert.equal(reviewOnly.agent.state, 'warn');
  });

  it('routes build cables through request → agent → code → preview → hosting', () => {
    const stations = stationsFor({
      project: { id: 'p1', repo: 'https://github.com/acme/bakery' },
      sites: [
        {
          id: 's1',
          state: 'ready',
          productionUrl: 'https://bakery.ptechsolutions.dev',
          previewDeploy: 'd2',
          productionDeploy: 'd1',
        },
      ],
    });

    const cables = cablesFor(stations);
    assert.deepEqual(
      cables.map((c) => c.id),
      ['visitor-hosting', 'request-agent', 'agent-code', 'code-preview', 'preview-hosting'],
    );
  });

  it('traces journeys cleanly across the 5 stations', () => {
    assert.deepEqual([...JOURNEY_STATION_KEYS], ['request', 'agent', 'code', 'preview', 'hosting']);
    const j = journeyFor({ id: 42, status: 'review' }, { sites: [{ previewUrl: 'https://preview.example.com' }] });
    assert.equal(j.currentKey, 'preview');
    assert.deepEqual(j.activeCableIds, ['request-agent', 'agent-code', 'code-preview']);
    assert.equal(j.stations.hosting, 'ahead');
  });
});

describe('tx() and world.* translation keys', () => {
  it('falls back to English when t(key) returns key, and uses translations when present', () => {
    assert.equal(tx((k) => k, 'world.hosting.title', 'Live site'), 'Live site');
    assert.equal(
      tx((k) => k, 'world.domain.state.live', 'Live at {host}', { host: 'acme.com' }),
      'Live at acme.com',
    );
    assert.equal(
      tx((k) => (k === 'world.hosting.title' ? 'Live-site' : k), 'world.hosting.title', 'Live site'),
      'Live-site',
    );
  });

  it('prefixes every lookup key in stationsFor() with world.', () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const seen = [];
    const spyT = (key) => {
      seen.push(key);
      return key;
    };
    stationsFor({
      project: {
        id: 'p1',
        repo: 'https://github.com/acme/site',
        setup: {
          checks: [
            {
              key: 'domain',
              label: 'Your domain',
              state: 'pending',
              detail: 'Add DNS CNAME record.',
              owner: 'you',
              checked_at: Math.floor((now - 300_000) / 1000),
            },
            {
              key: 'ssl',
              label: 'SSL certificate',
              state: 'ready',
              detail: 'Certificate active.',
              owner: 'us',
            },
          ],
        },
      },
      sites: [
        {
          id: 's1',
          state: 'ready',
          domain: 'acme.com',
          previewDeploy: 'd2',
          productionDeploy: 'd1',
        },
      ],
      tickets: [{ id: 1, status: 'in_progress' }],
      t: spyT,
      now,
    });

    assert.ok(seen.length > 0);
    for (const key of seen) {
      assert.ok(key.startsWith('world.'), `Expected key "${key}" to start with "world."`);
    }
  });
});

describe('stationsFor() — setup checks mapping & timestamps', () => {
  it('maps real setup.ts keys and domain/dns/ssl/https/email/mx/host/repo/github/deploy onto the 5 stations', () => {
    assert.equal(stationForCheck({ key: 'domain', label: 'Your domain' }), 'hosting');
    assert.equal(stationForCheck({ key: 'code', label: 'The repo' }), 'code');
    assert.equal(stationForCheck({ key: 'preview', label: 'Preview URL' }), 'preview');
    assert.equal(stationForCheck({ key: 'deploy', label: 'Deploy pipeline' }), 'preview');
    assert.equal(stationForCheck({ key: 'brief', label: 'Your brief' }), null);
    assert.equal(stationForCheck({ key: 'workspace', label: 'A machine with a copy' }), null);
    assert.equal(stationForCheck({ key: 'request', label: 'First request' }), null);

    assert.equal(stationForCheck({ key: 'dns_records', label: 'DNS' }), 'hosting');
    assert.equal(stationForCheck({ key: 'email_mx', label: 'Email MX' }), 'hosting');
    assert.equal(stationForCheck({ key: 'mail_spf', label: 'Mail' }), 'hosting');
    assert.equal(stationForCheck({ key: 'mx', label: 'MX records' }), 'hosting');
    assert.equal(stationForCheck({ key: 'ssl_cert', label: 'SSL' }), 'hosting');
    assert.equal(stationForCheck({ key: 'https_check', label: 'HTTPS' }), 'hosting');
    assert.equal(stationForCheck({ key: 'site_host', label: 'Hosting' }), 'hosting');
    assert.equal(stationForCheck({ key: 'github_repo', label: 'GitHub' }), 'code');
    assert.equal(stationForCheck({ key: 'custom_1', label: 'SSL certificate' }), 'hosting');
    assert.equal(stationForCheck({ key: 'custom_2', label: 'Business email' }), 'hosting');
  });

  it('marks a station warn on a pending check with label, detail, Who, and timestamps when present', () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const map = byKey(
      stationsFor({
        project: {
          id: 'p1',
          setup: {
            checks: [
              {
                key: 'domain',
                label: 'Your domain',
                state: 'pending',
                detail: 'Point your domain DNS at Cloudflare.',
                owner: 'you',
                checked_at: Math.floor((now - 600_000) / 1000),
              },
              {
                key: 'code',
                label: 'The repo',
                state: 'pending',
                detail: 'We create it when your site is set up.',
                owner: 'us',
              },
            ],
          },
        },
        sites: [{ id: 's1', state: 'ready', productionUrl: 'https://bakery.ptechsolutions.dev' }],
        now,
      }),
    );

    assert.equal(map.hosting.state, 'warn');
    assert.equal(map.hosting.checks.length, 1);
    assert.equal(map.hosting.checks[0].label, 'Your domain');
    assert.equal(map.hosting.checks[0].whoText, 'Who: You');
    assert.equal(map.hosting.checks[0].checkedText, 'Checked 10m ago');

    assert.equal(map.code.state, 'warn');
    assert.equal(map.code.checks[0].whoText, 'Who: PTech');
    assert.equal(map.code.checks[0].checkedText, null);
  });

  it('upgrades unverified HTTPS on hosting ONLY when an ssl/https check explicitly has state ready', () => {
    const readyHttps = byKey(
      stationsFor({
        project: {
          id: 'p1',
          setup: {
            checks: [
              {
                key: 'https',
                label: 'HTTPS padlock',
                state: 'ready',
                detail: 'TLS certificate verified.',
                owner: 'us',
              },
            ],
          },
        },
        sites: [{ id: 's1', state: 'ready', domain: 'bakery.example.com' }],
      }),
    );
    assert.equal(readyHttps.hosting.meta.httpsVerified, true);

    for (const badState of ['missing', 'unknown', 'pending', 'ok']) {
      const res = byKey(
        stationsFor({
          project: {
            id: 'p1',
            setup: {
              checks: [
                {
                  key: 'ssl',
                  label: 'SSL certificate',
                  state: badState,
                  detail: 'Not ready yet.',
                  owner: 'us',
                },
              ],
            },
          },
          sites: [{ id: 's1', state: 'ready', domain: 'bakery.example.com' }],
        }),
      );
      assert.equal(res.hosting.meta.httpsVerified, false, `State "${badState}" must not verify HTTPS`);
    }
  });
});

describe('admin operator extras & probe omission', () => {
  it('omits browser HTTPS probe exports from admin model', () => {
    assert.equal('probeUrlFor' in model, false);
  });

  it('computes needs-you (new/review) and stalled (in_progress > 45m) counts on agent & request stations', () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const sec = (ms) => Math.floor(ms / 1000);
    const tickets = [
      { id: 1, project_id: 'p1', status: 'new', updated_at: sec(now - 600_000) },
      { id: 2, project_id: 'p1', status: 'review', updated_at: sec(now - 600_000) },
      { id: 3, project_id: 'p1', status: 'approved', updated_at: sec(now - 3600_000 * 5) },
      { id: 4, project_id: 'p1', status: 'in_progress', updated_at: sec(now - STALL_MS) },
      { id: 5, project_id: 'p1', status: 'in_progress', updated_at: sec(now - STALL_MS - 60_000) },
      { id: 6, project_id: 'p1', status: 'in_progress', updated_at: sec(now - 3600_000 * 3) },
      { id: 7, project_id: 'p1', status: 'done', updated_at: sec(now - 3600_000 * 10) },
    ];

    const counts = operatorTicketCounts({ id: 'p1' }, tickets, now);
    assert.equal(counts.needsYou, 2);
    assert.equal(counts.stalled, 2);

    const map = byKey(stationsFor({ project: { id: 'p1' }, tickets, now }));
    assert.equal(map.agent.state, 'bad');
    assert.equal(map.agent.meta.needsYou, 2);
    assert.equal(map.agent.meta.stalled, 2);
    assert.equal(map.request.meta.needsYou, 2);
    assert.equal(map.request.meta.stalled, 2);
  });

  it('returns null for operator counts when tickets are not loaded or in_progress lacks updated_at', () => {
    const unloaded = byKey(stationsFor({ project: { id: 'p1' } }));
    assert.equal(unloaded.agent.meta.needsYou, null);
    assert.equal(unloaded.agent.meta.stalled, null);
    assert.equal(unloaded.request.meta.needsYou, null);
    assert.equal(unloaded.request.meta.stalled, null);

    const untimed = byKey(
      stationsFor({
        project: { id: 'p1' },
        tickets: [{ id: 1, project_id: 'p1', status: 'in_progress' }],
      }),
    );
    assert.equal(untimed.agent.meta.needsYou, 0);
    assert.equal(untimed.agent.meta.stalled, null);
  });
});
