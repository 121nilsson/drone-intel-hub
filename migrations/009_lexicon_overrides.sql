CREATE TABLE IF NOT EXISTS lexicon_overrides (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('cue','notAfter','magnitude','alias','stop')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text
);
