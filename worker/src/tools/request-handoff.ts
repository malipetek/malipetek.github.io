import { defineTool } from '@flue/runtime';
import * as v from 'valibot';

/*
 * The agent's handoff decision. Calling it ends the turn: the bridge reads
 * the summary out of the conversation snapshot and the frontend morphs the
 * reply into the email card. Nothing is sent from inside the tool — the
 * visitor still reviews and submits the card, which lands on POST /handoff.
 */
export const requestHandoff = defineTool({
  name: 'request_handoff',
  description:
    'Ends the conversation and hands the visitor to Ali. Call ONLY when the visitor explicitly asks to contact, hire, or work with Ali. Do NOT call it for questions you can answer from the notes — answer those in plain text instead.',
  input: v.object({
    summary: v.pipe(
      v.string(),
      v.maxLength(4000),
      v.description(
        'One paragraph: what the visitor wants and any useful context, written so Ali can reply.',
      ),
    ),
  }),
  async run({ data }) {
    return { output: { handoff: true, summary: data.summary }, terminate: true };
  },
});
