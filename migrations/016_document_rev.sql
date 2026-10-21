-- Per-document revision for conditional writes.
--
-- Repositories hold a whole-collection snapshot, so without a token a second writer replaces
-- the first writer's document. `rev` is the store-managed token: a successful put increments
-- it, and a put that names an older revision matches no row and is reported as a conflict.
-- It lives beside `data`, never inside it, so domain documents carry no storage metadata.
--
-- Idempotent because adopting a database re-runs every migration once (see migrate.server.ts).

alter table drones add column if not exists rev bigint not null default 0;
alter table candidates add column if not exists rev bigint not null default 0;
alter table sources add column if not exists rev bigint not null default 0;
alter table dispatches add column if not exists rev bigint not null default 0;
alter table procurements add column if not exists rev bigint not null default 0;
alter table taxonomies add column if not exists rev bigint not null default 0;
alter table taxonomy_candidates add column if not exists rev bigint not null default 0;
