// Do not borrow a conversation for automatic desktop requests. Even an
// unsuccessful bridge lookup goes through the transcript command lifecycle.
export function panelTransport(legacy, { desktop = false, fetcher = globalThis.fetch } = {}) {
  async function quiet(line) {
    try {
      const response = await fetcher('/api/admin/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ line }),
        redirect: 'error',
      });
      if (response.status === 200) {
        const { kind, text } = await response.json();
        if (kind === 'success') return { ok: true, text: text || 'Done.' };
        if (kind === 'error') return { ok: false, text: text || 'The command failed.' };
      }
    } catch {
      // A lost reply may follow a successful write. Never replay via a Session.
    }
    return { ok: false, text: 'The Admin Host did not confirm the request. Check the current state before retrying.' };
  }
  return Object.assign(desktop ? quiet : (line) => legacy(line), { quiet });
}
