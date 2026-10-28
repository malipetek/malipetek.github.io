/* Small building blocks for the client portal. Every class is prefixed `cp-`. */
import { useEffect, useRef } from 'react';
import { STATUS_LABEL } from '../../lib/portal';
import { STEPS } from '../../lib/offer.js';
import { money, priceOf } from '../../lib/pricing.js';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export function Button({ kind = 'default', size, className, href, ...props }) {
  const cls = cx('cp-btn', `cp-btn--${kind}`, size && `cp-btn--${size}`, className);
  if (href) return <a className={cls} href={href} {...props} />;
  return <button type="button" className={cls} {...props} />;
}

/** The client's words for a status; "new" means it waits for Ali. */
export const StatusPill = ({ status }) => <span className={`cp-pill cp-pill--${status}`}>{STATUS_LABEL[status] ?? status}</span>;

export const Tag = ({ children, title }) => (
  <span className="cp-tag" title={title}>
    {children}
  </span>
);

/** Which of the four steps a status is at: 0 request … 3 check, 4 shipped. */
export const stepOf = (status) => ({ new: 0, approved: 1, in_progress: 2, review: 3, done: 4, declined: 0 })[status];

/** Four dots for a row: done, current, ahead. */
export function MiniTrack({ status }) {
  const at = stepOf(status);
  const label = status === 'declined' ? 'Declined' : at >= 4 ? 'Done: all four steps' : `Step ${at + 1} of 4: ${STEPS[at].title}`;
  return (
    <span className={cx('cp-mini', status === 'declined' && 'cp-mini--declined')} role="img" aria-label={label} title={label}>
      {STEPS.map((s, i) => (
        <span key={s.key} className={`cp-mini__dot is-${status === 'declined' ? (i === 0 ? 'done' : 'ahead') : i < at ? 'done' : i === at ? 'now' : 'ahead'}`} />
      ))}
    </span>
  );
}

/** What a ticket costs as it stands: the frozen price once done, the meter before. */
export function totalOf(ticket) {
  return ticket.price_cents ?? priceOf({ humanSeconds: ticket.human_seconds, aiMicroUsd: ticket.ai_micro_usd }).totalCents;
}

/** Cost so far against the budget, as a bar. No budget reads as an open bar. */
export function Gauge({ ticket }) {
  const total = totalOf(ticket);
  const budget = ticket.budget_cents;
  const share = budget ? Math.min(1, total / budget) : 0;
  const over = budget !== null && total > budget;
  return (
    <div className={cx('cp-gauge', over && 'is-over')}>
      <div className="cp-gauge__bar">
        <span style={{ width: `${budget === null ? 0 : Math.max(2, share * 100)}%` }} />
      </div>
      <p className="cp-gauge__note">
        {budget === null
          ? 'No budget set. Set one and work pauses before it passes.'
          : over
            ? `Over the ${money(budget)} budget: work is paused until it is raised.`
            : `${money(total)} of ${money(budget)} · ${Math.round(share * 100)}% used`}
      </p>
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, actions, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector('[data-autofocus], input, textarea, select')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="cp-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('cp-modal', wide && 'cp-modal--wide')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="cp-modal__head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="cp-modal__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="cp-modal__body">{children}</div>
        {actions ? <footer className="cp-modal__foot">{actions}</footer> : null}
      </div>
    </div>
  );
}

/** `ask`: { title, text, confirm, danger, run } — run may throw; its error shows in the dialog. */
export function Confirm({ ask, onClose, errorText }) {
  const errRef = useRef(null);
  return (
    <Modal
      title={ask.title}
      subtitle={ask.text}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" ref={errRef} role="alert" />
          <Button onClick={onClose}>{ask.cancel ?? 'Cancel'}</Button>
          <Button
            kind={ask.danger ? 'danger' : 'primary'}
            onClick={async (e) => {
              const b = e.currentTarget;
              b.disabled = true;
              try {
                await ask.run();
                onClose();
              } catch (error) {
                if (errRef.current) errRef.current.textContent = errorText(error);
                b.disabled = false;
              }
            }}
          >
            {ask.confirm}
          </Button>
        </>
      }
    />
  );
}

const PATHS = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  plug: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  plus: 'M12 5v14M5 12h14',
  out: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  clip: 'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
  menu: 'M4 6h16M4 12h16M4 18h16',
  back: 'M15 18l-6-6 6-6',
  admin: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
  // The four steps, drawn like the machine's props: a letter, the stamp, the agent, the cloud.
  request: 'M4 6h16v12H4zM4 7l8 6 8-6',
  approve: 'M9 4h6v6H9zM7 10h10v4H7zM5 18h14',
  build: 'M6 8h12v10H6zM9 12h.01M15 12h.01M12 4v4M9 16h6',
  ship: 'M7 18a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 8.5 4.5 4.5 0 0 1 17 18z',
};
export function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const STEP_ICONS = ['request', 'approve', 'build', 'ship'];

export function fmtDate(unix, withTime = true) {
  return new Date(unix * 1000).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** "3 min ago", "yesterday", or the date. */
export function ago(unix) {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  return fmtDate(unix, false);
}
