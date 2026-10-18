-- Phase 1 of evaluation automation: one table for every dynamic heuristic rule (manual or
-- generated), a monotonic version counter for multi-process cache invalidation, and an
-- idempotent port of the rows in lexicon_overrides (009). lexicon_overrides is kept, unused.

CREATE TABLE IF NOT EXISTS dynamic_rules (
  id             text PRIMARY KEY,
  version        int NOT NULL DEFAULT 1,
  kind           text NOT NULL CHECK (kind IN ('add_cue', 'context_filter', 'add_alias', 'add_stopword', 'add_unit_scale')),
  language       text NOT NULL DEFAULT 'all',
  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'candidate'
                 CHECK (status IN ('candidate', 'evaluating', 'candidate_passed', 'shadow', 'active', 'rejected', 'quarantined', 'superseded')),
  origin         text NOT NULL CHECK (origin IN ('analyst', 'autonomous_sandbox', 'bootstrap')),
  target_key     text,
  rationale      text,
  shadow_metrics jsonb,
  trust_score    float,
  created_at     timestamptz NOT NULL DEFAULT now(),
  promoted_at    timestamptz,
  decided_by     text NOT NULL
);

CREATE TABLE IF NOT EXISTS dynamic_rules_version (
  version      int PRIMARY KEY,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  note         text
);

INSERT INTO dynamic_rules_version (version, updated_at, note)
VALUES (1, now(), 'initial')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS rule_evaluations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         text REFERENCES dynamic_rules(id),
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  passed          boolean NOT NULL,
  corpus_size     int NOT NULL,
  regressions     int NOT NULL,
  broken_fixtures jsonb,
  f1_delta        float
);

CREATE INDEX IF NOT EXISTS idx_dynamic_rules_active ON dynamic_rules(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_dynamic_rules_shadow ON dynamic_rules(status) WHERE status = 'shadow';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lexicon_overrides') THEN
    INSERT INTO dynamic_rules (id, kind, language, payload, status, origin, decided_by, created_at, promoted_at)
    SELECT
      id,
      CASE kind
        WHEN 'cue' THEN 'add_cue'
        WHEN 'alias' THEN 'add_alias'
        WHEN 'stop' THEN 'add_stopword'
        WHEN 'magnitude' THEN 'add_unit_scale'
        ELSE 'context_filter'
      END,
      'all',
      payload,
      CASE status WHEN 'approved' THEN 'active' WHEN 'rejected' THEN 'rejected' ELSE 'candidate' END,
      'analyst',
      coalesce(decided_by, 'analyst'),
      created_at,
      CASE status WHEN 'approved' THEN decided_at END
    FROM lexicon_overrides
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
