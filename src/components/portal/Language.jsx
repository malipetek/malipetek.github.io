/*
 * The client's language, and who may translate their messages. Saved on the
 * account (PATCH /portal/me), so it follows them to email and to every device.
 */
import { useState } from 'react';
import { api, errorText } from '../../lib/portal';
import { LOCALES, localeInfo } from '../../lib/locales.js';
import { usePortal } from './store.js';
import { Button, Modal } from './ui.jsx';

const ENGINES = ['deepseek', 'cloudflare', 'off'];

export function LanguageDialog({ user, onClose, onSaved }) {
  const { t, notify } = usePortal();
  const [locale, setLocale] = useState(localeInfo(user.locale)?.code ?? 'en-US');
  const [engine, setEngine] = useState(user.translation ?? 'deepseek');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const info = localeInfo(locale);
  const english = locale === 'en-US';

  const save = async () => {
    setBusy(true);
    try {
      await api('/portal/me', { method: 'PATCH', body: { locale, translation: engine } });
      notify(t('lang.saved'));
      await onSaved();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('lang.title')}
      subtitle={t('lang.subtitle')}
      onClose={onClose}
      actions={
        <>
          <p className="cp-modal__err" role="alert">
            {error}
          </p>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button kind="primary" disabled={busy} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <label className="cp-field">
        <span className="cp-label">{t('lang.pick')}</span>
        <select value={locale} onChange={(e) => setLocale(e.target.value)}>
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.native}
              {l.native !== l.english ? ` — ${l.english}` : ''}
              {l.beta ? ` (${t('lang.beta')})` : ''}
            </option>
          ))}
        </select>
        {info?.beta ? <span className="cp-hint">{t('lang.betaNote')}</span> : null}
      </label>
      {english ? null : (
        <fieldset className="cp-field">
          <legend className="cp-label">{t('lang.engine')}</legend>
          {ENGINES.map((key) => (
            <label key={key} className="cp-choice">
              <input type="radio" name="engine" value={key} checked={engine === key} onChange={() => setEngine(key)} />
              <span>
                <strong>{t(`lang.engine.${key}`)}</strong>
                <span className="cp-hint">{t(`lang.engine.${key}Note`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}
