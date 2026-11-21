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
import { Button, Dot, Empty, ErrorNote, PageHeader, Skeleton, Tag, cx } from './ui.jsx';

const tone = (status) => (status === 'ok' ? 'ok' : status === 'fail' ? 'bad' : 'warn');

/** One check on one line: dot, name, detail (muted, clipped), age. */
function CheckRow({ check }) {
  return (
    <li className={cx('aw-health__row', `aw-health__row--${tone(check.status)}`)}>
      <Dot state={tone(check.status)} />
      <strong className="aw-health__name">{check.label}</strong>
      <span className="aw-health__detail aw-muted" title={check.detail}>{check.detail}</span>
      <span className="aw-health__meta aw-muted">
        {check.status === 'skip' ? <Tag tone="dash">skipped</Tag> : null}
        {check.failingSince ? <Tag tone="bad">failing {ago(check.failingSince)}</Tag> : null}
        {check.latencyMs !== null ? `${check.latencyMs} ms · ` : ''}
        {ago(check.checkedAt)}
      </span>
    </li>
  );
}

export function HealthView({ compact = false }) {
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

  const runNow = (
    <Button
      size="sm"
      busy={busy}
      onClick={() => {
        setBusy(true);
        void act(() => api('POST', '/admin/health/run'), 'Checks rerun.')
          .then(load, load)
          .finally(() => setBusy(false));
      }}
    >
      Run checks now
    </Button>
  );

  const failing = state.checks.filter((c) => c.status === 'fail');
  const passing = state.checks.filter((c) => c.status !== 'fail');
  const okCount = state.checks.filter((c) => c.status === 'ok').length;
  const list = (checks) => <ul className="aw-health__list">{checks.map((check) => <CheckRow key={check.name} check={check} />)}</ul>;

  const body = (
    <>
      {state.error ? <ErrorNote error={state.error.message ? state.error : { message: 'Could not read the checks.' }} onRetry={load} /> : null}
      {state.loading ? <Skeleton variant="rows" rows={compact ? 2 : 6} label="Reading health checks…" /> : null}
      {!state.loading && !state.error && !state.checks.length ? <Empty inline title="No checks reported yet." hint="The checks run every five minutes; Run now runs them at once." /> : null}
      {compact ? (
        <>
          {failing.length ? list(failing) : null}
          {passing.length ? (
            <details className="aw-health__pass">
              <summary>{passing.length} passing</summary>
              {list(passing)}
            </details>
          ) : null}
        </>
      ) : (
        list(state.checks)
      )}
    </>
  );

  if (compact) {
    return (
      <section className="aw-group aw-health--compact">
        <header className="aw-row-h aw-health__summary" title="Every check runs every five minutes. A failing check mails you once, and again when it recovers.">
          <Dot state={state.loading || state.error ? 'warn' : failing.length ? 'bad' : 'ok'} />
          <h3>Health</h3>
          {!state.loading && !state.error && state.checks.length ? (
            <span className="aw-muted">
              {okCount} of {state.checks.length} ok{state.ranAt ? ` · last run ${ago(state.ranAt)} ago` : ''}
            </span>
          ) : null}
          <span className="aw-toolbar__fill" />
          {runNow}
        </header>
        {body}
      </section>
    );
  }

  return (
    <div className="aw-view aw-health">
      <PageHeader
        title="Health"
        subtitle={`Every check runs every five minutes; a failing check mails you once, and again when it recovers.${state.ranAt ? ` Last run ${ago(state.ranAt)} ago.` : ''}`}
        meta={!state.loading && !state.error && state.checks.length ? (state.failing ? <Tag tone="bad">{state.failing} failing</Tag> : <Tag tone="ok">all green</Tag>) : null}
        actions={runNow}
      />
      {body}
    </div>
  );
}
