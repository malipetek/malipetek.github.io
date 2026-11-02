/*
 * Autopilot approval: a small request the client capped themselves.
 *
 * The client already picks "Autopilot" and may set a budget. Until now that
 * only described the job; every request still waited for Ali. With a cap from
 * Settings, a client request that is Autopilot *and* carries a budget no larger
 * than the cap starts by itself, and a node can take it immediately.
 *
 * Deliberately narrow:
 *   - only `kind = 'client'` requests (not system tasks, not intake),
 *   - only `attention = 'auto'` (the client chose to stay out of the loop),
 *   - only with a budget: an uncapped request stays manual,
 *   - never past the Settings cap (0 turns the whole thing off).
 */
import { now, type Env } from './shared.ts';
import { getSettings } from './queue.ts';

export interface AutoApproveTicket {
  status: string;
  kind: string;
  attention: string;
  budgetCents: number | null;
}

/** Whether this ticket may start without Ali. Pure, so the rule is testable. */
export function autoApproveDecision(ticket: AutoApproveTicket, capCents: number): boolean {
  if (!Number.isInteger(capCents) || capCents <= 0) return false;
  if (ticket.status !== 'new' || ticket.kind !== 'client') return false;
  if (ticket.attention !== 'auto') return false;
  const budget = ticket.budgetCents;
  return budget !== null && Number.isInteger(budget) && budget > 0 && budget <= capCents;
}

/**
 * Approve the ticket when the client's own choices allow it.
 * @returns true when it moved to approved.
 */
export async function maybeAutoApprove(env: Env, ticketId: number): Promise<boolean> {
  const { autoApproveCents } = await getSettings(env);
  if (autoApproveCents <= 0) return false;

  const ticket = await env.DB.prepare('SELECT status, kind, attention, budget_cents FROM tickets WHERE id = ?')
    .bind(ticketId)
    .first<{ status: string; kind: string; attention: string; budget_cents: number | null }>();
  if (!ticket) return false;

  const decision = autoApproveDecision(
    {
      status: ticket.status,
      kind: ticket.kind,
      attention: ticket.attention,
      budgetCents: ticket.budget_cents,
    },
    autoApproveCents,
  );
  if (!decision) return false;

  const t = now();
  const moved = await env.DB.prepare(
    `UPDATE tickets SET status = 'approved', updated_at = ?, stalled_alerted_at = NULL
      WHERE id = ? AND status = 'new' RETURNING id`,
  )
    .bind(t, ticketId)
    .first<{ id: number }>();
  if (!moved) return false;

  // Internal: the client sees the status change; this is the reason on record.
  await env.DB.prepare(
    `INSERT INTO ticket_messages (ticket_id, author, body, internal, created_at) VALUES (?, 'system', ?, 1, ?)`,
  )
    .bind(
      ticketId,
      `Auto-approved: Autopilot with a $${((ticket.budget_cents ?? 0) / 100).toFixed(2)} budget, within the $${(autoApproveCents / 100).toFixed(2)} cap. A node can take it now.`,
      t,
    )
    .run();
  return true;
}
