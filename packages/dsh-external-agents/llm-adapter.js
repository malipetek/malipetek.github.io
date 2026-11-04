/**
 * LLM-side half of @malipetek/dsh-external-agents.
 *
 * DeepSeek Harness's model picker is provider-grouped and, per
 * `@deepseek-ai/dsh-client-ui-model-selection`, each session's directory is
 * built from the host's live LLM catalog — and `listProviders()` is nothing but
 * the registered adapter routes. So registering one adapter per external agent
 * is enough to make that agent appear in the composer's picker, with the agent's
 * own models nested beneath it. No client plugin, no sidebar, no new surface.
 *
 * The chain is:
 *
 *   composer picker → session model selection → agent loop request
 *     → this adapter's `prepareCall()`/`stream()` → ACP `session/prompt`
 *       → the external agent's own process, context, tools and login
 *
 * `resolveSessionKey` is supplied by the host half: the agent loop drives each
 * turn inside `ctx.agents.withInitiator(agent, …)`, an `AsyncLocalStorage`
 * chain, so a listener in that chain can name the exact session the request
 * belongs to. That is what gives one DSH session one ACP session.
 *
 * The adapter is deliberately duck-typed and imports nothing: no `@deepseek-ai/*`
 * package, so it cannot fail on module resolution inside a composed profile.
 *
 * @module @malipetek/dsh-external-agents/llm-adapter
 */

/**
 * A pull-based queue that adapts ACP's push notifications into the async
 * iteration an LLM chunk stream must be.
 */
export class AsyncQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
    this.failure = undefined;
  }

  /** @param value - the next item to hand to the consumer. */
  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter({ value, done: false });
    else this.items.push(value);
  }

  /** End the stream normally. */
  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  /**
   * End the stream by throwing at the consumer.
   * @param error - the failure to raise.
   */
  fail(error) {
    this.closed = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  /** @returns an async iterator over the queued items. */
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) {
          if (this.failure !== undefined) return Promise.reject(this.failure);
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * Concatenate the text of one message's content blocks.
 * @param message - a harness message.
 * @returns its text, or an empty string.
 */
function messageText(message) {
  if (message === null || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    }
  }
  return text;
}

/**
 * Phrases that mark harness-injected runtime context rather than a human turn.
 *
 * The harness appends a runtime snapshot — a time sample, the workspace, the
 * approval policy — to the request. It arrives as a `user` message, *after* the
 * human's, so "the last user message" is context and not an instruction. Reading
 * it as one is why an external agent answered "no new instruction came through"
 * to a perfectly ordinary question: it had been handed a timestamp.
 */
const RUNTIME_CONTEXT_MARKERS = [
  /current runtime context/i,
  /this snapshot supersedes/i,
  /time sampled while preparing turn/i,
  /elapsed since the preceding/i,
  /^approval policy:/im,
  /^approval prompts are disabled/im,
];

/**
 * Remove harness-injected runtime context from a message's text.
 *
 * Handles both shapes: context appended to the human's text (the human part is
 * kept) and a message that is nothing but context (the result is empty, so the
 * caller skips it).
 *
 * @param text - the message text.
 * @returns the text without its runtime-context portion.
 */
export function stripRuntimeContext(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  let end = text.length;
  for (const pattern of RUNTIME_CONTEXT_MARKERS) {
    const match = pattern.exec(text);
    if (match === null) continue;
    if (match.index === 0) return '';
    if (match.index < end) end = match.index;
  }
  return text.slice(0, end).trim();
}

/**
 * The newest human turn in a request.
 *
 * The external agent keeps its own conversation, so each turn forwards only the
 * new user message rather than replaying the whole transcript into it — and
 * "the new user message" has to mean the newest one a *human* wrote. A
 * context-only message is skipped rather than sent, so an ordinary question is
 * never replaced by a timestamp.
 *
 * @param messages - the request's message list.
 * @returns the newest human text, or null when the request carries none.
 */
/**
 * Remove harness-injected reminder blocks that arrive inside a user message.
 *
 * The skill catalogue and other reminders ride along as `<system-reminder>`
 * blocks on a message with `role: user`. Forwarding one as the turn made the
 * agent answer the catalogue instead of the question, and made a turn that was
 * only a reminder look like a request at all.
 *
 * @param text - message text.
 * @returns the text without reminder blocks.
 */
export function stripSystemReminder(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/**
 * Whether a message is a turn a human took.
 *
 * A turn can be **image-only** — a screenshot with no caption — and treating
 * "no text" as "no turn" dropped exactly that case: the harness asked nothing,
 * and the session sat empty. An image is a request.
 *
 * @param message - one harness message.
 * @returns whether it is a human turn.
 */
function isHumanTurn(message) {
  if (message?.role !== 'user') return false;
  const spoken = stripSystemReminder(stripRuntimeContext(messageText(message)));
  if (spoken.trim().length > 0) return true;
  const content = message?.content;
  if (!Array.isArray(content)) return false;
  // An image-only turn is still a request.
  return content.some((block) => block?.type === 'image');
}

export function newestUserText(messages) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isHumanTurn(message)) continue;
    // An image-only turn has text '' — a real turn with nothing to say in words.
    return stripSystemReminder(stripRuntimeContext(messageText(message))).trim();
  }
  return null;
}

/**
 * Estimate a turn's usage from character counts.
 *
 * ACP's semantic updates carry no token accounting, so the real numbers are
 * unknowable from this side of the wire. Four characters per token is the usual
 * rough rule and is wrong in both directions — but it is far better than
 * reporting zero, which told the harness that nothing had accumulated and left
 * compaction with nothing to act on.
 *
 * `inputTokens` describes the request the *harness* assembled, not the subset
 * forwarded to the agent, because it is the harness's own transcript that its
 * context accounting is trying to bound.
 *
 * @param messages - the harness request's messages.
 * @param outputChars - how many characters of assistant text were streamed back.
 * @returns a `TokenUsage` estimate.
 */
/**
 * Real token usage from an ACP `session/prompt` response, when the agent sends it.
 *
 * ACP marks that field **unstable**, so not every agent fills it in — but the ones
 * that do report the provider's own accounting, including `cachedReadTokens`. It
 * is the only way the harness can show a truthful cache-hit rate: a character
 * estimate cannot know what the provider cached or charged.
 *
 * `totalTokens` is taken as reported rather than recomputed — opencode includes
 * cached reads in it, so `input + output` would not match.
 *
 * @param result - the connection's prompt result.
 * @returns a `TokenUsage`, or null when the agent reported nothing usable.
 */
export function usageFromResult(result) {
  const raw = result?.usage;
  if (raw === null || typeof raw !== 'object') return null;
  const inputTokens = Number(raw.inputTokens);
  const outputTokens = Number(raw.outputTokens);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const cachedRead = Number(raw.cachedReadTokens);
  const cachedWrite = Number(raw.cachedWriteTokens);
  const totalTokens = Number.isFinite(raw.totalTokens)
    ? Number(raw.totalTokens)
    : inputTokens + outputTokens + (Number.isFinite(cachedRead) ? cachedRead : 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(Number.isFinite(cachedRead) ? { cacheReadTokens: cachedRead } : {}),
    ...(Number.isFinite(cachedWrite) ? { cacheWriteTokens: cachedWrite } : {}),
  };
}

export function estimateUsage(messages, outputChars = 0) {
  let inputChars = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    inputChars += messageText(message).length;
  }
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(Number(outputChars) / 4);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

/**
 * Introduces the harness's transcript when an agent session starts without one.
 *
 * Phrased so the agent reads it as established context rather than as the
 * request, because it is prepended to the real turn.
 */
export const PRIME_PREAMBLE = '[Context from the DeepSeek Harness: this conversation was started elsewhere — '
  + 'for example forked from an earlier session, or continued by a different agent — so the transcript so far is below, '
  + 'oldest first. Treat it as your own conversation history. The new request follows the separator.]';

/**
 * Preamble for turns another agent answered after this one had already spoken.
 *
 * Distinct from {@link PRIME_PREAMBLE}: this agent is not new, it simply missed
 * some turns while a different provider held the conversation.
 */
export const PRIME_DELEGATED = '[Context from the DeepSeek Harness: another agent handled the turns below '
  + 'since your last reply. Treat them as part of the same conversation. The new request follows the separator.]';

/** Default history budget, in characters. ~12k tokens of handoff. */
export const DEFAULT_PRIME_MAX_CHARS = 48_000;

/**
 * Index of the newest message a human wrote, or -1.
 *
 * Runtime snapshots arrive as `user` messages, so "the newest user message" is
 * not the same as "the newest thing the person said".
 *
 * @param messages - the request's message list.
 * @returns the index, or -1.
 */
function newestHumanIndex(messages) {
  if (!Array.isArray(messages)) return -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isHumanTurn(messages[index])) return index;
  }
  return -1;
}

/**
 * Render a range of the conversation as plain `User:` / `Assistant:` lines.
 *
 * Over budget, the **head and the tail** are kept: the beginning of a long
 * conversation holds the requirements and the decisions taken, and the end holds
 * the current state. Keeping only the tail — as this did first — handed a
 * successor the last two turns of a 342-turn conversation and lost everything
 * that made them make sense.
 *
 * @param messages - the request's message list.
 * @param from - first index to include.
 * @param to - index to stop before.
 * @param maxChars - character budget.
 * @returns the rendered history, or an empty string.
 */
function renderRange(messages, from, to, maxChars) {
  const lines = [];
  for (let index = from; index < to; index += 1) {
    const role = messages[index]?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = stripRuntimeContext(messageText(messages[index])).replace(/\s+/g, ' ').trim();
    if (text.length === 0) continue;
    lines.push(`${role === 'user' ? 'User' : 'Assistant'}: ${text}`);
  }
  if (lines.length === 0) return '';

  const joined = lines.join('\n');
  const budget = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_PRIME_MAX_CHARS;
  if (joined.length <= budget) return joined;

  // Cut on a line boundary where possible so a sentence is not split in half.
  const cutEnd = (text) => {
    const at = text.lastIndexOf('\n');
    return at > 0 ? text.slice(0, at) : text;
  };
  const cutStart = (text) => {
    const at = text.indexOf('\n');
    return at > 0 ? text.slice(at + 1) : text;
  };

  const marker = '\n[…earlier history omitted…]\n';
  const headBudget = Math.floor((budget - marker.length) * 0.4);
  const tailBudget = budget - marker.length - headBudget;
  const head = cutEnd(joined.slice(0, headBudget));
  const tail = cutStart(joined.slice(-tailBudget));
  return `${head}${marker}${tail}`;
}

/**
 * Render the harness's conversation up to, but not including, its newest human
 * turn — the history a fresh agent session is missing.
 *
 * System and developer messages are skipped: the agent has its own system prompt,
 * and the harness's would conflict with it. Runtime context is stripped for the
 * same reason it is never forwarded.
 *
 * @param messages - the request's message list.
 * @param maxChars - how much history to carry, in characters.
 * @returns the history, or an empty string when there is none worth sending.
 */
export function priorConversation(messages, maxChars = DEFAULT_PRIME_MAX_CHARS) {
  const newest = newestHumanIndex(messages);
  if (newest <= 0) return '';
  return renderRange(messages, 0, newest, maxChars);
}

/**
 * Render the turns another agent handled since this one last replied.
 *
 * When providers alternate, each agent's ACP session only knows the turns it
 * answered itself. Returning to an agent therefore leaves a hole exactly where
 * the other one worked — the same class of bug as starting cold, just smaller.
 *
 * @param messages - the request's message list.
 * @param lastReply - the normalized text this agent returned last time.
 * @param maxChars - character budget.
 * @returns the missed turns; `''` when there are none; `undefined` when this
 *   agent's last reply cannot be found, so the caller should send the full history.
 */
export function conversationSinceReply(messages, lastReply, maxChars = DEFAULT_PRIME_MAX_CHARS) {
  const newest = newestHumanIndex(messages);
  if (newest <= 0) return '';
  if (typeof lastReply !== 'string' || lastReply.length === 0) return undefined;

  for (let index = newest - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'assistant') continue;
    const text = stripRuntimeContext(messageText(messages[index])).replace(/\s+/g, ' ').trim();
    if (text !== lastReply) continue;
    // Our own reply is the message immediately before this turn: nothing missed.
    if (index === newest - 1) return '';
    return renderRange(messages, index + 1, newest, maxChars);
  }
  // A compaction, a trim, or a restart can erase the anchor. Say so rather than
  // guessing, so the caller can fall back to the full history.
  return undefined;
}

/** How many images one turn may carry, so a pasted folder cannot flood the agent. */
export const MAX_PROMPT_IMAGES = 8;

/**
 * The images attached to the newest human turn, as ACP image content.
 *
 * The harness does not hand an adapter image bytes: a block is
 * `{ type: 'image', attachment: { attachmentId, mediaType, … } }`, a durable
 * reference into its attachment store. `resolveImage` turns one into
 * `{ data, mimeType }`, which is what ACP wants.
 *
 * Note the coupling: an adapter that cannot resolve attachments must not claim
 * image support, or the harness routes images to it and they arrive unusable.
 *
 * @param messages - the request's message list.
 * @param resolveImage - turns an attachment reference into base64 data.
 * @param limit - maximum images to include.
 * @returns ACP image blocks, in the order they were attached.
 */
export function promptImages(messages, resolveImage, limit = MAX_PROMPT_IMAGES) {
  if (typeof resolveImage !== 'function') return [];
  const index = newestHumanIndex(messages);
  if (index === -1) return [];
  const content = messages[index]?.content;
  if (!Array.isArray(content)) return [];

  const images = [];
  for (const block of content) {
    if (block?.type !== 'image') continue;
    if (images.length >= limit) break;
    let resolved;
    try {
      resolved = resolveImage(block.attachment ?? block);
    } catch {
      resolved = undefined;
    }
    if (typeof resolved?.data !== 'string' || resolved.data.length === 0) continue;
    if (typeof resolved?.mimeType !== 'string' || resolved.mimeType.length === 0) continue;
    images.push({ type: 'image', data: resolved.data, mimeType: resolved.mimeType });
  }
  return images;
}

/**
 * Describe a request's messages compactly, for the diagnostics log.
 *
 * Bounded on purpose: enough to see which message a turn was read from, without
 * turning the log into a transcript.
 *
 * @param messages - the request's message list.
 * @returns one line naming each role with a short excerpt.
 */
export function describeMessages(messages) {
  if (!Array.isArray(messages)) return '(no messages)';
  return messages.map((message, index) => {
    const raw = messageText(message).replace(/\s+/g, ' ').trim();
    const stripped = stripRuntimeContext(raw);
    const kind = stripped.length === 0 && raw.length > 0 ? 'context' : message?.role ?? '?';
    const shown = (stripped.length > 0 ? stripped : raw).slice(0, 48);
    return `${index}:${kind}="${shown}"`;
  }).join(' | ');
}

/**
 * Map one ACP session update to a harness stream chunk.
 *
 * Only text and reasoning are projected. The external agent's tool calls are
 * deliberately NOT projected as `tool-call-delta`: a tool-call chunk would make
 * this harness try to execute a tool the other agent already ran itself.
 *
 * @param update - the ACP `session/update` payload.
 * @param index - the block index to attribute text to.
 * @returns a chunk, or null when the update carries nothing to show.
 */
export function chunkForUpdate(update, index = 0) {
  if (update === null || typeof update !== 'object') return null;
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content?.type === 'text' && update.content.text.length > 0
        ? { type: 'text-delta', index, text: update.content.text }
        : null;
    case 'agent_thought_chunk':
      return update.content?.type === 'text' && update.content.text.length > 0
        ? { type: 'reasoning-delta', index, text: update.content.text }
        : null;
    case 'tool_call':
      // Tool activity is projected as **reasoning**, never as a `tool-call`
      // chunk. A `tool-call` chunk would tell this harness to run the tool
      // itself — a second execution of something the other agent already did —
      // but saying nothing is what made a long run look stalled: the UI showed
      // "working" with no evidence of it. A line in the reasoning channel is
      // visible, collapses with the agent's thinking, and is inert.
      return typeof update.title === 'string' && update.title.trim().length > 0
        ? { type: 'reasoning-delta', index: index + 2, text: `\n→ ${update.title.trim()}\n` }
        : null;
    case 'tool_call_update':
      // Success is silent — a run of nine `shell → completed` lines says nothing
      // a reader wants. A failure is the one outcome worth surfacing.
      return update.status === 'failed'
        ? { type: 'reasoning-delta', index: index + 2, text: '→ failed\n' }
        : null;
    default:
      return null;
  }
}

/**
 * Translate an ACP stop reason into a harness finish reason.
 * @param stopReason - the ACP `stopReason`.
 * @param aborted - whether the caller's signal fired.
 * @returns a FinishReason.
 */
export function finishReasonFor(stopReason, aborted = false) {
  if (aborted) return { kind: 'aborted', failure: { code: 'ABORTED', message: 'the external agent turn was cancelled' } };
  switch (stopReason) {
    case 'end_turn':
      return { kind: 'stop' };
    case 'max_tokens':
      return { kind: 'max-tokens' };
    case 'cancelled':
      return { kind: 'aborted', failure: { code: 'ABORTED', message: 'the external agent cancelled the turn' } };
    case 'refusal':
      return { kind: 'error', failure: { code: 'REFUSAL', message: 'the external agent refused the task' } };
    default:
      return { kind: 'stop' };
  }
}

/**
 * Match one model id against a glob pattern.
 *
 * `*` matches any run of characters and `?` a single one; everything else is
 * literal. Matching is case-insensitive and anchored, so `swe-*` matches
 * `swe-2-high` but `adaptive` does not match `*aptive`.
 *
 * @param pattern - the glob.
 * @param value - the model id to test.
 * @returns whether the pattern matches.
 */
export function matchesGlob(pattern, value) {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${source}$`, 'i').test(String(value));
  } catch {
    return false;
  }
}

/**
 * Match a model id against a list of glob patterns.
 * @param patterns - the globs.
 * @param value - the model id to test.
 * @returns whether any pattern matches.
 */
export function matchesAny(patterns, value) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  return patterns.some((pattern) => matchesGlob(pattern, value));
}

/**
 * Choose the option that satisfies an intent, or undefined when none does.
 *
 * ACP names the meaningful choices through `kind` — `allow_once`,
 * `allow_always`, `reject_once`, `reject_always` — so `kind` is trusted first
 * and the option's name and id are only a fallback.
 *
 * Returning `undefined` rather than a default is the whole point. Answering a
 * `deny` with "the first option offered" is how this client once selected
 * `allow-with-updates` while recording the decision as `denied`, and let an
 * agent write the file it was told not to write. A policy that cannot find its
 * option must fail closed, never answer with its opposite.
 *
 * @param options - the options the agent offered.
 * @param want - `'allow'` or `'reject'`.
 * @returns the matching option, or undefined.
 */
export function pickOption(options, want) {
  if (!Array.isArray(options)) return undefined;
  const kindOf = (option) => String(option?.kind ?? '').toLowerCase();
  const label = (option) => `${option?.optionId ?? ''} ${option?.name ?? ''} ${option?.kind ?? ''}`;
  if (want === 'allow') {
    return options.find((option) => kindOf(option) === 'allow_once')
      ?? options.find((option) => kindOf(option).startsWith('allow'))
      ?? options.find((option) => /allow|approve|accept|permit|^yes\b/i.test(label(option)));
  }
  if (want === 'reject') {
    return options.find((option) => kindOf(option) === 'reject_once')
      ?? options.find((option) => kindOf(option).startsWith('reject'))
      ?? options.find((option) => /reject|deny|refuse|decline|^no\b/i.test(label(option)));
  }
  return undefined;
}

/** Map a harness approval outcome onto the option intent it authorises. */
export const APPROVAL_INTENT = {
  'allowed-once': 'allow',
  rejected: 'reject',
  cancelled: 'cancel',
  unavailable: 'cancel',
};

/**
 * One external agent presented to the harness as a model provider.
 *
 * The provider route is what the picker groups under, so `providerInfo().name`
 * is the agent's display name and the models are the agent's own ACP
 * `model`-category configuration options.
 */
export class AcpModelAdapter {
  /**
   * @param options - the connection to drive and how to name the provider.
   */
  constructor(options) {
    this.connection = options.connection;
    this.provider = options.provider;
    this.label = options.label;
    /** Resolve the DSH session this request belongs to, or null. */
    this.resolveSessionKey = options.resolveSessionKey;
    /** Resolve the working directory for a freshly bound session. */
    this.resolveCwd = options.resolveCwd;
    this.logger = options.logger;
    /** An explicit curated list; when set, the agent is not consulted at all. */
    this.models = Array.isArray(options.models) ? options.models : [];
    /** Globs an advertised model must match to be shown. */
    this.modelInclude = Array.isArray(options.modelInclude) ? options.modelInclude : [];
    /** Globs an advertised model must not match to be shown. */
    this.modelExclude = Array.isArray(options.modelExclude) ? options.modelExclude : [];
    /**
     * How a `session/request_permission` is answered.
     *
     * `allow` is the default: an external agent is treated as a full-access
     * collaborator, so nothing it wants to do is gated on a prompt the user did
     * not ask for. That is a deliberate posture, not an oversight — these agents
     * run unattended, and Devin never asks at all, so a stricter client-side
     * policy creates inconsistency rather than safety.
     *
     * `ask` is the opt-in for the opposite posture: the decision goes to the
     * harness's own approval seam (`ctx.approval`) so a human, or whatever
     * answerers the deployment composed, decides. `deny` and `cancel` refuse.
     * Whichever policy is chosen, an answer is never fabricated: a policy that
     * cannot find a matching option refuses rather than guessing.
     */
    this.approvalPolicy = options.approvalPolicy ?? 'allow';
    /** The harness's `ctx.approval` service, when the profile composes one. */
    this.approvalService = options.approvalService;
    /** Resolve the live agent that initiated this turn, for the approval seam. */
    this.resolveInitiatingAgent = options.resolveInitiatingAgent;
    /** Records a diagnostics line; injected to avoid importing the host half. */
    this.note = typeof options.note === 'function' ? options.note : () => {};
    /** How much transcript to carry when catching up a fresh agent session. */
    this.primeMaxChars = Number.isFinite(options.primeMaxChars) ? options.primeMaxChars : DEFAULT_PRIME_MAX_CHARS;
    /** Standing instructions sent once, at the start of a session. */
    this.instructions = typeof options.instructions === 'string' ? options.instructions.trim() : '';
    /**
     * The last reply this agent produced, per harness session.
     *
     * It is the anchor for "what happened while another provider held the
     * conversation": if the newest assistant turn is not this text, someone else
     * answered, and this agent is missing those turns.
     */
    this.lastReplies = new Map();
    /**
     * The harness request id last primed, per session.
     *
     * A retried request re-enters `stream` with the same id and the same
     * messages. Priming twice hands the agent its own history again, which it
     * reads as a repeated request.
     */
    this.primedRequest = new Map();
    /**
     * Turns one durable attachment reference into `{ data, mimeType }`.
     *
     * When absent, the adapter does not advertise image input — claiming it
     * without a resolver would make the harness route images here and drop them.
     */
    this.resolveImage = typeof options.resolveImage === 'function' ? options.resolveImage : undefined;
    /** Called at the start of each turn with the live initiating agent. */
    this.onTurnStart = typeof options.onTurnStart === 'function' ? options.onTurnStart : undefined;
  }

  /**
   * Describe the provider route this adapter owns.
   * @param provider - the registered route.
   * @returns display metadata whose id must equal the route.
   */
  providerInfo(provider) {
    return { id: provider, name: this.label };
  }

  /** @returns undefined, using the harness's default retry policy. */
  providerRetryPolicy() {
    return undefined;
  }

  /** @returns undefined; external agents declare no per-image pricing. */
  imageRequestPricing() {
    return undefined;
  }

  /**
   * Advertise the agent's own models.
   *
   * Read from the agent's ACP `session/new` configuration options, so the
   * picker shows what the agent actually offers — for Devin that is its live
   * model roster, not a list this plugin guessed.
   *
   * @param provider - the registered route.
   * @returns discoverable models in the agent's own order.
   */
  async listModels(provider) {
    try {
      // A curated list wins outright: it is what the user asked to see, and
      // because it needs no ACP session the picker opens without starting the
      // agent at all.
      if (this.models.length > 0) return this.#curated(provider);

      const options = await this.connection.catalogueModels(this.resolveCwd());
      // The harness validates every entry and rejects the WHOLE provider on one
      // bad row with INVALID_CATALOG, so each entry must carry `provider` equal
      // to the route, a non-empty id and name, and a unique id. An agent that
      // repeats a value or offers a nameless one is filtered here rather than
      // allowed to take its group down.
      const seen = new Set();
      const models = [];
      for (const option of options) {
        const id = typeof option?.value === 'string' ? option.value : '';
        const name = typeof option?.name === 'string' ? option.name : '';
        if (id.length === 0 || name.length === 0 || seen.has(id)) continue;
        // An agent's roster is often far longer than it is useful — Devin
        // advertises 122 models, over half of them `fusion-*` pairings of two
        // others — so the configured globs decide what reaches the picker.
        if (this.modelInclude.length > 0 && !matchesAny(this.modelInclude, id)) continue;
        if (matchesAny(this.modelExclude, id)) continue;
        seen.add(id);
        models.push({
          provider,
          id,
          name,
          ...(typeof option.description === 'string' && option.description.length > 0
            ? { description: option.description }
            : {}),
        });
      }
      return models;
    } catch (error) {
      this.logger?.warn?.(`external-agents: ${provider} could not list models: ${String(error?.message ?? error)}`);
      return [];
    }
  }

  /**
   * Build the catalogue from the configured list.
   *
   * Entries may be a bare id or `{ id, name, description }`. The harness's rules
   * still apply, so nameless, empty and repeated entries are dropped rather than
   * allowed to fail the whole group.
   *
   * @param provider - the registered route.
   * @returns the curated catalogue.
   */
  #curated(provider) {
    const seen = new Set();
    const models = [];
    for (const entry of this.models) {
      const id = typeof entry === 'string' ? entry : (typeof entry?.id === 'string' ? entry.id : '');
      const name = typeof entry === 'string'
        ? entry
        : (typeof entry?.name === 'string' && entry.name.length > 0 ? entry.name : id);
      if (id.length === 0 || name.length === 0 || seen.has(id)) continue;
      seen.add(id);
      const description = typeof entry === 'object' && typeof entry?.description === 'string' && entry.description.length > 0
        ? entry.description
        : undefined;
      models.push({ provider, id, name, ...(description === undefined ? {} : { description }) });
    }
    return models;
  }

  /**
   * Resolve one model's metadata.
   *
   * Only identity is declared: adding capabilities this adapter does not honour
   * would make the harness's call validation promise something untrue.
   *
   * @param provider - the registered route.
   * @param model - the exact model id.
   * @returns identity metadata.
   */
  resolveModel(provider, model) {
    return Promise.resolve({
      provider,
      id: model,
      name: this.#displayName(model),
      // Only claimed when attachments can actually be read: the harness uses
      // this to decide whether to send images or a text placeholder, and a
      // false claim silently loses them.
      ...(this.resolveImage === undefined ? {} : { inputModalities: ['image'] }),
    });
  }

  /**
   * Bind the model and hand back the stream entry point.
   * @param provider - the registered route.
   * @param model - the exact model id.
   * @returns model metadata and the one-generation stream function.
   */
  async prepareCall(provider, model) {
    return { model: await this.resolveModel(provider, model), stream: (options) => this.stream(options) };
  }

  /**
   * Stream one turn from the external agent.
   *
   * Deltas are yielded as they arrive; the agent's own tool activity is not
   * projected, because those tools already ran in the agent's process.
   *
   * @param options - the harness request.
   * @returns the chunk stream.
   */
  async *stream(options) {
    const newest = newestUserText(options?.messages);
    if (newest === null) {
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    // An image-only turn carries no words. The images are the request, so give
    // the agent something to read rather than an empty text block.
    const text = newest.length > 0 ? newest : '(see the attached image)';

    let aborted = false;
    const signal = options?.signal;
    const queue = new AsyncQueue();
    const sessionKey = this.resolveSessionKey?.() ?? 'shared';
    // Captured HERE, not when the permission request arrives: that request is
    // handled from the child's stdout event, which is outside the initiator
    // chain the loop established, so by then the live agent is no longer
    // ambient. Inside this generator it still is.
    const initiating = this.resolveInitiatingAgent?.() ?? null;
    // The delegation bridge needs the exact live parent agent for this session;
    // an MCP call arrives later, outside this turn's async context.
    if (initiating !== null) this.onTurnStart?.(sessionKey, initiating);

    // Block indexes must be allocated in the order blocks first appear and reused
    // for every later delta of the same block. A fixed text=0 / reasoning=1 pair
    // violates that as soon as an agent thinks before it answers — the normal
    // case — and a message assembled from out-of-order blocks can render as
    // nothing at all, which reads as "it replied but I never saw it".
    const blocks = new Map();
    const indexFor = (kind) => {
      if (!blocks.has(kind)) blocks.set(kind, blocks.size);
      return blocks.get(kind);
    };
    let updateCount = 0;
    // One line per *distinct* tool, not per invocation: an agent that runs
    // `shell` twenty times reads as one line, because twenty identical lines
    // carry no more information and bury everything else.
    let lastToolTitle = null;
    const onUpdate = (update) => {
      updateCount += 1;
      if (update?.sessionUpdate === 'tool_call') {
        const title = typeof update.title === 'string' ? update.title.trim() : '';
        if (title.length > 0 && title === lastToolTitle) return;
        lastToolTitle = title;
      }
      const reasoning = update?.sessionUpdate === 'agent_thought_chunk';
      const chunk = chunkForUpdate(update, indexFor(reasoning ? 'reasoning' : 'text'));
      if (chunk !== null) queue.push(chunk);
    };

    // Record which message this turn was read from. The harness appends its
    // runtime snapshot as a *user* message after the human's, so an extraction
    // mistake here is invisible from the outside — the agent simply answers a
    // timestamp instead of the question.
    this.note(
      `[${this.provider}] turn key=${sessionKey} forwarded=${JSON.stringify(text.slice(0, 72))} `
      + `from [${describeMessages((options?.messages ?? []).slice(-6))}]`,
    );

    const running = (async () => {
      const session = await this.connection.ensureSession(this.resolveCwd(), sessionKey);
      // The picker's model selection is the agent's own model selection, so the
      // chosen model is written back to the agent over ACP rather than kept here.
      if (typeof options?.model === 'string' && options.model.length > 0) {
        await this.connection.selectOption(sessionKey, 'model', options.model);
      }

      // A brand-new agent session knows nothing, but the harness may already be
      // holding a conversation it does not — most obviously a **fork**, which
      // inherits a prefix of its parent's transcript, so the UI shows history
      // while the agent has never seen any of it. Catch it up once, then carry on
      // incrementally as normal.
      let forwarded = text;
      // A turn can be attempted more than once: the harness retries a failed
      // model request, and each retry calls this stream again with the **same**
      // request id and message list. Priming on a retry re-sends history the
      // attempt already delivered, and the agent reads it as the user repeating
      // themselves — "the context was duplicated" — then spends the turn working
      // out what changed instead of continuing. So catch up once per turn, not
      // once per attempt.
      const requestId = options?.requestId === undefined || options?.requestId === null
        ? ''
        : String(options.requestId);
      const retryOfPrimedTurn = requestId.length > 0 && this.primedRequest.get(sessionKey) === requestId;
      if (retryOfPrimedTurn) {
        this.note(`[${this.provider}] retry of an already-primed turn (${requestId}): not priming again`);
      } else if (session.primed !== true) {
        const history = priorConversation(options?.messages, this.primeMaxChars);
        if (history.length > 0) {
          forwarded = `${PRIME_PREAMBLE}\n\n${history}\n\n---\n\n${text}`;
          this.note(`[${this.provider}] primed a new session with ${history.length} chars of history (fork, switch or lost session)`);
        }
        // Standing instructions go once, at the start of a session, rather than
        // on every turn: a turn is the agent's own history, so repeating them
        // would buy nothing and cost tokens. This is where a workflow rule like
        // "do not end your turn promising to report later" belongs.
        if (this.instructions.length > 0) forwarded = `${this.instructions}\n\n---\n\n${forwarded}`;
      } else {
        // The session is live, so it holds every turn this agent answered — but
        // not a turn another provider answered while it was swapped out. Fill
        // only that hole. `undefined` means the anchor reply is gone (compaction,
        // restart), and then the honest move is the full history again.
        const since = conversationSinceReply(options?.messages, this.lastReplies.get(sessionKey), this.primeMaxChars);
        if (since === undefined) {
          const history = priorConversation(options?.messages, this.primeMaxChars);
          if (history.length > 0) {
            forwarded = `${PRIME_PREAMBLE}\n\n${history}\n\n---\n\n${text}`;
            this.note(`[${this.provider}] re-primed with ${history.length} chars: last reply is no longer in the request`);
          }
        } else if (since.length > 0) {
          forwarded = `${PRIME_DELEGATED}\n\n${since}\n\n---\n\n${text}`;
          this.note(`[${this.provider}] primed ${since.length} chars another agent handled since the last reply`);
        }
      }

      // Images ride with the turn they were attached to. The ACP prompt is a list
      // of content blocks, so text and images travel together in one turn.
      const images = promptImages(options?.messages, this.resolveImage);
      if (images.length > 0) this.note(`[${this.provider}] turn carries ${images.length} image(s)`);

      const result = await this.connection.prompt(forwarded, {
        onUpdate,
        signal,
        key: sessionKey,
        ...(images.length === 0 ? {} : { blocks: [{ type: 'text', text: forwarded }, ...images] }),
        onPermission: (params, context) => this.decidePermission(initiating, params, context),
      });
      // Only now does the agent hold the history; a failed turn must prime again.
      this.connection.markPrimed(sessionKey);
      // Remember which turn this was, so a retry of it is not primed twice.
      if (requestId.length > 0) this.primedRequest.set(sessionKey, requestId);
      // The anchor for the next turn's "what did I miss" check.
      if (typeof result?.text === 'string' && result.text.length > 0) {
        this.lastReplies.set(sessionKey, result.text.replace(/\s+/g, ' ').trim());
      }
      return result;
    })();

    running.then(() => queue.close(), (error) => queue.fail(error));
    if (signal !== undefined) {
      signal.addEventListener('abort', () => {
        aborted = true;
        this.connection.cancel(sessionKey);
      }, { once: true });
    }

    try {
      let outputChars = 0;
      let reasoningChars = 0;
      for await (const chunk of queue) {
        if (chunk.type === 'text-delta') outputChars += chunk.text.length;
        if (chunk.type === 'reasoning-delta') reasoningChars += chunk.text.length;
        yield chunk;
      }
      const result = await running;
      this.note(`[${this.provider}] turn done updates=${updateCount} text=${outputChars}c reasoning=${reasoningChars}c stop=${result?.stopReason ?? '?'}`);
      // ACP reports no token counts, so these are character-based estimates —
      // but an estimate is what keeps the harness's usage display and, more
      // importantly, its compaction honest. Reporting zeros meant the transcript
      // grew without anything noticing, because compaction had nothing to act on.
      // Real accounting when the agent sends it, an estimate when it does not.
      // The estimate is what made every external-agent turn read as "0% cache
      // hit": it has no cache fields at all, so the harness had nothing to show.
      const reported = usageFromResult(result);
      if (reported !== null) {
        this.note(
          `[${this.provider}] usage input=${reported.inputTokens} cached=${reported.cacheReadTokens ?? 0} `
          + `output=${reported.outputTokens} total=${reported.totalTokens}`,
        );
      }
      yield { type: 'usage', usage: reported ?? estimateUsage(options?.messages, outputChars) };
      // An external agent turn that produced no visible text is a failure, not a
      // success: the orchestrating loop has no tools of its own in this route, so
      // there was nothing else for the turn to have done. Reporting it as `stop`
      // renders as a silent "Completed" — the failure mode that keeps costing
      // time here — so it is surfaced as an error instead.
      const nothingVisible = outputChars === 0 && !aborted && (result?.stopReason ?? 'end_turn') === 'end_turn';
      yield {
        type: 'finish',
        reason: nothingVisible
          ? {
            kind: 'error',
            failure: {
              code: 'EMPTY_TURN',
              message: `the agent finished without sending any visible text (${reasoningChars} chars of reasoning only). `
                + 'Check /external-agents pending, and the diagnostics log for this turn.',
            },
          }
          : finishReasonFor(result?.stopReason, aborted),
      };
    } catch (error) {
      const message = String(error?.message ?? error);
      // A cancelled turn is an abort, not an adapter fault. A timeout is its own
      // thing, and worth naming: it does not mean the agent did nothing, only
      // that it went quiet, and the connection has already cancelled it.
      const timedOut = /timed out/.test(message);
      yield {
        type: 'finish',
        reason: aborted
          ? finishReasonFor(undefined, true)
          : {
            kind: 'error',
            failure: timedOut
              ? {
                code: 'TIMEOUT',
                message: `${message}. The agent was cancelled; it may have been mid-task. Raise idleTimeoutMs if its turns are simply long rather than stuck.`,
              }
              : { code: 'ADAPTER', message },
          },
      };
    }
  }

  /**
   * Answer one `session/request_permission`.
   *
   * Under `ask`, the harness's own approval seam decides — the same service the
   * native tools use — so an external agent's edit is gated like a native one,
   * audited in the session log, and refused when no answerer is available.
   * `allow`, `deny` and `cancel` answer directly, for explicitly unattended runs.
   *
   * @param agent - the live agent that initiated the turn, when known.
   * @param params - the ACP request parameters.
   * @param context - `{ title, options }` prepared by the connection.
   * @returns an ACP outcome, or undefined to fall back to the static policy.
   */
  async decidePermission(agent, params, context) {
    if (this.approvalPolicy !== 'ask') return undefined;
    const options = context?.options ?? (Array.isArray(params?.options) ? params.options : []);
    const title = context?.title ?? params?.toolCall?.title ?? 'a tool call';

    if (this.approvalService === undefined || agent === null || agent === undefined) {
      this.logger?.warn?.(
        `external-agents: no approval channel for "${title}" `
        + `(service ${this.approvalService === undefined ? 'absent' : 'present'}, agent ${agent === null || agent === undefined ? 'unknown' : 'known'}); refusing`,
      );
      return { outcome: 'cancelled' };
    }

    let decision;
    try {
      decision = await this.approvalService.request({
        agent,
        toolName: title,
        reason: `${this.label} wants to ${title}`,
      });
    } catch (error) {
      // An unanswered or unanswerable question must never become a yes.
      this.logger?.warn?.(`external-agents: approval for "${title}" failed, refusing: ${String(error?.message ?? error)}`);
      return { outcome: 'cancelled' };
    }

    const intent = APPROVAL_INTENT[decision] ?? 'cancel';
    if (intent === 'cancel') return { outcome: 'cancelled' };
    const chosen = pickOption(options, intent);
    if (chosen === undefined) {
      this.logger?.warn?.(`external-agents: approval was "${decision}" but the agent offered no ${intent} option for "${title}"; cancelling`);
      return { outcome: 'cancelled' };
    }
    return { outcome: 'selected', optionId: chosen.optionId };
  }

  /**
   * Display name for a model id, preferring the agent's own label.
   * @param model - the exact model id.
   * @returns a human name.
   */
  #displayName(model) {
    return this.connection.modelName(model) ?? model;
  }
}
