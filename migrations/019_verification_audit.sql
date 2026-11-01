-- Phase 2 of the autonomy plan: the human audit of `verified` claims and the frozen seed set.
--
-- One row per claim shown to the auditor. The row keeps a snapshot of what was shown - the value,
-- the quote and the post - so an answer stays interpretable after the claim is re-verified, edited
-- or its post leaves the archive, and so the seed set stays frozen for good.
--
-- Kept apart from the catalogue on purpose: an analyst's verdict on a claim (SpecClaim.review) is
-- read by every learning loop - evaluation, regression fixtures, mining. Nothing that learns may
-- read the seed set (plan §3, principle 7), so it lives here, where only the audit reads it.
--
-- Additive and idempotent by convention (adopting a database re-runs every migration once - see
-- migrate.server.ts).

create table if not exists verification_audit (
  id               text primary key default gen_random_uuid()::text,
  batch_id         text not null,
  position         integer not null,
  drawn_at         timestamptz not null default now(),
  -- The seed the batch was drawn with, so the draw can be repeated.
  draw_seed        bigint not null,
  -- audit: a verified claim, scored. control: a claim the deterministic checks proved misread,
  -- hidden in the batch; a batch whose auditor passes one is not counted. negative: a rejected or
  -- uncertain claim drawn for the seed set, so the seed set is not all positives.
  role             text not null check (role in ('audit', 'control', 'negative')),
  in_seed          boolean not null default false,
  drone_id         text not null,
  drone_name       text not null,
  spec_key         text not null,
  spec_label       text not null,
  claim_id         text not null,
  language         text not null,
  family           text not null,
  state_at_draw    text not null,
  verifier_version text,
  value            text not null,
  evidence         text,
  source           text not null,
  source_id        text,
  post_text        text,
  answer           text check (answer in ('yes', 'no', 'cannot_tell')),
  -- The post states the figure, but it is plainly wrong: reported, never counted as an error.
  obviously_wrong  boolean not null default false,
  read_via         text check (read_via in ('original', 'translation')),
  answered_at      timestamptz,
  unique (batch_id, claim_id)
);

create index if not exists verification_audit_batch_idx
  on verification_audit (batch_id, position);
create index if not exists verification_audit_claim_idx on verification_audit (claim_id);
create index if not exists verification_audit_open_idx
  on verification_audit (drawn_at) where answer is null;
