ALTER TABLE dynamic_rules DROP CONSTRAINT IF EXISTS dynamic_rules_status_check;
ALTER TABLE dynamic_rules ADD CONSTRAINT dynamic_rules_status_check
  CHECK (status IN ('candidate', 'evaluating', 'candidate_passed', 'shadow', 'active', 'rejected', 'quarantined', 'superseded'));
