-- Queue decisions used to be stored as approved positive fixtures ("analyst-<candidate id>",
-- origin 'analyst') holding every spec of the candidate: also on Discard, where the analyst had
-- said the opposite, and including specs the AI had dropped. They are now derived live from the
-- candidates' current state (queueFixtures in shared/infra/evaluation/evaluation.ts), so the
-- stored ones are retired. Nothing writes this origin any more, so re-running this is a no-op.

UPDATE eval_corpus
SET status = 'superseded',
    decided_at = coalesce(decided_at, now()),
    decided_by = coalesce(decided_by, 'migration-015')
WHERE origin = 'analyst'
  AND id LIKE 'analyst-%'
  AND status <> 'superseded';
