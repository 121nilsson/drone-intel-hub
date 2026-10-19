-- Phase 2 of evaluation automation: the in-process sandbox records its full verdict (scores,
-- impact preview, broken fixtures) and which rule set it ran against; mined hypotheses keep
-- the evidence that produced them. Additive and idempotent: safe to re-run on any state.

ALTER TABLE rule_evaluations ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE rule_evaluations ADD COLUMN IF NOT EXISTS rules_version int;
ALTER TABLE rule_evaluations ADD COLUMN IF NOT EXISTS report jsonb;

ALTER TABLE dynamic_rules ADD COLUMN IF NOT EXISTS evidence jsonb;

CREATE INDEX IF NOT EXISTS idx_rule_evaluations_rule ON rule_evaluations(rule_id, evaluated_at DESC);
