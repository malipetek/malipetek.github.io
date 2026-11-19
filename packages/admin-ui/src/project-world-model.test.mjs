/*
 * Unit tests for packages/admin-ui/src/project-world-model.mjs.
 *
 * Origin: ported from ptechsolutions-site/src/components/portal/project-world-model.test.mjs
 * (browser HTTPS probe tests omitted because admin does not probe client sites;
 * admin operator-count and snake_case field tests added).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as model from './project-world-model.mjs';
import {
  DEFAULT_ISO,
  ISO_COS,
  ISO_SIN,
  STALL_MS,
  cablesFor,
  floorDots,
  iso,
  isoBox,
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

describe('stationsFor() — site & hosting states', () => {
  it('handles a project with no site', () => {
    const map = byKey(
      stationsFor({
        project: { id: 'p1', name: 'Bakery', kind: 'existing' },
        sites: [],
        tickets: [],
      }),
    );

    assert.equal(Object.keys(map).length, 8);
    assert.equal(map.domain.state, 'off');
    assert.equal(map.domain.stateText, 'Not connected yet');
    assert.equal(map.hosting.state, 'off');
    assert.equal(map.https.state, 'unknown');
    assert.equal(map.preview.state, 'off');
    assert.equal(map.deploy.state, 'off');
    assert.equal(map.code.state, 'off');
    assert.equal(map.agent.state, 'off');
    assert.equal(map.request.state, 'off');
  });

  it('handles a ready HTTPS site on Cloudflare and on PTech hosting', () => {
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

    assert.equal(cfMap.domain.state, 'ok');
    assert.equal(cfMap.domain.stateText, 'Live at example.com');
    assert.equal(cfMap.hosting.state, 'ok');
    assert.match(cfMap.hosting.stateText, /Cloudflare \(your account\)/);
    assert.equal(cfMap.https.state, 'ok');
    assert.match(cfMap.https.stateText, /HTTPS/);

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

    assert.equal(ptechMap.domain.state, 'ok');
    assert.equal(ptechMap.domain.stateText, 'Live at florist.example.org');
    assert.equal(ptechMap.hosting.state, 'ok');
    assert.match(ptechMap.hosting.stateText, /PTech hosting/);
    assert.equal(ptechMap.https.state, 'ok');
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

    assert.equal(map.domain.state, 'bad');
    assert.equal(map.hosting.state, 'bad');
    assert.match(map.hosting.stateText, /Cloudflare \(your account\)/);
    assert.equal(map.https.state, 'unknown');
    assert.equal(map.deploy.state, 'bad');
  });

  it('handles a building/waiting site as active and keeps HTTPS unknown', () => {
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

    assert.equal(map.domain.state, 'active');
    assert.equal(map.hosting.state, 'active');
    assert.equal(map.https.state, 'unknown');
  });

  it('never marks unknown or non-HTTPS connections as ok', () => {
    const cases = [
      { id: 's1', state: 'ready', domain: 'example.com' },
      { id: 's2', state: 'ready', hostname: 'shop.example.com' },
      { id: 's3', state: 'ready', url: 'http://example.com' },
      { id: 's4', state: 'building', url: 'https://example.com' },
      { id: 's5', state: 'ready' },
    ];

    for (const site of cases) {
      const map = byKey(stationsFor({ project: { id: 'p1' }, sites: [site] }));
      assert.equal(map.https.state, 'unknown', `Expected unknown https for ${JSON.stringify(site)}`);
      assert.notEqual(map.https.state, 'ok');
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

describe('stationsFor() — deploys, agent, and request inbox', () => {
  it('reads latest deploy status and time, or stays neutral when omitted', () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const liveSite = { id: 's1', state: 'ready', url: 'https://example.com' };

    const neutral = byKey(stationsFor({ project: { id: 'p1' }, sites: [liveSite], deploys: null }));
    assert.equal(neutral.deploy.state, 'off');

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
    assert.equal(okDeploy.deploy.state, 'ok');
    assert.match(okDeploy.deploy.stateText, /10m ago/);

    const buildingDeploy = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [liveSite],
        deploys: [{ id: 'd3', status: 'building', created_at: Math.floor(now / 1000) }],
        now,
      }),
    );
    assert.equal(buildingDeploy.deploy.state, 'active');

    const failedDeploy = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [liveSite],
        deploys: [{ id: 'd4', status: 'failed', created_at: Math.floor((now - 120_000) / 1000) }],
        now,
      }),
    );
    assert.equal(failedDeploy.deploy.state, 'bad');
    assert.match(failedDeploy.deploy.stateText, /2m ago/);
  });

  it('activates agent desk for in_progress/review tickets and counts open requests accurately', () => {
    const tickets = [
      { id: 1, project_id: 'p1', status: 'new' },
      { id: 2, project_id: 'p1', status: 'approved' },
      { id: 3, project_id: 'p1', status: 'in_progress' },
      { id: 4, project_id: 'p1', status: 'review' },
      { id: 5, project_id: 'p1', status: 'done' },
      { id: 6, project_id: 'p1', status: 'declined' },
      { id: 7, project_id: 'other', status: 'in_progress' },
    ];

    const map = byKey(
      stationsFor({
        project: { id: 'p1', name: 'Bakery' },
        sites: [{ id: 's1', state: 'ready', url: 'https://example.com' }],
        tickets,
      }),
    );

    assert.equal(map.request.state, 'active');
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
    assert.ok(dots.some((d) => d.active && d.stationKey === 'request'));
  });

  it('keeps agent idle when tickets are only new or approved', () => {
    const map = byKey(
      stationsFor({
        project: { id: 'p1' },
        tickets: [
          { id: 1, status: 'new' },
          { id: 2, status: 'approved' },
        ],
      }),
    );

    assert.equal(map.request.state, 'active');
    assert.equal(map.request.stateText, '2 open requests');
    assert.equal(map.agent.state, 'off');
  });
});

describe('tx() and world.* translation keys', () => {
  it('falls back to English when t(key) returns key, and uses translations when present', () => {
    assert.equal(tx((k) => k, 'world.domain.title', 'Your web address'), 'Your web address');
    assert.equal(
      tx((k) => k, 'world.domain.state.live', 'Live at {host}', { host: 'acme.com' }),
      'Live at acme.com',
    );
    assert.equal(
      tx((k) => (k === 'world.domain.title' ? 'Webadres' : k), 'world.domain.title', 'Your web address'),
      'Webadres',
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

describe('stationsFor() — preview station & build cable routing', () => {
  it('derives off, ok, and active states from real previewDeploy / productionDeploy fields', () => {
    const noPreview = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [{ id: 's1', state: 'ready', productionUrl: 'https://bakery.ptechsolutions.dev' }],
      }),
    );
    assert.equal(noPreview.preview.state, 'off');
    assert.equal(
      noPreview.preview.explain,
      'A private copy of your site where changes are checked before going live.',
    );

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
    assert.equal(ahead.preview.state, 'active');
    assert.equal(ahead.preview.stateText, 'A newer version is waiting to be published');

    const previewOnlyLive = byKey(
      stationsFor({
        project: { id: 'p1' },
        sites: [
          {
            id: 's1',
            state: 'ready',
            previewDeploy: 'd101',
            productionDeploy: null,
          },
        ],
      }),
    );
    assert.equal(previewOnlyLive.preview.state, 'active');
    assert.equal(previewOnlyLive.preview.stateText, 'A newer version is waiting to be published');
  });

  it('routes build cables through code → deploy → preview → hosting', () => {
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
    const ids = cables.map((c) => c.id);
    assert.ok(ids.includes('code-deploy'));
    assert.ok(ids.includes('deploy-preview'));
    assert.ok(ids.includes('preview-hosting'));
    assert.ok(!ids.includes('deploy-hosting'));

    const deployPreview = cables.find((c) => c.id === 'deploy-preview');
    const previewHosting = cables.find((c) => c.id === 'preview-hosting');
    assert.equal(deployPreview.from, 'deploy');
    assert.equal(deployPreview.to, 'preview');
    assert.equal(previewHosting.from, 'preview');
    assert.equal(previewHosting.to, 'hosting');
    assert.equal(deployPreview.active, true);
    assert.equal(previewHosting.active, true);
  });
});

describe('stationsFor() — setup checks mapping & timestamps', () => {
  it('maps real setup.ts keys and domain/dns/ssl/https/email/mx/host/repo/github substrings', () => {
    assert.equal(stationForCheck({ key: 'domain', label: 'Your domain' }), 'domain');
    assert.equal(stationForCheck({ key: 'code', label: 'The repo' }), 'code');
    assert.equal(stationForCheck({ key: 'preview', label: 'Preview URL' }), 'preview');
    assert.equal(stationForCheck({ key: 'brief', label: 'Your brief' }), null);
    assert.equal(stationForCheck({ key: 'workspace', label: 'A machine with a copy' }), null);
    assert.equal(stationForCheck({ key: 'request', label: 'First request' }), null);

    assert.equal(stationForCheck({ key: 'dns_records', label: 'DNS' }), 'domain');
    assert.equal(stationForCheck({ key: 'email_mx', label: 'Email MX' }), 'domain');
    assert.equal(stationForCheck({ key: 'mail_spf', label: 'Mail' }), 'domain');
    assert.equal(stationForCheck({ key: 'mx', label: 'MX records' }), 'domain');
    assert.equal(stationForCheck({ key: 'ssl_cert', label: 'SSL' }), 'https');
    assert.equal(stationForCheck({ key: 'https_check', label: 'HTTPS' }), 'https');
    assert.equal(stationForCheck({ key: 'site_host', label: 'Hosting' }), 'hosting');
    assert.equal(stationForCheck({ key: 'github_repo', label: 'GitHub' }), 'code');
    assert.equal(stationForCheck({ key: 'custom_1', label: 'SSL certificate' }), 'https');
    assert.equal(stationForCheck({ key: 'custom_2', label: 'Business email' }), 'domain');
  });

  it('marks a station warn on a pending check with label, detail, Who, and no time when timestamp is absent', () => {
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
      }),
    );

    assert.equal(map.domain.state, 'warn');
    assert.equal(map.domain.checks.length, 1);
    assert.equal(map.domain.checks[0].label, 'Your domain');
    assert.equal(map.domain.checks[0].detail, 'Point your domain DNS at Cloudflare.');
    assert.equal(map.domain.checks[0].whoText, 'Who: You');
    assert.equal(map.domain.checks[0].checkedAt, null);
    assert.equal(map.domain.checks[0].checkedText, null);

    assert.equal(map.code.state, 'warn');
    assert.equal(map.code.checks.length, 1);
    assert.equal(map.code.checks[0].whoText, 'Who: PTech');
    assert.equal(map.code.checks[0].checkedText, null);
  });

  it('shows "Checked <relative time>" only when a check carries checked_at, at, or updated', () => {
    const now = Date.UTC(2026, 10, 19, 12, 0, 0);
    const map = byKey(
      stationsFor({
        project: {
          id: 'p1',
          setup: {
            checks: [
              {
                key: 'dns',
                label: 'DNS check',
                state: 'pending',
                detail: 'Waiting for propagation.',
                owner: 'you',
                checked_at: Math.floor((now - 600_000) / 1000),
              },
              {
                key: 'email',
                label: 'MX records',
                state: 'ready',
                detail: 'Mail records verified.',
                owner: 'us',
                at: now - 3600_000 * 2,
              },
              {
                key: 'hosting',
                label: 'Hosting health',
                state: 'ready',
                detail: 'Edge responding.',
                owner: 'us',
                updated: new Date(now - 120_000).toISOString(),
              },
              {
                key: 'repo',
                label: 'GitHub repo',
                state: 'ready',
                detail: 'Connected.',
                owner: 'you',
              },
            ],
          },
        },
        now,
      }),
    );

    assert.equal(map.domain.checks[0].checkedText, 'Checked 10m ago');
    assert.equal(map.domain.checks[1].checkedText, 'Checked 2h ago');
    assert.equal(map.hosting.checks[0].checkedText, 'Checked 2m ago');
    assert.equal(map.code.checks[0].checkedText, null);
  });

  it('upgrades unknown https/domain to ok ONLY when a mapped check explicitly has state ready', () => {
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
    assert.equal(readyHttps.https.state, 'ok');
    assert.equal(readyHttps.https.meta.verified, true);

    const readyDomain = byKey(
      stationsFor({
        project: {
          id: 'p1',
          setup: {
            checks: [
              {
                key: 'domain',
                label: 'Your domain',
                state: 'ready',
                detail: 'Live at bakery.example.com.',
                owner: 'you',
              },
            ],
          },
        },
        sites: [{ id: 's1', state: 'ready' }],
      }),
    );
    assert.equal(readyDomain.domain.state, 'ok');
    assert.equal(readyDomain.domain.stateText, 'Live at bakery.example.com.');

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
      assert.notEqual(res.https.state, 'ok', `State "${badState}" must not upgrade unknown https to ok`);
      if (badState === 'pending') {
        assert.equal(res.https.state, 'warn');
      } else {
        assert.equal(res.https.state, 'unknown');
      }
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
      { id: 4, project_id: 'p1', status: 'in_progress', updated_at: sec(now - STALL_MS) }, // exact 45m: not stalled
      { id: 5, project_id: 'p1', status: 'in_progress', updated_at: sec(now - STALL_MS - 60_000) }, // 46m: stalled
      { id: 6, project_id: 'p1', status: 'in_progress', updated_at: sec(now - 3600_000 * 3) }, // 3h: stalled
      { id: 7, project_id: 'p1', status: 'done', updated_at: sec(now - 3600_000 * 10) },
      { id: 8, project_id: 'other', status: 'new', updated_at: sec(now - 3600_000 * 10) },
      { id: 9, project_id: 'other', status: 'in_progress', updated_at: sec(now - 3600_000 * 10) },
    ];

    const counts = operatorTicketCounts({ id: 'p1' }, tickets, now);
    assert.equal(counts.needsYou, 2);
    assert.equal(counts.stalled, 2);

    const map = byKey(stationsFor({ project: { id: 'p1' }, tickets, now }));
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
