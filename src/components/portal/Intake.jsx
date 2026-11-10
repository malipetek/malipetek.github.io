/*
 * #/new: one box. The client says what they need; that becomes an intake
 * ticket, and the Worker's setup assistant creates the project, site, repo and
 * first request in the thread. It used to be a page of its own at
 * /portal/start, which now redirects here (src/lib/siteHosts.ts, MOVED).
 */
import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/portal';
import { go, useT, usePortal } from './store.js';
import { Button, cx } from './ui.jsx';

function titleFrom(text) {
  const first = text.trim().split(/\n/)[0].trim();
  const sentence = first.split(/(?<=[.!?])\s/)[0] || first;
  return sentence.slice(0, 140);
}

export function IntakeView() {
  const t = useT();
  const { data, reload } = usePortal();
  const [text, setText] = useState('');
  const [status, setStatus] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);
  const [github, setGithub] = useState(null);
  const [cloudflare, setCloudflare] = useState(null);

  // Connecting happens in another tab; coming back shows the result.
  useEffect(() => {
    const load = () => {
      api('/portal/github').then(setGithub, () => setGithub({ installations: [], installUrl: null }));
      api('/portal/cloudflare').then(setCloudflare, () => setCloudflare({ connections: [], connectUrl: null }));
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  const submit = async () => {
    const body = text.trim();
    if (!body) return setStatus({ text: t('start.intake.empty'), error: true });
    setBusy(true);
    setStatus({ text: t('start.intake.sending'), error: false });
    try {
      const { id } = await api('/portal/tickets', { body: { title: titleFrom(body), body, intake: true } });
      await reload();
      go(`ticket/${id}`);
    } catch (error) {
      setStatus({ text: errorText(error, t), error: true });
      setBusy(false);
    }
  };

  const installations = github?.installations ?? [];
  const connections = (cloudflare?.connections ?? []).filter((c) => !c.lapsed);
  const count = data.projects.length;

  return (
    <div className="cp-view cp-intake">
      <header className="cp-head">
        <div>
          <h1>{t('start.heading')}</h1>
          <p>{t('start.intake.lede')}</p>
        </div>
      </header>
      {count > 0 ? <p className="cp-muted">{t('start.already', { n: count })}</p> : null}

      <section className="cp-card">
        <label className="cp-field">
          <span className="cp-label">{t('start.intake.label')}</span>
          <textarea
            rows={7}
            maxLength={8000}
            placeholder={t('start.intake.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>

        <div className="cp-intake__connections">
          <Connection
            t={t}
            label="GitHub"
            connected={installations.length > 0}
            account={installations.map((i) => `@${i.account_login}`).join(', ')}
            href={github?.installUrl}
            note={t('start.intake.githubNote')}
          />
          <Connection
            t={t}
            label="Cloudflare"
            connected={connections.length > 0}
            account={connections[0]?.accounts?.map((a) => a.name).join(', ')}
            href={cloudflare?.connectUrl}
            note={t('start.intake.cloudflareNote')}
          />
        </div>

        <div className="cp-intake__actions">
          <Button kind="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? t('start.intake.sending') : t('start.intake.send')}
          </Button>
          <span className="cp-muted">{t('start.intake.note')}</span>
        </div>
        <p className={cx('cp-intake__status', status.error && 'is-error')} role="status" aria-live="polite">
          {status.text}
        </p>
      </section>
    </div>
  );
}

function Connection({ t, label, connected, account, href, note }) {
  return (
    <div className={cx('cp-intake__connection', connected && 'is-connected')}>
      <strong>{label}</strong>
      <span>{connected ? t('start.intake.connected', { account: account || label }) : note}</span>
      {!connected && href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {t('start.intake.connect', { label })}
        </a>
      ) : null}
    </div>
  );
}
