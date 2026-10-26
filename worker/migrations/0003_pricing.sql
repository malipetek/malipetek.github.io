-- Metered pricing: price = Ali's measured time × hourly rate + AI cost at cost.
-- See src/lib/pricing.js. Money is integers (cents, micro-dollars).

-- How much human attention the client asked for: auto | checked | hands_on.
ALTER TABLE tickets ADD COLUMN attention TEXT NOT NULL DEFAULT 'checked';
-- Seconds Ali actually spent on it (measured in the admin view, correctable).
ALTER TABLE tickets ADD COLUMN human_seconds INTEGER NOT NULL DEFAULT 0;
-- What the agent runs cost, summed across re-runs, in micro-dollars.
ALTER TABLE tickets ADD COLUMN ai_micro_usd INTEGER NOT NULL DEFAULT 0;
-- Optional ceiling the client set. Ali must ask before going past it.
ALTER TABLE tickets ADD COLUMN budget_cents INTEGER;
-- Frozen when the ticket is marked done; NULL while the meter is still running.
ALTER TABLE tickets ADD COLUMN price_cents INTEGER;
