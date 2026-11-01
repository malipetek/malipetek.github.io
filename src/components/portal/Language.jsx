/*
 * The client's language. Saved on the account (PATCH /portal/me), so it follows
 * them to email and to every device.
 *
 * Who does the translating is not their problem: DeepSeek does it, Workers AI
 * takes over when DeepSeek is down, and a client who needs neither is set to
 * `off` by Ali in Admin → Clients. Asking someone to choose between two
 * machine translators they have never heard of was noise.
 */
import { useState } from 'react';
import { api, errorText } from '../../lib/portal';
import { LOCALES, localeInfo } from '../../lib/locales.js';
import { usePortal } from './store.js';
import { Button, Modal } from './ui.jsx';

export function LanguageDialog({ user, onClose, onSaved }) {
  const { t, notify } = usePortal();
  const [locale, setLocale] = useState(localeInfo(user.locale)?.code ?? 'en-US');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const info = localeInfo(locale);

  const save = async () => {
    setBusy(true);
    try {
      await api('/portal/me', { method: 'PATCH', body: { locale } });
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
    </Modal>
  );
}
