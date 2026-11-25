/**
 * One action, wherever a surface can hand its own object to the superagent.
 *
 * The ticket, the project and the client all render this: same label, same
 * ghost weight, same brief. It renders nothing on a host that cannot start a
 * conversation (the web admin), so the button never appears dead.
 */
import { useState } from 'react';
import { superagentBrief, superagentTitle } from './superagent-brief.js';
import { useAdmin } from './store.js';
import { Button } from './ui/index.js';

/**
 * @param {object} props
 * @param {string} props.scope - `t:<id>`, `p:<id>` or `c:<id>`.
 * @param {string} props.label - the object as the operator sees it.
 * @param {string} props.ask - what to ask about it.
 * @param {string} props.title - the button's tooltip.
 */
export function AskSuperagentButton({ scope, label, ask, title }) {
  const { host, notify } = useAdmin();
  const superagent = host?.superagent ?? null;
  const [asking, setAsking] = useState(false);
  if (!superagent?.start) return null;
  const run = async () => {
    setAsking(true);
    try {
      await superagent.start({
        brief: superagentBrief({ scope, label, text: ask }),
        title: superagentTitle({ scope, label, ask }),
      });
    } catch (error) {
      notify?.(error?.message ?? 'The superagent could not start.', 'error');
    } finally {
      setAsking(false);
    }
  };
  return (
    <Button size="sm" kind="ghost" busy={asking} title={title} onClick={() => void run()}>
      Ask the superagent
    </Button>
  );
}
