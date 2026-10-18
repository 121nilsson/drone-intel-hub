-- Evaluation tables for the heuristic evaluation loop.
-- Plain portable SQL, applied on fresh volumes by docker-compose.

CREATE TABLE IF NOT EXISTS eval_reports (
  id uuid PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  seed int NOT NULL,
  sample_size int NOT NULL,
  corpus_version int NOT NULL,
  report jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_corpus (
  id text NOT NULL,
  version int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('positive','negative')),
  fixture jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','pending_fix','approved','rejected','superseded')),
  origin text NOT NULL CHECK (origin IN ('agreement','adjudication','pattern','analyst','git_import')),
  source_report uuid REFERENCES eval_reports(id),
  observed_at timestamptz NOT NULL,
  supersedes int,
  decided_at timestamptz,
  decided_by text,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS eval_corpus_version (
  version int PRIMARY KEY,
  created_at timestamptz NOT NULL,
  note text
);

CREATE TABLE IF NOT EXISTS eval_lock (
  name text PRIMARY KEY,
  held_until timestamptz NOT NULL
);

-- Seed corpus version 1 if absent.
INSERT INTO eval_corpus_version (version, created_at, note)
VALUES (1, now(), 'initial')
ON CONFLICT (version) DO NOTHING;
