/*
 * /portal/start: the three-question setup wizard. A fork (an existing site, or
 * something new), then three questions; the last answer becomes the first
 * ticket. Text comes from the catalog like the rest of the portal, so a client
 * who picked a language on the sign-in screen sees this page in it too.
 */
import { useEffect, useState } from 'react';
import { api, createProject, errorText, session } from '../../lib/portal';
import { ATTENTION, DEFAULT_ATTENTION, clock, money, timeCents } from '../../lib/pricing.js';
import { attentionText } from './copy.js';
import { browserLocale, useTranslator } from './useTranslator.js';

/*
 * Two interviews, one shape: three questions each, with the last one becoming
 * the first ticket. An existing project is asked where its code lives; a new
 * one is asked what is done by hand, because that is the brief an agent can
 * actually build from. Keys, not English: t() supplies the words.
 */
const STEPS = {
  existing: [
    {
      title: 'start.step.existing.1.title',
      lede: 'start.step.existing.1.lede',
      fields: [
        { key: 'name', label: 'start.field.name.label', placeholder: 'start.field.existing.name.placeholder', type: 'text', max: 80 },
        { key: 'what', label: 'start.field.existing.what.label', type: 'area', max: 1200 },
      ],
    },
    {
      title: 'start.step.existing.2.title',
      lede: 'start.step.existing.2.lede',
      fields: [
        {
          key: 'repoKind',
          label: 'start.field.repoKind.label',
          type: 'choice',
          options: [
            { value: 'repo', label: 'start.option.repo.label', note: 'start.option.repo.note' },
            { value: 'zip', label: 'start.option.zip.label', note: 'start.option.zip.note' },
            { value: 'none', label: 'start.option.none.label', note: 'start.option.none.note' },
          ],
        },
        {
          key: 'repo',
          label: 'start.field.repo.label',
          placeholder: 'start.field.repo.placeholder',
          type: 'text',
          max: 300,
          showWhen: { key: 'repoKind', value: 'repo' },
        },
        { key: 'where', label: 'start.field.where.label', hint: 'start.field.where.hint', type: 'area', max: 1200, optional: true },
      ],
    },
    {
      title: 'start.step.existing.3.title',
      lede: 'start.step.existing.3.lede',
      fields: [
        {
          key: 'goal',
          label: 'start.field.existing.goal.label',
          hint: 'start.field.existing.goal.hint',
          type: 'area',
          max: 1200,
        },
      ],
    },
  ],
  new: [
    {
      title: 'start.step.new.1.title',
      lede: 'start.step.new.1.lede',
      fields: [
        { key: 'name', label: 'start.field.name.label', type: 'text', max: 80 },
        { key: 'what', label: 'start.field.new.what.label', type: 'area', max: 1200 },
      ],
    },
    {
      title: 'start.step.new.2.title',
      lede: 'start.step.new.2.lede',
      fields: [
        { key: 'manual', label: 'start.field.manual.label', hint: 'start.field.manual.hint', type: 'area', max: 1200, optional: true },
      ],
    },
    {
      title: 'start.step.new.3.title',
      lede: 'start.step.new.3.lede',
      fields: [{ key: 'goal', label: 'start.field.new.goal.label', type: 'area', max: 1200 }],
    },
  ],
};

export default function Start() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState(null);
  const [count, setCount] = useState(0);
  const [kind, setKind] = useState(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);
  const [attention, setAttention] = useState(DEFAULT_ATTENTION);
  const [budget, setBudget] = useState('');
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

  const steps = kind ? STEPS[kind] : [];
  const step = steps[index];
  const fields = step ? step.fields.filter((f) => !f.showWhen || answers[f.showWhen.key] === f.showWhen.value) : [];
  const last = index === steps.length - 1;

  const say = (text, error = false) => setStatus({ text, error });

  const next = async () => {
    const missing = fields.filter((f) => !f.optional && !answers[f.key]?.trim());
    if (missing.length) {
      say(t('start.missing', { fields: missing.map((f) => t(f.label)).join(', ') }), true);
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
      const repoKind = kind === 'existing' && answers.repoKind ? answers.repoKind : 'none';
      const { ticketId } = await createProject({
        kind,
        name: answers.name ?? '',
        brief: {
          what: answers.what ?? '',
          goal: answers.goal ?? '',
          ...(kind === 'existing' ? { where: answers.where || undefined } : { manual: answers.manual || undefined }),
        },
        repoKind,
        repo: repoKind === 'repo' ? answers.repo : undefined,
        attention,
        budgetCents: Number(budget) > 0 ? Math.round(Number(budget) * 100) : undefined,
      });
      window.location.href = `/portal/ticket#id=${ticketId}`;
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

          <section className="portal-section">
            <h2>{t(step.title)}</h2>
            <p className="lede">{t(step.lede)}</p>
            {fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={answers[field.key] ?? ''}
                onChange={(v) => setAnswers((a) => ({ ...a, [field.key]: v }))}
                onEnter={() => void next()}
                t={t}
              />
            ))}
          </section>

          {last ? (
            <div>
              <fieldset className="attention">
                <legend className="portal-label">{t('start.attention.legend')}</legend>
                {ATTENTION.map((a) => (
                  <label className="attention-option" key={a.key}>
                    <input
                      type="radio"
                      name="attention"
                      value={a.key}
                      checked={attention === a.key}
                      onChange={() => setAttention(a.key)}
                    />
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
                  {t('start.budget.label')}{' '}
                  <span style={{ textTransform: 'none', letterSpacing: 0 }}>{t('start.budget.optional')}</span>
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
            </div>
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

function Field({ field, value, onChange, onEnter, t }) {
  const id = `f-${field.key}`;
  const hint = field.hint ? <p className="portal-field__hint">{t(field.hint)}</p> : null;

  if (field.type === 'choice') {
    return (
      <fieldset className="choice">
        <legend className="portal-label">{t(field.label)}</legend>
        {(field.options ?? []).map((option) => (
          <label className="choice-option" key={option.value}>
            <input type="radio" name={id} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span className="choice-option__body">
              <strong>{t(option.label)}</strong>
              {option.note ? <em>{t(option.note)}</em> : null}
            </span>
          </label>
        ))}
        {hint}
      </fieldset>
    );
  }

  if (field.type === 'area') {
    return (
      <div className="portal-field">
        <label className="portal-label" htmlFor={id}>
          {t(field.label)}
        </label>
        <textarea id={id} rows={5} maxLength={field.max ?? 1200} value={value} onChange={(e) => onChange(e.target.value)} />
        {hint}
      </div>
    );
  }

  return (
    <div className="portal-field">
      <label className="portal-label" htmlFor={id}>
        {t(field.label)}
      </label>
      <input
        id={id}
        type="text"
        maxLength={field.max ?? 200}
        placeholder={field.placeholder ? t(field.placeholder) : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter advances; a textarea keeps it as a newline.
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {hint}
    </div>
  );
}
