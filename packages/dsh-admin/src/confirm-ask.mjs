/**
 * The panel's one confirm: the in-app `ConfirmHost` dialog, and a closed door
 * when that host is not mounted.
 *
 * Electron can answer `window.confirm` with true without ever showing a
 * dialog, which once queued a ticket nobody had confirmed, so the no-host case
 * must fail closed: the ask resolves false and a warning is logged. Never fall
 * back to a browser dialog (docs/product/RULES.md rule 6).
 */

/**
 * Build the confirm function the panel shares. The host's `open` is set while
 * `ConfirmHost` is mounted and cleared when it unmounts, so the check happens
 * at ask time, not build time.
 *
 * @param {object} [options]
 * @param {{open?: Function}} [options.host] - the ConfirmHost slot ref.
 * @param {(message: string) => void} [options.warn] - called once when no host can show the ask.
 * @returns {(ask: {title?: string, text?: string, confirm?: string, danger?: boolean}) => Promise<boolean>}
 */
export function createConfirmAsk({ host = null, warn = () => {} } = {}) {
  return function confirmAsk(ask) {
    return new Promise((resolve) => {
      if (typeof host?.open !== 'function') {
        warn(`Admin confirm unanswered: no ConfirmHost is mounted, so “${ask?.title ?? 'Confirm'}” was answered no.`);
        resolve(false);
        return;
      }
      host.open({ ...ask, resolve });
    });
  };
}
