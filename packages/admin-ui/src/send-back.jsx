/*
 * Sending finished work back to the fleet.
 *
 * A fleet node resumes the ticket's last run, and the agent reads only what
 * was added to the thread since that run started. With nothing new it would
 * get the same instructions again, so this dialog asks for that input: a
 * private note saying what should change. The portal refuses the move with
 * `nothing_new` when nothing was added, so the board (which has no thread
 * loaded) and the superagent follow the same rule.
 */
import { useState } from 'react';
import { useAdmin } from './store.js';
import { RUN_AGAIN } from './format.js';
import { requeueBrief } from './requeue.mjs';
import { Button, ErrorNote, Field, Modal } from './ui.jsx';

export function SendBackDialog({ ticket, messages = null, runs = [], onClose, onDone }) {
  const { api, notify } = useAdmin();
  // Without the thread (a board row) the portal decides; the note stays optional.
  const brief = messages ? requeueBrief({ messages, runs }) : null;
  const needsNote = Boolean(brief && !brief.fresh);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const text = note.trim();
  const submit = async () => {
    if (busy || (needsNote && !text)) return;
    setBusy(true);
    setError(null);
    try {
      if (text) await api('POST', `/admin/tickets/${ticket.id}/messages`, { body: text, internal: true });
      await api('PATCH', `/admin/tickets/${ticket.id}`, { status: 'approved' });
      notify(text ? `#${ticket.id}: note saved and sent back to the fleet.` : `#${ticket.id} sent back to the fleet.`);
      onClose();
      onDone?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal kind="confirm"
      title={`${RUN_AGAIN}: #${ticket.id}`}
      subtitle={
        brief
          ? brief.fresh
            ? brief.text
            : 'Nothing was added since the last run. Say what should change, or the agent repeats the same work.'
          : 'The agent resumes its last run and reads only what was added since. This can change the status and notify the client.'
      }
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            busy={busy}
            disabled={needsNote && !text}
            disabledReason="Write what the agent should change."
            onClick={() => void submit()}
          >
            {text ? 'Save note and send back' : RUN_AGAIN}
          </Button>
        </>
      }
    >
      <Field label="What should change" hint="A private note. The client never sees it; the agent reads it first.">
        <textarea
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder={needsNote ? 'For example: the header still overlaps on mobile; fix that and keep the rest.' : 'Optional: anything the agent should do differently.'}
        />
      </Field>
      {error ? <ErrorNote error={error} /> : null}
    </Modal>
  );
}
