/*
 * /portal, signed out. Not a front door: the workspace's own frame — the
 * sidebar, the board, the cards under it — with the way in sitting in it, so
 * the page a visitor lands on is the page they will work in.
 *
 * The room is the site's own workshop (src/lib/workshop3d.ts, initWorkshop,
 * exactly as the homepage draws it), which is what lets the hop from the site
 * carry the machine over (base.css, "the machine stays").
 */
import { useEffect, useState } from 'react';
import { demoLogin, errorText, requestLink, session } from '../../lib/portal';
import { STEPS } from '../../lib/offer.js';
import { stepText } from './copy.js';
import { Brand, Button, cx } from './ui.jsx';
import { arrivingBox, placeScene } from './sceneHandover.js';

export function GuestShell({ t }) {
  return (
    <div className="cp cp--guest">
      {/* The 3D room lives behind the whole portal, as it does signed in. */}
      <div className="cp-scene" aria-hidden="true" />
      <header className="cp-topbar">
        <span className="cp-iconbtn" />
        <Brand href="/portal" />
        <span className="cp-iconbtn" />
      </header>

      <aside className="cp-side">
        <Brand href="/portal" className="cp-side__brand" />
        <Button
          kind="primary"
          className="cp-side__new"
          onClick={() => document.getElementById('the-way-in')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        >
          {t('signin.title')}
        </Button>
        <p className="cp-side__note">{t('signin.intro')}</p>
      </aside>

      <main className="cp-main">
        <div className="cp-view cp-view--board">
          <GuestBoard />

          <div className="cp-overview cp-overview--guest">
            <section className="cp-signin cp-signin--panel" id="the-way-in">
              <SignInCard t={t} />
            </section>
            <div className="cp-overview__side">
              <section className="cp-card">
                <ol className="cp-signin__steps">
                  {STEPS.map((step, i) => (
                    <li key={step.key}>
                      <b>{String(i + 1).padStart(2, '0')}</b> {stepText(t, step, 'title')}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * The room, signed out: the homepage's own workshop, drawn exactly as the
 * homepage draws it (initWorkshop, full window, same camera and lens shift),
 * so the machine a visitor follows from the site is the one standing here.
 * The stage keeps its place in the layout; nothing in it can be picked.
 */
function GuestBoard() {
  useEffect(() => {
    let stop = null;
    let view = null;
    let stopped = false;
    let placed = false;
    // Arriving from the homepage: start from the frame it left on (its
    // pointer and clock), so the hand-over to this canvas is invisible.
    const left = arrivingBox();
    import('../../lib/workshop3d')
      .then(({ initWorkshop }) => {
        const host = document.querySelector('.cp--guest .cp-scene');
        if (stopped || !host) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'cp-workshop';
        canvas.setAttribute('aria-hidden', 'true');
        // One room at a time: a second mount (a hot reload, an effect run
        // twice) must not leave the first renderer drawing under this one.
        host.replaceChildren(canvas);
        view = canvas;
        stop = initWorkshop(canvas, {
          start: left ? { mouse: left.mouse, time: left.time } : undefined,
          // The machine that left the site lands on this one (once).
          onFrame: (box) => {
            if (!placed) placed = placeScene(box);
          },
        });
      })
      .catch(() => {}); // no WebGL: the sign-in card and the steps carry it
    return () => {
      stopped = true;
      stop?.();
      view?.remove();
    };
  }, []);

  return (
    <div className="cp-board cp-board--guest">
      <div className="cp-board__stage" />
    </div>
  );
}

/** The way in: the same form as before, sitting in the workspace now. */
function SignInCard({ t }) {
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
      setNote({ text: errorText(error, t), error: true, dev: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cp-signin__card">
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
  );
}
