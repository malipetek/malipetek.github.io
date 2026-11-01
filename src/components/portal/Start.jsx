/*
 * /portal/start: add a project. A project is the codebase and the work; its
 * sites (addresses that publish its build) are added from the project page,
 * where they are visible as its sub-entity.
 *
 *   1. what it is called, and what it is
 *   2. where the code lives — ours, their GitHub, a repo they name, or a zip
 *   3. the first request, how closely Ali should look, and the budget
 *
 * The form is saved in sessionStorage, so a client who leaves to connect
 * GitHub in another tab comes back to the same step. Text comes from the
 * catalog like the rest of the portal, so a client who picked a language on
 * the sign-in screen sees this page in it too.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, createProject, errorText, session } from '../../lib/portal';
import { ATTENTION, DEFAULT_ATTENTION, clock, money, timeCents } from '../../lib/pricing.js';
import { attentionText } from './copy.js';
import { browserLocale, useTranslator } from './useTranslator.js';

const SAVE_KEY = 'malipetek.portal.start';

function savedState() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.sessionStorage.getItem(SAVE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export default function Start() {
  const saved = savedState();
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [count, setCount] = useState(0);
  const [kind, setKind] = useState(saved?.kind ?? null);
  const [index, setIndex] = useState(Number(saved?.index) || 0);
  const [answers, setAnswers] = useState(saved?.answers ?? {});
  const [attention, setAttention] = useState(saved?.attention ?? DEFAULT_ATTENTION);
  const [budget, setBudget] = useState(saved?.budget ?? '');
  const [status, setStatus] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);
  const [github, setGithub] = useState(null);
  const t = useTranslator(user?.locale ?? browserLocale());

  const set = (key, value) => setAnswers((a) => ({ ...a, [key]: value }));

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

  // The GitHub card. A client can connect in another tab and come back;
  // refreshing on focus is what makes "come back" work.
  const loadConnections = () => {
    if (!session.get()) return;
    api('/portal/github').then(setGithub, () => setGithub({ installations: [], installUrl: null }));
  };
  useEffect(() => {
    loadConnections();
    const onFocus = () => loadConnections();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Persist progress, so a trip to GitHub does not cost the form.
  useEffect(() => {
    if (!kind) return;
    try {
      window.sessionStorage.setItem(SAVE_KEY, JSON.stringify({ kind, index, answers, attention, budget }));
    } catch {
      /* private mode */
    }
  }, [kind, index, answers, attention, budget]);

  const steps = kind ? ['project', 'code', 'first'] : [];
  const step = steps[index];
  const last = index === steps.length - 1;
  const installations = github?.installations ?? [];
  const repoMode = answers.repoMode ?? (kind === 'new' ? 'create' : 'none');
  const repoSource = answers.repoSource ?? (installations.length ? 'github' : 'ours');

  const missing = useMemo(() => {
    const need = [];
    if (!answers.name?.trim()) need.push(t('start.field.name.label'));
    if (step === 'project' && !answers.what?.trim()) {
      need.push(t(kind === 'new' ? 'start.field.new.what.label' : 'start.field.existing.what.label'));
    }
    if (step === 'code') {
      if (repoMode === 'repo' && !answers.repo?.trim()) need.push(t('start.field.repo.label'));
      if (repoMode === 'create' && repoSource === 'github' && !installations.length) need.push(t('start.github.account'));
    }
    if (step === 'first' && !answers.goal?.trim()) {
      need.push(t(kind === 'new' ? 'start.field.new.goal.label' : 'start.field.existing.goal.label'));
    }
    return need;
  }, [answers, kind, step, repoMode, repoSource, installations.length, t]);

  const say = (text, error = false) => setStatus({ text, error });

  const next = async () => {
    if (missing.length) {
      say(t('start.missing', { fields: missing.join(', ') }), true);
      return;
    }
    say('');
    if (!last) {
      setIndex(index + 1);
      return;
    }
    await submit();
  };

  async function submit() {
    setBusy(true);
    say(t('start.creating'));
    try {
      const { project } = await createProject({
        kind,
        name: answers.name ?? '',
        brief: {
          what: answers.what ?? '',
          goal: answers.goal ?? '',
          ...(kind === 'existing' ? { where: answers.where || undefined } : { manual: answers.manual || undefined }),
        },
        repoMode,
        repo: repoMode === 'repo' ? answers.repo : undefined,
        repoSource: repoMode === 'create' ? repoSource : undefined,
        installationId: repoMode === 'create' && repoSource === 'github' ? installations[0]?.id : undefined,
        attention,
        budgetCents: Number(budget) > 0 ? Math.round(Number(budget) * 100) : undefined,
      });
      window.sessionStorage.removeItem(SAVE_KEY);
      window.location.href = `/portal#/project/${project.id}`;
    } catch (error) {
      say(errorText(error, t), true);
      setBusy(false);
    }
  }

  if (!booted) {
    return (
      <div className="portal">
        <p className="portal-note">{t('common.loading')}</p>
      </div>
    );
  }

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
      ) : !kind ? (
        <section className="portal-section">
          <p className="lede">{t('start.fork.lede')}</p>
          {count > 0 ? (
            <p className="portal-note" style={{ margin: '0.6rem 0 0' }}>
              {t('start.already', { n: count })}
            </p>
          ) : null}
          <div className="fork">
            {['existing', 'new'].map((k) => (
              <button
                key={k}
                className="fork-card"
                type="button"
                onClick={() => {
                  setKind(k);
                  setIndex(0);
                  setAnswers((a) => ({ ...a, repoMode: k === 'new' ? 'create' : 'none' }));
                  say('');
                }}
              >
                <span className="fork-card__title">{t(`start.fork.${k}.title`)}</span>
                <span className="fork-card__note">{t(`start.fork.${k}.note`)}</span>
              </button>
            ))}
          </div>
          <p className="portal-note" style={{ maxWidth: '52ch', marginTop: '1.25rem' }}>
            {t('start.fork.footnote')}
          </p>
        </section>
      ) : (
        <div>
          <ol className="steps">
            {steps.map((_, at) => (
              <li key={at} className={`step${at === index ? ' step--current' : ''}${at < index ? ' step--done' : ''}`}>
                {at + 1}
              </li>
            ))}
          </ol>

          {step === 'project' ? (
            <section className="portal-section">
              <h2>{t('start.step.project.title')}</h2>
              <p className="lede">{t(kind === 'new' ? 'start.step.project.new.lede' : 'start.step.project.existing.lede')}</p>

              <div className="portal-field">
                <label className="portal-label" htmlFor="f-name">
                  {t('start.field.name.label')}
                </label>
                <input
                  id="f-name"
                  type="text"
                  maxLength={80}
                  placeholder={t('start.field.existing.name.placeholder')}
                  value={answers.name ?? ''}
                  onChange={(e) => set('name', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void next();
                    }
                  }}
                />
                <p className="portal-field__hint">{t('start.field.name.hint')}</p>
              </div>

              <div className="portal-field">
                <label className="portal-label" htmlFor="f-what">
                  {t(kind === 'new' ? 'start.field.new.what.label' : 'start.field.existing.what.label')}
                </label>
                <textarea id="f-what" rows={5} maxLength={1200} value={answers.what ?? ''} onChange={(e) => set('what', e.target.value)} />
              </div>

              {kind === 'existing' ? (
                <div className="portal-field">
                  <label className="portal-label" htmlFor="f-where">
                    {t('start.field.where.label')}
                  </label>
                  <textarea
                    id="f-where"
                    rows={3}
                    maxLength={1200}
                    placeholder={t('start.field.where.hint')}
                    value={answers.where ?? ''}
                    onChange={(e) => set('where', e.target.value)}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 'code' ? (
            <section className="portal-section">
              <h2>{t('start.step.code.title')}</h2>
              <p className="lede">{t('start.step.code.lede')}</p>

              <ConnectionNote
                t={t}
                label="GitHub"
                connected={installations.length > 0}
                account={installations.map((i) => `@${i.account_login}`).join(', ')}
                href={github?.installUrl}
                connectedText={t('start.github.connected', { account: installations.map((i) => `@${i.account_login}`).join(', ') })}
                missingText={t('start.github.notConnected')}
              />

              <fieldset className="choice">
                <legend className="portal-label">{t('start.field.repoMode.label')}</legend>
                {(kind === 'new' ? ['create', 'repo'] : ['create', 'repo', 'zip', 'none']).map((mode) => (
                  <label className="choice-option" key={mode}>
                    <input
                      type="radio"
                      name="repoMode"
                      value={mode}
                      checked={repoMode === mode}
                      onChange={() => {
                        set('repoMode', mode);
                        if (mode === 'create' && !answers.repoSource) {
                          set('repoSource', installations.length ? 'github' : 'ours');
                        }
                      }}
                    />
                    <span className="choice-option__body">
                      <strong>{t(`start.repoMode.${mode}.label`)}</strong>
                      <em>{t(`start.repoMode.${mode}.note`)}</em>
                    </span>
                  </label>
                ))}
              </fieldset>

              {repoMode === 'create' ? (
                <fieldset className="choice">
                  <legend className="portal-label">{t('start.field.repoSource.label')}</legend>
                  <label className="choice-option">
                    <input
                      type="radio"
                      name="repoSource"
                      value="github"
                      checked={repoSource === 'github'}
                      disabled={!installations.length}
                      onChange={() => set('repoSource', 'github')}
                    />
                    <span className="choice-option__body">
                      <strong>{t('start.repoSource.github.label')}</strong>
                      <em>
                        {installations.length
                          ? t('start.repoSource.github.note', { account: installations[0].account_login })
                          : t('start.repoSource.github.missing')}
                      </em>
                    </span>
                  </label>
                  <label className="choice-option">
                    <input type="radio" name="repoSource" value="ours" checked={repoSource === 'ours'} onChange={() => set('repoSource', 'ours')} />
                    <span className="choice-option__body">
                      <strong>{t('start.repoSource.ours.label')}</strong>
                      <em>{t('start.repoSource.ours.note')}</em>
                    </span>
                  </label>
                </fieldset>
              ) : null}

              {repoMode === 'repo' ? (
                <div className="portal-field">
                  <label className="portal-label" htmlFor="f-repo">
                    {t('start.field.repo.label')}
                  </label>
                  <input
                    id="f-repo"
                    type="text"
                    maxLength={300}
                    placeholder="https://github.com/you/repo"
                    value={answers.repo ?? ''}
                    onChange={(e) => set('repo', e.target.value)}
                  />
                  <p className="portal-field__hint">{t('start.field.repo.hint')}</p>
                </div>
              ) : null}

              {repoMode === 'zip' ? <p className="portal-note">{t('start.repoMode.zip.hint')}</p> : null}
            </section>
          ) : null}

          {step === 'first' ? (
            <section className="portal-section">
              <h2>{t('start.step.first.title')}</h2>
              <p className="lede">{t(kind === 'new' ? 'start.step.first.new.lede' : 'start.step.first.existing.lede')}</p>

              {kind === 'new' ? (
                <div className="portal-field">
                  <label className="portal-label" htmlFor="f-manual">
                    {t('start.field.manual.label')} <span style={{ textTransform: 'none', letterSpacing: 0 }}>{t('start.budget.optional')}</span>
                  </label>
                  <textarea
                    id="f-manual"
                    rows={3}
                    maxLength={1200}
                    placeholder={t('start.field.manual.hint')}
                    value={answers.manual ?? ''}
                    onChange={(e) => set('manual', e.target.value)}
                  />
                </div>
              ) : null}

              <div className="portal-field">
                <label className="portal-label" htmlFor="f-goal">
                  {t(kind === 'new' ? 'start.field.new.goal.label' : 'start.field.existing.goal.label')}
                </label>
                <textarea
                  id="f-goal"
                  rows={4}
                  maxLength={1200}
                  placeholder={t(kind === 'new' ? 'start.field.new.goal.hint' : 'start.field.existing.goal.hint')}
                  value={answers.goal ?? ''}
                  onChange={(e) => set('goal', e.target.value)}
                />
              </div>

              <fieldset className="attention">
                <legend className="portal-label">{t('start.attention.legend')}</legend>
                {ATTENTION.map((a) => (
                  <label className="attention-option" key={a.key}>
                    <input type="radio" name="attention" value={a.key} checked={attention === a.key} onChange={() => setAttention(a.key)} />
                    <span>
                      <strong>{attentionText(t, a, 'name')}</strong>
                      <em>
                        {a.typicalSeconds
                          ? t('start.attention.about', { time: clock(a.typicalSeconds), price: money(timeCents(a.typicalSeconds)) })
                          : t('start.attention.hourly', { price: money(timeCents(3600)) })}
                      </em>
                      <span>{attentionText(t, a, 'what')}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="portal-field" style={{ maxWidth: '16rem' }}>
                <label className="portal-label" htmlFor="st-budget">
                  {t('start.budget.label')} <span style={{ textTransform: 'none', letterSpacing: 0 }}>{t('start.budget.optional')}</span>
                </label>
                <input
                  id="st-budget"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  inputMode="numeric"
                  placeholder={t('start.budget.placeholder')}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </div>
              <p className="portal-note" style={{ maxWidth: '52ch' }}>
                {t('start.meta.note')}
              </p>

              <div className="start-summary" aria-label={t('start.summary.title')}>
                <strong>{t('start.summary.title')}</strong>
                <dl>
                  <div>
                    <dt>{t('start.summary.project')}</dt>
                    <dd>{answers.name || '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('start.summary.code')}</dt>
                    <dd>
                      {repoMode === 'create'
                        ? repoSource === 'github' && installations.length
                          ? t('start.summary.github', { account: installations[0].account_login })
                          : t('start.summary.ours')
                        : repoMode === 'repo'
                          ? answers.repo || '—'
                          : repoMode === 'zip'
                            ? t('start.summary.zip')
                            : t('start.summary.none')}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
          ) : null}

          <div className="portal-actions">
            {index > 0 ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  say('');
                  setIndex(index - 1);
                }}
              >
                {t('start.back')}
              </button>
            ) : null}
            <button className="btn btn--solid" type="button" disabled={busy} onClick={() => void next()}>
              {last ? t('start.create') : t('start.next')}
            </button>
          </div>
          <p className={`portal-note${status.error ? ' is-error' : ''}`} role="status" aria-live="polite">
            {status.text}
          </p>
        </div>
      )}
    </div>
  );
}

/** A connection the choice depends on: said plainly, with the way to make it. */
function ConnectionNote({ t, label, connected, account, href, connectedText, missingText }) {
  return (
    <div className={`start-connection${connected ? ' is-connected' : ''}`}>
      <strong>{label}</strong>
      <span>{connected ? connectedText ?? account : missingText}</span>
      {!connected && href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {t('start.connection.open', { label })}
        </a>
      ) : null}
    </div>
  );
}
