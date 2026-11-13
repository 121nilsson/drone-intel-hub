-- Make the audit's classification mandatory. 027's check that a formal audit row has its sample
-- unit reads `sampling_purpose`, and a CHECK that evaluates to NULL passes: a row with no purpose
-- slipped through it. With both columns NOT NULL the contract binds.
--
-- First the same backfill as 026, for any row written between 026 and this migration by code that
-- did not set the columns (they are classified legacy: not a probability sample). Predicated on
-- the column being unset, so a re-run touches nothing already classified.

insert into audit_batches (purpose, sampling_design, sample_size, seed, legacy_batch_id, drawn_at)
select 'legacy', '{"legacy": true}'::jsonb, count(*)::int, min(a.draw_seed), a.batch_id, min(a.drawn_at)
  from verification_audit a
 where a.sampling_purpose is null
   and not exists (select 1 from audit_batches b where b.legacy_batch_id = a.batch_id)
 group by a.batch_id;

update verification_audit a
   set sampling_purpose = 'legacy', audit_batch_id = b.id
  from audit_batches b
 where b.legacy_batch_id = a.batch_id and a.sampling_purpose is null;

-- A row of an unclassified batch that still has no batch (its sampling_purpose was set but its
-- batch was not) is classified by the same legacy batch.
update verification_audit a
   set audit_batch_id = b.id
  from audit_batches b
 where b.legacy_batch_id = a.batch_id and a.audit_batch_id is null;

alter table verification_audit alter column sampling_purpose set not null;
alter table verification_audit alter column audit_batch_id set not null;
