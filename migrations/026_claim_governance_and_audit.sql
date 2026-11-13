-- Audit governance: a frozen probability design, a stable identity for each sampled claim, and the
-- second reader's results kept as history instead of read live from the catalogue.
--
-- Additive on top of 019/021/023/025. verification_audit.id and batch_id stay text (the batch id is
-- still the string the auditor's sessions are named by); the new tables reference them as text.
--
-- audit_batches        one row per draw: the design (population and sample sizes per stratum, seed).
--                      Draws made before this migration are backfilled as purpose 'legacy': they were
--                      not probability samples and never enter the formal evaluation.
-- audit_sample_units   one row per claim a formal design selected, with its inclusion probability.
--                      A claim shown again because a failed control voided its answer is another
--                      presentation of the same unit, never another unit.
-- verification_audit_reader
--                      what the second reader said about the claim as it was drawn, one row per
--                      reading, never changed or deleted (a trigger refuses both).
--
-- Idempotent by convention (adopting a database re-runs every migration once - see
-- migrate.server.ts); repairs are predicated on the column they set.

create table if not exists audit_batches (
  id              text primary key default gen_random_uuid()::text,
  drawn_at        timestamptz not null default now(),
  -- formal_eval: the probability sample the gate is computed over. diagnostic: targeted draws that
  -- never enter the confidence bound. legacy: draws made before the design existed.
  purpose         text not null check (purpose in ('formal_eval', 'diagnostic', 'legacy')),
  -- N_h, n_h and the allocation rule; for legacy batches {"legacy": true}.
  sampling_design jsonb not null,
  -- NULL for legacy batches: the population at the time is not known, and none is invented.
  population_size integer,
  sample_size     integer not null,
  seed            bigint,
  -- The verification_audit.batch_id a legacy draw was made under.
  legacy_batch_id text unique
);

create table if not exists audit_sample_units (
  id                    text primary key default gen_random_uuid()::text,
  audit_batch_id        text not null references audit_batches (id) on delete restrict,
  claim_id              text not null,
  -- en | cyrillic | other (FORMAL_STRATA in src/entities/drone/audit-design.ts)
  stratum               text not null,
  -- pi_h = n_h / N_h, one value per stratum, kept at full precision.
  inclusion_probability double precision not null,
  unique (audit_batch_id, claim_id)
);

alter table verification_audit
  add column if not exists audit_batch_id text references audit_batches (id) on delete restrict,
  add column if not exists sampling_purpose text
    check (sampling_purpose in ('formal_eval', 'diagnostic', 'legacy')),
  add column if not exists sample_unit_id text references audit_sample_units (id) on delete restrict,
  add column if not exists retry_of_audit_id text references verification_audit (id) on delete restrict,
  add column if not exists claim_fingerprint text,
  add column if not exists source_text_hash text,
  -- What the second reader had on this claim when it was drawn; see verification_audit_reader.
  add column if not exists reader_state_at_draw text
    check (reader_state_at_draw in ('verified_snapshot', 'legacy_unverified', 'stale', 'none'));

create index if not exists verification_audit_sample_unit_idx
  on verification_audit (sample_unit_id) where sample_unit_id is not null;

-- Existing draws become legacy batches. Predicated on the column being unset, so a re-run repairs
-- a half-applied state and touches nothing already classified.
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

create table if not exists verification_audit_reader (
  id                  text primary key default gen_random_uuid()::text,
  audit_id            text not null references verification_audit (id) on delete restrict,
  -- at_draw: the reading the claim already had when it was drawn, and it was about this claim
  --   version. after_draw: a later reading. backfill: a reading written before readings carried the
  --   claim's fingerprint; it cannot be shown to describe the claim as drawn.
  phase               text not null check (phase in ('at_draw', 'after_draw', 'backfill')),
  -- evaluated_at <= the person's answer: the reader did not see the answer's consequences.
  before_human_answer boolean,
  claim_fingerprint   text,
  source_text_hash    text,
  -- sha256(system prompt, NUL, user prompt) as sent, including the post text after truncation. One
  -- call can carry several claims, so they share it; the claim is identified by claim_fingerprint.
  reader_input_hash   text,
  truncated           boolean not null default false,
  provider            text not null,
  model               text not null,
  -- checked: the claim names the model that extracted it and this is a different one.
  independence        text check (independence in ('checked', 'unknown')),
  prompt_version      text not null,
  entailment_version  text not null,
  -- legacy_unsupported is the pre-split verdict, kept as written and never read as either of the
  -- two verdicts it was split into.
  verdict             text not null check (verdict in
                        ('supported', 'contradicted', 'not_found', 'uncertain', 'legacy_unsupported')),
  span                text,
  note                text,
  -- When the model read the claim (ClaimEntailment.at), not when this row was written.
  evaluated_at        timestamptz not null,
  recorded_at         timestamptz not null default clock_timestamp(),
  check (phase = 'backfill' or (claim_fingerprint is not null and reader_input_hash is not null))
);

create index if not exists verification_audit_reader_audit_idx
  on verification_audit_reader (audit_id, evaluated_at);
-- At most one at_draw reading per audit item, enforced here and not only in the writer.
create unique index if not exists verification_audit_reader_at_draw_uidx
  on verification_audit_reader (audit_id) where phase = 'at_draw';

create or replace function verification_audit_reader_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'verification_audit_reader is append-only (% refused)', tg_op;
end;
$$;

drop trigger if exists verification_audit_reader_no_change on verification_audit_reader;
create trigger verification_audit_reader_no_change
  before update or delete on verification_audit_reader
  for each row execute procedure verification_audit_reader_append_only();

drop trigger if exists verification_audit_reader_no_truncate on verification_audit_reader;
create trigger verification_audit_reader_no_truncate
  before truncate on verification_audit_reader
  for each statement execute procedure verification_audit_reader_append_only();

-- The reader's verdict is four-state now. Controls keep the verdicts they were stored with.
alter table verifier_controls drop constraint if exists verifier_controls_verdict_check;
alter table verifier_controls add constraint verifier_controls_verdict_check
  check (verdict in ('supported', 'contradicted', 'not_found', 'uncertain', 'unsupported'));
