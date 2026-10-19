-- Phase 3 of evaluation automation: every lifecycle decision on a dynamic rule, by whom, so
-- trust can be calibrated per category from analyst verdicts and the daily auto-activation cap
-- can be counted. Append-only; additive and idempotent.

CREATE TABLE IF NOT EXISTS rule_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     text NOT NULL REFERENCES dynamic_rules(id),
  category    text NOT NULL,
  origin      text NOT NULL,
  decision    text NOT NULL
              CHECK (decision IN ('shadowed', 'activated', 'auto_activated', 'rejected', 'quarantined')),
  actor       text NOT NULL CHECK (actor IN ('analyst', 'autonomous', 'circuit_breaker', 'sandbox')),
  note        text,
  decided_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rule_decisions_category ON rule_decisions(category);
CREATE INDEX IF NOT EXISTS idx_rule_decisions_at ON rule_decisions(decided_at DESC);
