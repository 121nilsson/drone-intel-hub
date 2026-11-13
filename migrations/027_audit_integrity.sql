-- Audit integrity on top of 026: a presentation can only point at the sample unit of its own
-- batch and claim, a formal row cannot lose its unit, a new draw must record its population, and a
-- changed human answer leaves a trace.
--
-- A separate migration rather than an edit of 026, so a database that already ran 026 gets these
-- too. Every statement is guarded (adopting a database re-runs every migration once - see
-- migrate.server.ts); constraints are added only when their name is not already there.

-- A presentation's (unit, batch, claim) must be one row of audit_sample_units. The single-column
-- foreign key from 026 only said the unit exists; it let a row from batch B point at a unit of
-- batch A, or carry another claim than its unit's.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'audit_sample_units_identity_key') then
    alter table audit_sample_units
      add constraint audit_sample_units_identity_key unique (id, audit_batch_id, claim_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'verification_audit_sample_unit_identity_fk') then
    alter table verification_audit
      add constraint verification_audit_sample_unit_identity_fk
      foreign key (sample_unit_id, audit_batch_id, claim_id)
      references audit_sample_units (id, audit_batch_id, claim_id) on delete restrict;
  end if;
  -- The composite key above is only checked when all three columns are set, so a unit without a
  -- batch would slip through it.
  if not exists (select 1 from pg_constraint where conname = 'verification_audit_unit_has_batch_chk') then
    alter table verification_audit
      add constraint verification_audit_unit_has_batch_chk
      check (sample_unit_id is null or audit_batch_id is not null);
  end if;
  -- A formal audit row is a presentation of a sample unit. Controls and negatives are not.
  if not exists (select 1 from pg_constraint where conname = 'verification_audit_formal_has_unit_chk') then
    alter table verification_audit
      add constraint verification_audit_formal_has_unit_chk
      check (not (sampling_purpose = 'formal_eval' and role = 'audit') or sample_unit_id is not null);
  end if;
  -- Only a legacy batch may lack its population: it is unknown there and none is invented.
  if not exists (select 1 from pg_constraint where conname = 'audit_batches_population_chk') then
    alter table audit_batches
      add constraint audit_batches_population_chk
      check (purpose = 'legacy' or population_size is not null);
  end if;
end;
$$;

-- A retry repeats the same sample unit and claim as the presentation it follows.
create or replace function verification_audit_retry_same_unit() returns trigger
language plpgsql as $$
declare
  previous record;
begin
  if new.retry_of_audit_id is null then
    return new;
  end if;
  select sample_unit_id, claim_id into previous
    from verification_audit where id = new.retry_of_audit_id;
  if not found
     or previous.sample_unit_id is distinct from new.sample_unit_id
     or previous.claim_id <> new.claim_id then
    raise exception 'a retry must present the same sample unit and claim as the item it repeats';
  end if;
  return new;
end;
$$;

drop trigger if exists verification_audit_retry_same_unit on verification_audit;
create trigger verification_audit_retry_same_unit
  before insert or update of retry_of_audit_id, sample_unit_id, claim_id on verification_audit
  for each row execute procedure verification_audit_retry_same_unit();

-- A person's answer is still updated in place by the audit flow, so a change after it was first
-- given is recorded: a result computed from the earlier answer can be explained afterwards.
create table if not exists verification_audit_answer_log (
  id                  text primary key default gen_random_uuid()::text,
  audit_id            text not null references verification_audit (id) on delete restrict,
  old_answer          text,
  new_answer          text,
  old_obviously_wrong boolean,
  new_obviously_wrong boolean,
  changed_at          timestamptz not null default clock_timestamp()
);

create index if not exists verification_audit_answer_log_audit_idx
  on verification_audit_answer_log (audit_id, changed_at);

create or replace function verification_audit_log_answer_change() returns trigger
language plpgsql as $$
begin
  insert into verification_audit_answer_log
    (audit_id, old_answer, new_answer, old_obviously_wrong, new_obviously_wrong)
  values (old.id, old.answer, new.answer, old.obviously_wrong, new.obviously_wrong);
  return new;
end;
$$;

drop trigger if exists verification_audit_log_answer on verification_audit;
create trigger verification_audit_log_answer
  after update of answer, obviously_wrong on verification_audit
  for each row
  when (old.answer is not null
        and (old.answer is distinct from new.answer
             or old.obviously_wrong is distinct from new.obviously_wrong))
  execute procedure verification_audit_log_answer_change();

-- The log, like the reader history, is only ever added to. Two triggers, because a row trigger
-- cannot cover TRUNCATE, which is a statement operation.
create or replace function audit_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only (% refused)', tg_table_name, tg_op;
end;
$$;

drop trigger if exists verification_audit_answer_log_no_change on verification_audit_answer_log;
create trigger verification_audit_answer_log_no_change
  before update or delete on verification_audit_answer_log
  for each row execute procedure audit_append_only();

drop trigger if exists verification_audit_answer_log_no_truncate on verification_audit_answer_log;
create trigger verification_audit_answer_log_no_truncate
  before truncate on verification_audit_answer_log
  for each statement execute procedure audit_append_only();
