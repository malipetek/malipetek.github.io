/*
 * /portal: the client's workspace. A sidebar (overview, requests, projects,
 * billing, connections), the page, and dialogs for a new request and for
 * confirmations. Routes are in the hash (store.js); /portal/ticket#id=12, the
 * address in older emails, lands on #/ticket/12.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { errorText, logout, session } from '../../lib/portal';
import { browserLocale, useTranslator } from './useTranslator.js';
import { Composer } from './Composer.jsx';
import { LanguageDialog } from './Language.jsx';
import { TicketView } from './TicketView.jsx';
import { BillingView, ConnectionsView, Overview, ProjectView, RequestsView } from './views.jsx';
import { PortalContext, go, href, isOpen, signedIn, usePortalData, useRoute } from './store.js';
import { Brand, Button, Confirm, Icon, cx } from './ui.jsx';
import { GuestShell } from './Guest.jsx';

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
  const t = useTranslator(data.user?.locale ?? browserLocale());
  // The page's static first frame (PortalFrame.astro) stood in until now;
  // this render draws the same mark in the same place, so the frame goes
  // before the next paint, or once the transition into the page has ended.
  useLayoutEffect(() => {
    const handOver = () => {
      document.querySelector('[data-portal-frame]')?.remove();
      delete document.documentElement.dataset.portalArriving;
    };
    if (window.portalArrival) window.portalArrival.then(handOver, handOver);
    else handOver();
  }, []);

  if (!authed) return <GuestShell t={t} />;
  if (!data.loaded) return <BootFrame>{t('common.loading')}</BootFrame>;
  if (!data.user) {
    return (
      <BootFrame>
        <p>{errorText(data.error, t)}</p>
        <Button onClick={() => void reload()}>{t('common.tryAgain')}</Button>
      </BootFrame>
    );
  }
  return <Shell data={data} reload={reload} t={t} onSignedOut={() => setAuthed(false)} />;
}

/**
 * The workspace's frame while it loads: the shell's topbar and sidebar with
 * the mark where the shell has it, so the mark holds still from the first
 * frame to the loaded workspace. PortalFrame.astro is the same markup.
 */
function BootFrame({ children }) {
  return (
    <div className="cp">
      <header className="cp-topbar">
        <span className="cp-iconbtn" />
        <Brand href={href('')} />
        <span className="cp-iconbtn" />
      </header>
      <aside className="cp-side">
        <Brand href={href('')} className="cp-side__brand" />
      </aside>
      <main className="cp-main cp-boot" role="status" aria-live="polite">
        {children}
      </main>
    </div>
  );
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
        {/* The 3D room lives behind the whole portal, under the sidebar and cards. */}
        <div className="cp-scene" aria-hidden="true" />
        <header className="cp-topbar">
          <button type="button" className="cp-iconbtn" aria-label={t('nav.menu')} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="menu" size={18} />
          </button>
          <Brand href={href('')} />
          <button type="button" className="cp-iconbtn" aria-label={t('nav.newRequest')} onClick={() => setComposing({})}>
            <Icon name="plus" size={18} />
          </button>
        </header>

        <aside className="cp-side" aria-label={t('nav.portal')}>
          <Brand href={href('')} className="cp-side__brand" />
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
