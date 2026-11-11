-- Verifier controls: claims that are wrong by construction (a verified claim whose figure was
-- changed to one the post does not contain) shown to the second reader. A "supported" on one is a
-- false support, which measures how often the reader's "supported" is wrong without a person.
--
-- Measured only: nothing here is read by consensus, and no catalogue claim is changed.
--
-- Additive and idempotent by convention (adopting a database re-runs every migration once - see
-- migrate.server.ts).

create table if not exists verifier_controls (
  id                 text primary key default gen_random_uuid()::text,
  asked_at           timestamptz not null default now(),
  claim_id           text not null,
  drone_id           text not null,
  spec_key           text not null,
  family             text,
  language           text,
  source_id          text not null,
  true_value         text not null,
  altered_value      text not null,
  verdict            text not null check (verdict in ('supported', 'unsupported', 'uncertain')),
  span               text,
  provider           text,
  model              text,
  entailment_version text not null,
  unique (claim_id, entailment_version)
);

create index if not exists verifier_controls_asked_at_idx on verifier_controls (asked_at desc);
