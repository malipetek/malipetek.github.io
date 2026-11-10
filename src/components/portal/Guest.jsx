/*
 * /portal, signed out. Not a front door: the workspace's own frame — the
 * sidebar, the board, the cards under it — with the way in sitting in it, so
 * the page a visitor lands on is the page they will work in.
 *
 * The board draws the site's own machine (src/lib/workshop3d.ts, initBoard
 * with no requests on it), which is what lets the hop from the site carry the
 * machine over (base.css, "the machine arrives").
 */
import { useEffect, useRef, useState } from 'react';
import { demoLogin, errorText, requestLink, session } from '../../lib/portal';
import { STEPS } from '../../lib/offer.js';
import { STAGES, stageText } from './Board.jsx';
import { stepText } from './copy.js';
import { Brand, Button, cx } from './ui.jsx';

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
          <GuestBoard t={t} />

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
 * The board with nothing on it yet: the same machine, the same station
 * captions, framed into the content area. Nothing is draggable and nothing
 * can be picked — it is the room, not a list.
 */
function GuestBoard({ t }) {
  const stage = useRef(null);
  const caps = useRef({});
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let board = null;
    let stopped = false;
    import('../../lib/workshop3d')
      .then(({ initBoard }) => {
        const host = document.querySelector('.cp--guest .cp-scene');
        if (stopped || !host || !stage.current) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'cp-board__canvas';
        canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(canvas);
        board = initBoard(canvas, {
          input: stage.current,
          frame: stage.current,
          fitBase: 2.8,
          items: () => [],
          lanes: () => [],
          onFrame: (stations) => {
            if (!drawn) setDrawn(true);
            for (const [key, p] of Object.entries(stations)) {
              const el = caps.current[key];
              if (el) el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
            }
          },
          onPickEmpty: () => {},
        });
      })
      .catch(() => {}); // no WebGL: the sign-in card and the steps carry it
    return () => {
      stopped = true;
      board?.stop();
      document.querySelector('.cp--guest .cp-scene canvas')?.remove();
    };
    // The scene is started once for the life of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cx('cp-board', 'cp-board--guest', !drawn && 'is-loading')}>
      <div ref={stage} className="cp-board__stage">
        {drawn
          ? STAGES.map((s) => (
              <button
                key={s.key}
                type="button"
                ref={(el) => (caps.current[s.key] = el)}
                className="cp-board__cap is-empty"
                tabIndex={-1}
                aria-hidden="true"
              >
                <b>0</b> {stageText(t, s)}
              </button>
            ))
          : null}
      </div>
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
