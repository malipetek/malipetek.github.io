/*
 * Health: the end-to-end checks, on one page.
 *
 * It reads /admin/health every 15 seconds, so a failed callback, an offline
 * node or a Worker behind master is visible without running anything. "Run
 * now" runs the same checks the cron does and mails any transition.
 */
import { useCallback, useEffect, useState } from 'react';
import { ago } from './format.js';
import { useAdmin } from './store.js';
import { Button, Dot, Tag, cx } from './ui.jsx';

const tone = (status) => (status === 'ok' ? 'ok' : status === 'fail' ? 'bad' : 'warn');

export function HealthView() {
  const { api, act } = useAdmin();
  const [state, setState] = useState({ loading: true, checks: [], failing: 0, ranAt: null, error: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api('GET', '/admin/health')
        .then((d) => setState({ loading: false, checks: d.checks ?? [], failing: d.failing ?? 0, ranAt: d.ranAt ?? null, error: null }))
        .catch((error) => setState((s) => ({ ...s, loading: false, error }))),
    [api],
  );

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="aw-view aw-health">
      <header className="aw-hero">
        <h2>Health</h2>
        <span className="aw-toolbar__fill" />
        {state.failing ? (
          <Tag tone="bad">{state.failing} failing</Tag>
        ) : (
          <Tag tone="ok">all green</Tag>
        )}
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void act(() => api('POST', '/admin/health/run'), 'Checks rerun.')
              .then(load, load)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Running…' : 'Run now'}
        </Button>
      </header>

      <p className="aw-muted aw-health__intro">
        Every check runs every five minutes. A failing check mails you once, and mails again only when it recovers.
        {state.ranAt ? ` Last run ${ago(state.ranAt)}.` : ''}
      </p>

      {state.error ? <p className="aw-empty">{state.error.message ?? 'Could not read the checks.'}</p> : null}
      {state.loading && !state.checks.length ? <p className="aw-empty">Running the checks…</p> : null}

      <ul className="aw-health__list">
        {state.checks.map((check) => (
          <li key={check.name} className={cx('aw-health__row', `aw-health__row--${tone(check.status)}`)}>
            <Dot state={tone(check.status)} />
            <div className="aw-health__body">
              <strong>{check.label}</strong>
              <span className="aw-muted">{check.detail}</span>
            </div>
            <div className="aw-health__meta">
              {check.status === 'skip' ? <Tag tone="dash">skipped</Tag> : null}
              {check.failingSince ? <Tag tone="bad">failing {ago(check.failingSince)}</Tag> : null}
              <span className="aw-muted">
                {check.latencyMs !== null ? `${check.latencyMs} ms · ` : ''}
                {ago(check.checkedAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
