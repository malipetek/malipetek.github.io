/*
 * Pre-review: a cheap agent reads the finished run before Ali does.
 *
 * The reviewer sees the client's request, the run's own summary, the changed
 * files and the project's build result — not the whole diff. It answers with a
 * one-line verdict and a few points, which the admin ticket page and the finish
 * mail show instead of making Ali reconstruct the change.
 *
 * It never approves anything. A wrong "pass" is still Ali's to catch; this
 * only makes the common case one screen instead of a diff.
 */
import { now, type Env } from './shared.ts';
import type { RunReport } from './runs.ts';

export type Verdict = 'pass' | 'attention' | 'fail' | 'skip';

export interface Review {
  runId: number;
  verdict: Verdict;
  headline: string;
  points: string[];
  buildOk: boolean | null;
  buildOutput: string;
  model: string | null;
  createdAt: number;
}

interface ReviewRow {
  run_id: number;
  verdict: Verdict;
  headline: string;
  points: string;
  build_ok: number | null;
  build_output: string | null;
  model: string | null;
  created_at: number;
}

const MAX_HEADLINE = 240;
const MAX_POINT = 300;
const MAX_POINTS = 6;

/** The brief the reviewer answers. Kept short: it is a cheap model, not a judge. */
export function reviewPrompt(): string {
  return [
    'You pre-review one completed coding run for a solo contractor. He will read your answer instead of the diff.',
    'You get the client request, what the run says it did, the changed-file summary, and the project build result.',
    'Decide only what the evidence supports. Do not invent files, tests or behaviour that is not described.',
    '',
    'Verdicts:',
    '- "pass": the run addresses the request, the build passed (or there is no build), and nothing looks risky.',
    '- "attention": probably done, but one named thing must be checked before approving.',
    '- "fail": clearly not done, broken, or unrelated changes.',
    '',
    'Be strict about: the request not being addressed, a failed build, unrelated or destructive changes,',
    'secrets in the diff, and claims with no evidence. Be forgiving about wording and style.',
    '',
    'Reply with JSON only:',
    '{"verdict":"pass|attention|fail","headline":"one short sentence Ali can act on","points":["up to 4 short checks"]}',
    'The headline must say what was done, or the one thing to check. Write plainly, in English.',
  ].join('\n');
}

const clip = (text: unknown, max: number) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Parse the model's JSON, tolerating a code fence. Null when it is not usable. */
export function parseReview(content: string): Pick<Review, 'verdict' | 'headline' | 'points'> | null {
  let data: unknown;
  try {
    data = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const raw = data as { verdict?: unknown; headline?: unknown; points?: unknown };
  const verdict = raw.verdict;
  if (verdict !== 'pass' && verdict !== 'attention' && verdict !== 'fail') return null;
  const headline = clip(raw.headline, MAX_HEADLINE);
  if (!headline) return null;
  const points = Array.isArray(raw.points)
    ? raw.points.map((p) => clip(p, MAX_POINT)).filter(Boolean).slice(0, MAX_POINTS)
    : [];
  return { verdict, headline, points };
}

function toReview(row: ReviewRow): Review {
  let points: string[] = [];
  try {
    const parsed = JSON.parse(row.points);
    if (Array.isArray(parsed)) points = parsed.filter((p): p is string => typeof p === 'string').slice(0, MAX_POINTS);
  } catch {
    /* a corrupt row reads as no points */
  }
  return {
    runId: row.run_id,
    verdict: row.verdict,
    headline: row.headline,
    points,
    buildOk: row.build_ok === null ? null : row.build_ok === 1,
    buildOutput: row.build_output ?? '',
    model: row.model,
    createdAt: row.created_at,
  };
}

/** The newest review on a ticket, for the admin page. */
export async function latestReview(env: Env, ticketId: number): Promise<Review | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM run_reviews WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(ticketId)
    .first<ReviewRow>();
  return row ? toReview(row) : null;
}

/** One line for the finish mail. */
export function reviewLine(review: Review | null): string {
  if (!review) return '';
  const tag = review.verdict === 'pass' ? 'PASS' : review.verdict === 'attention' ? 'CHECK' : 'FAIL';
  const build = review.buildOk === null ? '' : review.buildOk ? ' · build passed' : ' · BUILD FAILED';
  return `Pre-review: ${tag} — ${review.headline}${build}`;
}

/**
 * Ask DeepSeek for a verdict and store it. Never throws: a missing key, a
 * timeout or a bad answer leaves the run without a review, which the UI says.
 */
export async function reviewRun(
  env: Env,
  args: { ticketId: number; runId: number; report: RunReport },
): Promise<Review | null> {
  if (!env.DEEPSEEK_API_KEY || !args.runId) return null;

  const [ticket, messages] = await Promise.all([
    env.DB.prepare('SELECT COALESCE(title_en, title) AS title, kind, attention FROM tickets WHERE id = ?')
      .bind(args.ticketId)
      .first<{ title: string; kind: string; attention: string }>(),
    env.DB.prepare(
      `SELECT author, body FROM ticket_messages
        WHERE ticket_id = ? AND author IN ('client', 'ali') ORDER BY id LIMIT 3`,
    )
      .bind(args.ticketId)
      .all<{ author: string; body: string }>(),
  ]);
  if (!ticket) return null;

  const request = (messages.results ?? [])
    .map((m) => `${m.author === 'ali' ? 'Ali' : 'Client'}: ${m.body.slice(0, 1500)}`)
    .join('\n\n');
  const verify = args.report.verify;
  const input = [
    `Ticket: ${ticket.title}`,
    `Kind: ${ticket.kind} · attention: ${ticket.attention}`,
    '',
    'What was asked:',
    request || '(no message recorded)',
    '',
    'What the run reported:',
    args.report.summary.slice(0, 4000),
    '',
    args.report.diffStat ? `Changed files:\n${args.report.diffStat}` : 'No changed-file summary.',
    '',
    verify
      ? `Project build: ${verify.ok === true ? 'passed' : verify.ok === false ? 'FAILED' : 'not run'} (${verify.command})\n${verify.output.slice(0, 1200)}`
      : 'Project build: no verify command configured.',
  ].join('\n');

  const base = (env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');
  let parsed: ReturnType<typeof parseReview> = null;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: reviewPrompt() },
          { role: 'user', content: input },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn('review_failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    parsed = parseReview(data.choices?.[0]?.message?.content ?? '');
  } catch (error) {
    console.warn('review_failed', String(error));
    return null;
  }
  if (!parsed) return null;

  const t = now();
  await env.DB.prepare(
    `INSERT INTO run_reviews (run_id, ticket_id, verdict, headline, points, build_ok, build_output, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET verdict = excluded.verdict, headline = excluded.headline,
       points = excluded.points, build_ok = excluded.build_ok, build_output = excluded.build_output,
       model = excluded.model, created_at = excluded.created_at`,
  )
    .bind(
      args.runId,
      args.ticketId,
      parsed.verdict,
      parsed.headline,
      JSON.stringify(parsed.points),
      verify?.ok === undefined || verify?.ok === null ? null : verify.ok ? 1 : 0,
      verify?.output ?? null,
      env.DEEPSEEK_MODEL || 'deepseek-chat',
      t,
    )
    .run();

  return {
    runId: args.runId,
    verdict: parsed.verdict,
    headline: parsed.headline,
    points: parsed.points,
    buildOk: verify?.ok ?? null,
    buildOutput: verify?.output ?? '',
    model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    createdAt: t,
  };
}
