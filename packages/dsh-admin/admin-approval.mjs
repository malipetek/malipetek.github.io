/**
 * Which admin tool calls need a human yes, and how to say what they do.
 *
 * The agent's tools reach the same endpoints the panel does, so a write the
 * model decides on its own is a change to a client's site, a client's inbox or
 * the work queue. The brief asks the model to wait; this decides it: every
 * operator-facing mutation returns an `ask` decision, which the Harness routes
 * to the approval card and fails closed when nobody answers.
 *
 * `admin_work` claim/report are deliberately absent. They are the work loop's
 * own bookkeeping — an approved ticket being taken and its run recorded — and
 * an unattended run has no one to answer a card.
 */

/** Write actions per tool. Anything not listed is a read and passes through. */
export const WRITE_ACTIONS = {
  admin_tickets: ['reply', 'note', 'set_status'],
  admin_directory: ['create_project', 'set_folder', 'link', 'unlink'],
  admin_project_local: ['configure', 'clone'],
  admin_project_operations: ['project.update', 'mentions.send', 'work.draft', 'work.queue'],
  admin_fleet: ['file_task', 'route', 'cancel', 'drain', 'undrain', 'node_control'],
};

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
const ref = (prefix, value) => (value === undefined || value === null ? prefix : `${prefix}#${value}`);

/** One sentence an operator can decide on, per tool and action. */
function describe(tool, action, args) {
  switch (`${tool} ${action}`) {
    case 'admin_tickets set_status':
      return `Change ticket ${ref('', args.ticketId)} to ${text(args.status) ?? 'another status'}?`;
    case 'admin_tickets reply':
      return `Reply to ticket ${ref('', args.ticketId)}? The client is emailed.`;
    case 'admin_tickets note':
      return `Write a private note on ticket ${ref('', args.ticketId)}?`;
    case 'admin_directory create_project':
      return `Create the project “${text(args.name) ?? text(args.title) ?? 'untitled'}”?`;
    case 'admin_directory set_folder':
      return `Point project ${text(args.projectId) ?? ''} at ${text(args.path) ?? 'a folder'}?`;
    case 'admin_directory link':
      return `Link a folder to project ${text(args.projectId) ?? ''}?`;
    case 'admin_directory unlink':
      return `Unlink the folder from project ${text(args.projectId) ?? ''}?`;
    case 'admin_project_local configure':
      return `Point project ${text(args.projectId) ?? ''} at ${text(args.path) ?? 'a folder'} on this machine?`;
    case 'admin_project_local clone':
      return `Clone project ${text(args.projectId) ?? ''} onto this machine?`;
    case 'admin_project_operations project.update':
      return `Change project ${text(args.projectId) ?? ''}?`;
    case 'admin_project_operations mentions.send':
      return `Notify the saved recipients on project ${text(args.projectId) ?? ''}?`;
    case 'admin_project_operations work.draft':
      return `File a draft task “${text(args.title) ?? 'untitled'}” on ${text(args.projectId) ?? 'a project'}?`;
    case 'admin_project_operations work.queue':
      return `File an approved task “${text(args.title) ?? 'untitled'}” on ${text(args.projectId) ?? 'a project'}? It is queued to run.`;
    case 'admin_fleet file_task':
      return `File task “${text(args.title) ?? 'untitled'}” on ${text(args.slug) ?? 'a project'}? Filing approves it.`;
    case 'admin_fleet route':
      return `Change the routing of ticket ${ref('', args.ticketId)}?`;
    case 'admin_fleet cancel':
      return `Cancel run ${ref('', args.runId)}?`;
    case 'admin_fleet drain':
      return `Stop node ${text(args.nodeId) ?? ''} taking new work?`;
    case 'admin_fleet undrain':
      return `Let node ${text(args.nodeId) ?? ''} take work again?`;
    case 'admin_fleet node_control':
      return `Start, stop or restart this machine's work node?`;
    default:
      return undefined;
  }
}

/**
 * The `ask` decision for one admin tool call, or `null` when it may run.
 * @param {string} name - tool name.
 * @param {unknown} args - the parsed tool arguments.
 * @returns {{kind: 'ask', reason: string, displayReason: {en: string}} | null}
 */
export function writeApproval(name, args) {
  const actions = WRITE_ACTIONS[name];
  if (actions === undefined) return null;
  const call = args !== null && typeof args === 'object' ? args : {};
  const action = text(call.action) ?? text(call.operation);
  // A call this table cannot read is not a read: ask rather than guess.
  if (action === undefined) {
    const reason = `Run ${name}?`;
    return { kind: 'ask', reason, displayReason: { en: reason } };
  }
  // Listed actions are the writes; anything else the tool offers only reads.
  if (!actions.includes(action)) return null;
  const reason = describe(name, action, call) ?? `Run ${name} ${action}?`;
  return { kind: 'ask', reason, displayReason: { en: reason } };
}
