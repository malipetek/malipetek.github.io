/*
 * /portal: the client's workspace. A sidebar (overview, requests, projects,
 * billing, connections), the page, and dialogs for a new request and for
 * confirmations. Routes are in the hash (store.js); /portal/ticket#id=12, the
 * address in older emails, lands on #/ticket/12.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { demoLogin, errorText, logout, requestLink, session } from '../../lib/portal';
import { STEPS } from '../../lib/offer.js';
import { englishT, loadT } from '../../i18n/index.js';
import { fromAcceptLanguage } from '../../lib/locales.js';
import { Composer } from './Composer.jsx';
import { LanguageDialog } from './Language.jsx';
import { TicketView } from './TicketView.jsx';
import { BillingView, ConnectionsView, Overview, ProjectView, RequestsView } from './views.jsx';
import { PortalContext, go, href, isOpen, signedIn, usePortalData, useRoute } from './store.js';
import { Button, Confirm, Icon, cx } from './ui.jsx';

export default function ClientPortal() {
  const [authed, setAuthed] = useState(() => {
    // The old ticket address: move it onto the app's own route.
    if (window.location.pathname.replace(/\/$/, '') === '/portal/ticket') {
      const id = new URLSearchParams(window.location.hash.slice(1)).get('id');
      window.history.replaceState(null, '', `/portal${id ? `#/ticket/${id}` : ''}`);
    }
    return signedIn();
  });
  const [data, reload] = usePortalData(authed);
  const lost = data.error && (data.error.status === 401 || !session.get());
  useEffect(() => {
    if (lost) setAuthed(false);
  }, [lost]);
  // Their saved language once signed in; the browser's before that.
  const t = useTranslator(data.user?.locale ?? fromAcceptLanguage(navigator.languages?.join(',') || navigator.language));

  if (!authed) return <SignIn t={t} />;
  if (!data.loaded) return <p className="cp-boot">{t('common.loading')}</p>;
  if (!data.user) {
    return (
      <div className="cp-boot">
        <p>{errorText(data.error)}</p>
        <Button onClick={() => void reload()}>{t('common.tryAgain')}</Button>
      </div>
    );
  }
  return <Shell data={data} reload={reload} t={t} onSignedOut={() => setAuthed(false)} />;
}

/** t for a locale: English at once, the locale's catalog as soon as it has loaded. */
function useTranslator(locale) {
  const [t, setT] = useState(() => englishT);
  useEffect(() => {
    let live = true;
    document.documentElement.lang = locale;
    loadT(locale).then((next) => live && setT(() => next));
    return () => {
      live = false;
    };
  }, [locale]);
  return t;
}

function Shell({ data, reload, t, onSignedOut }) {
  const route = useRoute();
  const [composing, setComposing] = useState(null);
  const [ask, setAsk] = useState(null);
  const [toast, setToast] = useState(null);
  const [menu, setMenu] = useState(false);
  const [language, setLanguage] = useState(false);

  const notify = useCallback((text, kind = 'ok') => setToast({ text, kind, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => setMenu(false), [route]);

  // N: a new request, from anywhere but a text field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.cp-scrim')) return;
      e.preventDefault();
      setComposing({ preset: undefined });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ctx = useMemo(
    () => ({ data, reload, notify, t, ask: setAsk, compose: (preset) => setComposing({ preset }) }),
    [data, reload, notify, t],
  );

  const open = data.tickets.filter(isOpen).length;
  const attention = data.tickets.filter((t) => t.unread).length;
  const nav = [
    { key: 'overview', path: '', label: t('nav.overview'), icon: 'home' },
    { key: 'requests', path: 'requests', label: t('nav.requests'), icon: 'list', count: open, alert: attention },
    { key: 'billing', path: 'billing', label: t('nav.billing'), icon: 'receipt' },
    { key: 'connections', path: 'connections', label: t('nav.connections'), icon: 'plug' },
  ];
  const ticketProject = route.name === 'ticket' ? data.tickets.find((t) => String(t.id) === route.id)?.project_id : null;

  return (
    <PortalContext.Provider value={ctx}>
      <div className={cx('cp', menu && 'is-menu')}>
        <header className="cp-topbar">
          <button type="button" className="cp-iconbtn" aria-label={t('nav.menu')} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="menu" size={18} />
          </button>
          <a className="cp-brand" href={href('')}>
            malipetek<span>/portal</span>
          </a>
          <button type="button" className="cp-iconbtn" aria-label={t('nav.newRequest')} onClick={() => setComposing({})}>
            <Icon name="plus" size={18} />
          </button>
        </header>

        <aside className="cp-side" aria-label={t('nav.portal')}>
          <a className="cp-brand cp-side__brand" href={href('')}>
            malipetek<span>/portal</span>
          </a>
          <Button kind="primary" className="cp-side__new" onClick={() => setComposing({})} title={t('nav.newRequestKey')}>
            <Icon name="plus" size={15} /> {t('nav.newRequest')} <kbd>N</kbd>
          </Button>
          <nav className="cp-nav">
            {nav.map((n) => (
              <a key={n.key} href={href(n.path)} aria-current={route.name === n.key ? 'page' : undefined}>
                <Icon name={n.icon} size={17} />
                <span>{n.label}</span>
                {n.alert ? <span className="cp-nav__alert" title={t('nav.newReplies', { n: n.alert })}>{n.alert}</span> : n.count ? <span className="cp-nav__count">{n.count}</span> : null}
              </a>
            ))}
          </nav>
          <h3 className="cp-side__h">{t('nav.projects')}</h3>
          <nav className="cp-nav cp-nav--projects">
            {data.projects.map((p) => {
              const live = p.site?.state === 'ready';
              const ahead = live && p.site.previewDeploy && p.site.previewDeploy !== p.site.productionDeploy;
              const n = data.tickets.filter((t) => t.project_id === p.id && isOpen(t)).length;
              return (
                <a key={p.id} href={href(`project/${p.id}`)} aria-current={(route.name === 'project' && route.id === p.id) || ticketProject === p.id ? 'page' : undefined}>
                  <span className={cx('cp-project__dot', live ? (ahead ? 'is-ahead' : 'is-live') : p.site?.state === 'failed' ? 'is-bad' : 'is-wait')} />
                  <span>{p.name}</span>
                  {n ? <span className="cp-nav__count">{n}</span> : null}
                </a>
              );
            })}
            <a href="/portal/start" className="cp-nav__add">
              <Icon name="plus" size={15} />
              <span>{t('nav.addProject')}</span>
            </a>
          </nav>
          <span className="cp-side__fill" />
          <div className="cp-side__foot">
            <span className="cp-side__who" title={data.user.email}>
              {data.user.email}
            </span>
            <div className="cp-side__tools">
              {data.user.role === 'admin' ? (
                <a className="cp-iconbtn" href="/portal/admin" title={t('nav.admin')}>
                  <Icon name="admin" size={16} />
                </a>
              ) : null}
              <button type="button" className="cp-iconbtn" title={t('nav.language')} onClick={() => setLanguage(true)}>
                <Icon name="globe" size={16} />
              </button>
              <ThemeButton t={t} />
              <button
                type="button"
                className="cp-iconbtn"
                title={t('nav.signOut')}
                onClick={async () => {
                  await logout().catch(() => {});
                  onSignedOut();
                }}
              >
                <Icon name="out" size={16} />
              </button>
            </div>
            <a className="cp-side__site" href="/">
              {t('nav.backToSite')}
            </a>
          </div>
        </aside>
        <button type="button" className="cp-sidescrim" aria-label={t('nav.closeMenu')} onClick={() => setMenu(false)} tabIndex={-1} />

        <main className="cp-main">
          <Route route={route} />
        </main>

        {toast ? (
          <div className={cx('cp-toast', toast.kind === 'error' && 'is-error')} role="status">
            {toast.text}
          </div>
        ) : null}
        {composing ? (
          <Composer
            projects={data.projects}
            preset={composing.preset}
            onClose={() => setComposing(null)}
            onSent={async (id) => {
              setComposing(null);
              notify(t('toast.requestSent', { id }));
              await reload();
              go(`ticket/${id}`);
            }}
          />
        ) : null}
        {ask ? <Confirm ask={ask} onClose={() => setAsk(null)} errorText={errorText} /> : null}
        {language ? (
          <LanguageDialog
            user={data.user}
            onClose={() => setLanguage(false)}
            onSaved={async () => {
              setLanguage(false);
              await reload();
            }}
          />
        ) : null}
      </div>
    </PortalContext.Provider>
  );
}

function Route({ route }) {
  switch (route.name) {
    case 'ticket':
      return <TicketView key={route.id} id={Number(route.id)} />;
    case 'project':
      return <ProjectView id={route.id} />;
    case 'requests':
      return <RequestsView query={route.query} />;
    case 'billing':
      return <BillingView />;
    case 'connections':
      return <ConnectionsView />;
    default:
      return <Overview />;
  }
}

/** The site's theme switch (src/layouts/Base.astro keeps the same key). */
function ThemeButton({ t }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  return (
    <button
      type="button"
      className="cp-iconbtn"
      title={dark ? t('theme.light') : t('theme.dark')}
      onClick={() => {
        const next = dark ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('theme', next);
        setDark(!dark);
      }}
    >
      <Icon name={dark ? 'sun' : 'moon'} size={16} />
    </button>
  );
}

/* ————— signed out ————— */

function SignIn({ t }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [withCode, setWithCode] = useState(false);
  const [note, setNote] = useState({ text: '', error: false, dev: null });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNote({ text: t('common.sending'), error: false, dev: null });
    try {
      if (code.trim()) {
        const res = await demoLogin(email.trim(), code.trim());
        session.set(res.session);
        window.location.reload();
        return;
      }
      const res = await requestLink(email.trim());
      // Local dev only: the Worker hands the link back instead of emailing it.
      setNote({ text: t('signin.checkInbox', { email: email.trim() }), error: false, dev: res.devLink ?? null });
    } catch (error) {
      setNote({ text: errorText(error), error: true, dev: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cp-signin">
      <div className="cp-signin__card">
        <a className="cp-brand" href="/">
          malipetek<span>/portal</span>
        </a>
        <h1>{t('signin.title')}</h1>
        <p className="cp-muted">{t('signin.intro')}</p>
        <form onSubmit={submit}>
          <label className="cp-field">
            <span className="cp-label">{t('signin.email')}</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {withCode ? (
            <label className="cp-field">
              <span className="cp-label">{t('signin.reviewerCode')}</span>
              <input type="text" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          ) : null}
          <Button kind="primary" disabled={busy} type="submit" className="cp-signin__go">
            {code.trim() ? t('signin.withCode') : t('signin.emailLink')}
          </Button>
          <p className={cx('cp-signin__note', note.error && 'is-error')} role="status" aria-live="polite">
            {note.text} {note.dev ? <a href={note.dev}>{t('signin.devLink')}</a> : null}
          </p>
        </form>
        {!withCode ? (
          <button type="button" className="cp-linkbtn" onClick={() => setWithCode(true)}>
            {t('signin.haveCode')}
          </button>
        ) : null}
      </div>
      <ol className="cp-signin__steps">
        {STEPS.map((step, i) => (
          <li key={step.key}>
            <b>{String(i + 1).padStart(2, '0')}</b> {step.title}
          </li>
        ))}
      </ol>
    </div>
  );
}
