create table public.collection_meta (name text primary key, seeded_at timestamptz not null default now());
create table public.drones (id text primary key, name text not null, domain text not null, origin text not null, data jsonb not null, updated_at timestamptz not null default now());
create index drones_domain_idx on public.drones (domain);
create index drones_data_gin on public.drones using gin (data jsonb_path_ops);
create table public.candidates (id text primary key, status text not null, tier smallint not null, created_at timestamptz not null, data jsonb not null);
create index candidates_status_idx on public.candidates (status, created_at desc);
create table public.sources (id text primary key, position bigserial, platform text not null, handle text not null, data jsonb not null);
create table public.sync_state (name text primary key, last_sync timestamptz not null, last_result jsonb);
create table public.dispatches (id text primary key, source_id text not null, status text not null default 'pending', created_at timestamptz not null default now(), processed_at timestamptz, lease_until timestamptz, lease_by text, data jsonb not null);
create index dispatches_status_idx on public.dispatches (status, created_at asc);
create index dispatches_source_idx on public.dispatches (source_id, created_at desc);
create index dispatches_claim_idx on public.dispatches (created_at asc) where status = 'pending';
create table public.procurements (id text primary key, company text not null, country text not null default '', amount text, currency text, program text, product text, customer text, announced_at timestamptz, source text not null, source_url text, notes text, created_at timestamptz not null default now(), data jsonb not null);
create index procurements_created_at_idx on public.procurements (created_at desc);

grant all on public.collection_meta, public.drones, public.candidates, public.sources, public.sync_state, public.dispatches, public.procurements to service_role;
grant usage, select on all sequences in schema public to service_role;
alter table public.collection_meta enable row level security;
alter table public.drones enable row level security;
alter table public.candidates enable row level security;
alter table public.sources enable row level security;
alter table public.sync_state enable row level security;
alter table public.dispatches enable row level security;
alter table public.procurements enable row level security;

create or replace function public.claim_dispatches(p_limit int, p_lease_ms int, p_owner text)
returns setof text language sql security definer set search_path = public as $$
  update dispatches set lease_until = now() + (p_lease_ms * interval '1 millisecond'), lease_by = p_owner
   where id in (select id from dispatches where status = 'pending' and (lease_until is null or lease_until < now())
                order by created_at asc limit p_limit for update skip locked)
  returning id;
$$;
create or replace function public.release_dispatches(p_ids text[], p_owner text)
returns void language sql security definer set search_path = public as $$
  update dispatches set lease_until = null, lease_by = null where id = any(p_ids) and lease_by = p_owner;
$$;
revoke all on function public.claim_dispatches(int,int,text) from public, anon, authenticated;
revoke all on function public.release_dispatches(text[],text) from public, anon, authenticated;
grant execute on function public.claim_dispatches(int,int,text) to service_role;
grant execute on function public.release_dispatches(text[],text) to service_role;