-- How each hidden control in the audit is known to be wrong, and the owner's dispute of one.
--
-- control_kind: 'altered' - a verified claim shown with a figure the post does not contain, wrong
-- by construction; 'misread' - the first sessions' kind, a claim whose quote's sentence names
-- another system, which the identity check can get wrong. Controls drawn before this migration
-- are all 'misread'.
--
-- control_disputed_at: the owner said a 'misread' control was not misread after all (the post
-- states the figure for this system, through "It …" or the sentence before). A disputed control
-- voids nothing. An 'altered' control cannot be disputed; the application enforces that.
--
-- Idempotent: every column is added only if missing, and the backfill touches only unset rows.

alter table verification_audit add column if not exists control_kind text
  check (control_kind in ('altered', 'misread'));

alter table verification_audit add column if not exists control_disputed_at timestamptz;

update verification_audit set control_kind = 'misread'
  where role = 'control' and control_kind is null;
