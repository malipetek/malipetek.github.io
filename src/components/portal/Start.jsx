/*
 * /portal/start: one box. The client says what they need; that becomes an
 * intake ticket, and the Worker's setup assistant creates the project, site,
 * repo and first request in the thread. The old multi-step form is gone.
 */
import { useEffect, useState } from 'react';
import { api, errorText, session } from '../../lib/portal';
import { browserLocale, useTranslator } from './useTranslator.js';

function titleFrom(text) {
  const first = text.trim().split(/\n/)[0].trim();
  const sentence = first.split(/(?<=[.!?])\s/)[0] || first;
  return sentence.slice(0, 140);
}

export default function Start() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [count, setCount] = useState(0);
  const [text, setText] = useState('');
  const [status, setStatus] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);
  const [github, setGithub] = useState(null);
  const [cloudflare, setCloudflare] = useState(null);
  const t = useTranslator(user?.locale ?? browserLocale());

  useEffect(() => {
    document.title = t('start.pageTitle');
  }, [t]);

  useEffect(() => {
    if (!session.get()) {
      setBooted(true);
      return;
    }
    api('/portal/me')
      .then(({ user: me, projects }) => {
        setUser(me);
        setCount(projects.length);
      })
      .catch(() => setUser(null))
      .finally(() => setBooted(true));
  }, []);

  const loadConnections = () => {
    if (!session.get()) return;
    api('/portal/github').then(setGithub, () => setGithub({ installations: [], installUrl: null }));
    api('/portal/cloudflare').then(setCloudflare, () => setCloudflare({ connections: [], connectUrl: null }));
  };
  useEffect(() => {
    loadConnections();
    const onFocus = () => loadConnections();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const submit = async () => {
    const body = text.trim();
    if (!body) return setStatus({ text: t('start.intake.empty'), error: true });
    setBusy(true);
    setStatus({ text: t('start.intake.sending'), error: false });
    try {
      const { id } = await api('/portal/tickets', { body: { title: titleFrom(body), body, intake: true } });
      window.location.href = `/portal#/ticket/${id}`;
    } catch (error) {
      setStatus({ text: errorText(error, t), error: true });
      setBusy(false);
    }
  };

  if (!booted) {
    return (
      <div className="portal">
        <p className="portal-note">{t('common.loading')}</p>
      </div>
    );
  }

  const installations = github?.installations ?? [];
  const connections = (cloudflare?.connections ?? []).filter((c) => !c.lapsed);

  return (
    <div className="portal">
      <div className="portal-bar">
        <h1>{t('start.heading')}</h1>
        {user ? (
          <div className="portal-who">
            <span>{user.email}</span>
            <a href="/portal">{t('start.who.requests')}</a>
          </div>
        ) : null}
      </div>

      {!user ? (
        <section className="portal-section">
          <p className="lede">{t('start.signedOut.lede')}</p>
          <p>
            <a className="btn btn--solid" href="/portal">
              {t('start.signedOut.cta')}
            </a>
          </p>
        </section>
      ) : (
        <section className="portal-section">
          <p className="lede">{t('start.intake.lede')}</p>
          {count > 0 ? <p className="portal-note">{t('start.already', { n: count })}</p> : null}

          <div className="portal-field start-field">
            <label className="portal-label" htmlFor="f-need">
              {t('start.intake.label')}
            </label>
            <textarea
              id="f-need"
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
          </div>

          <div className="start-connections">
            <ConnectionCard
              t={t}
              label="GitHub"
              connected={installations.length > 0}
              account={installations.map((i) => `@${i.account_login}`).join(', ')}
              href={github?.installUrl}
              note={t('start.intake.githubNote')}
            />
            <ConnectionCard
              t={t}
              label="Cloudflare"
              connected={connections.length > 0}
              account={connections[0]?.accounts?.map((a) => a.name).join(', ')}
              href={cloudflare?.connectUrl}
              note={t('start.intake.cloudflareNote')}
            />
          </div>

          <div className="portal-actions">
            <button className="btn btn--solid" type="button" disabled={busy} onClick={() => void submit()}>
              {busy ? t('start.intake.sending') : t('start.intake.send')}
            </button>
            <span className="portal-note">{t('start.intake.note')}</span>
          </div>
          <p className={`portal-note${status.error ? ' is-error' : ''}`} role="status" aria-live="polite">
            {status.text}
          </p>
        </section>
      )}
    </div>
  );
}

function ConnectionCard({ t, label, connected, account, href, note }) {
  return (
    <div className={`start-connection${connected ? ' is-connected' : ''}`}>
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
