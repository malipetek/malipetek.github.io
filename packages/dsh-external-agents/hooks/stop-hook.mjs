#!/usr/bin/env node
/**
 * Claude Code Stop hook for harness-launched sessions (wired per session through
 * `_meta.claudeCode.options.settings.hooks`, so it never touches the user's own
 * Claude Code runs).
 *
 * It replaces the operator typing "don't stop, continue". A turn may end when
 * the agent reports a status, asks one real question, or simply answered. It is
 * sent back to work, once per stop, when it:
 *   - ends on a menu of next steps it could do itself ("would you like me to…",
 *     "next steps:", "I can also…"), without a STATUS line; or
 *   - asks the user something about the project (deploy target, build, env,
 *     credentials) without having read the shared project context this turn.
 *
 * Input: the hook JSON on stdin. Output: `{"decision":"block","reason":…}` or nothing.
 */

import { existsSync, readFileSync } from 'node:fs';

const STATUS = /^\s*\**`?STATUS:?\s*(done|blocked|failed|ready|question)\b/im;
const MENU = /(would you like me to|do you want me to|shall i\b|should i (?:go ahead|proceed|continue)|let me know if you(?:'d| would) like|next steps?:|remaining (?:work|steps|items)|i can (?:also|next)|if you want,? i can|want me to (?:continue|proceed|go ahead))/i;
const PROJECT_QUESTION = /(where (?:should|do|does) (?:i|we|this|it) (?:deploy|host|publish)|(?:don't|do not|doesn't) know (?:where|how) to (?:deploy|build|publish|run)|which (?:host|hosting|platform|environment|account|project) (?:should|do)|deploy(?:ment)? target|what(?:'s| is) the (?:deploy|build|start) command)/i;

/** Read stdin fully. */
async function stdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/**
 * The last assistant text and the tool names used since the last real user
 * message, from the transcript JSONL.
 */
export function lastTurn(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !existsSync(transcriptPath)) return { text: '', tools: [] };
  const entries = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  let text = '';
  const tools = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const content = entry?.message?.content;
    if (entry.type === 'user') {
      // A tool result is a "user" entry too; only a human message ends the turn.
      const isToolResult = Array.isArray(content) && content.some((block) => block?.type === 'tool_result');
      if (!isToolResult) break;
      continue;
    }
    if (entry.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string') tools.push(block.name);
      if (block?.type === 'text' && text.length === 0 && typeof block.text === 'string' && block.text.trim().length > 0) text = block.text;
    }
  }
  return { text, tools };
}

/** The decision for one Stop event. @returns a reason to continue, or null. */
export function decide(input) {
  if (input?.stop_hook_active === true) return null;
  const turn = lastTurn(input?.transcript_path);
  const text = typeof input?.last_assistant_message === 'string' && input.last_assistant_message.length > 0
    ? input.last_assistant_message
    : turn.text;
  if (text.length === 0) return null;
  const readContext = turn.tools.some((name) => /project_context/.test(name));
  if (PROJECT_QUESTION.test(text) && !readContext) {
    return 'You asked about how this project is deployed/built/configured. Do not ask the user yet: call the '
      + '`project_context` tool (dsh MCP server) and read the repo\'s own config (README, package.json scripts, '
      + 'wrangler/vercel/fly/netlify/.spacefast configs, CI workflows, git remotes). Settle it from there, record '
      + 'the answer with `remember`, and continue the work. Ask only if those sources truly do not answer it, '
      + 'and then end with `STATUS: blocked — <the one question>`.';
  }
  // A status line only ends the turn when nothing after it offers more work:
  // "STATUS: done … Would you like me to continue?" is still a menu.
  const statusLines = [...text.matchAll(new RegExp(STATUS.source, 'gim'))];
  // Without a status the whole reply counts; with one, only what follows that line.
  const tail = statusLines.length === 0 ? text : text.slice(statusLines.at(-1).index).split('\n').slice(1).join('\n');
  if (MENU.test(tail)) {
    return 'You stopped with a list of next steps or an offer to continue. Those are yours to do: continue now '
      + 'and finish them (use `delegate` with `tasks` to run independent pieces in parallel). Stop only when the '
      + 'work is done and verified, or a person must decide something, and end with one line: '
      + '`STATUS: done`, `STATUS: blocked — <question>` or `STATUS: failed — <why>`.';
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const reason = decide(JSON.parse(await stdin() || '{}'));
    if (reason !== null) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } catch {
    // A broken hook must never trap the agent.
  }
  process.exit(0);
}
