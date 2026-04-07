-- Lightning Cup live match state storage.
--
-- This keeps the GitHub Pages front end serverless: one row per bracket
-- match stores the current front-end-computed JSON state, and Supabase
-- Realtime Postgres Changes fans updates out to both players.

create table if not exists public.match_states (
  match_id bigint primary key,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create or replace function public.set_match_states_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_match_states_updated_at on public.match_states;
create trigger set_match_states_updated_at
before update on public.match_states
for each row
execute function public.set_match_states_updated_at();

alter table public.match_states enable row level security;

drop policy if exists "match states are viewable" on public.match_states;
create policy "match states are viewable"
on public.match_states
for select
to anon, authenticated
using (true);

drop policy if exists "authenticated users can create match states" on public.match_states;
create policy "authenticated users can create match states"
on public.match_states
for insert
to authenticated
with check (true);

drop policy if exists "authenticated users can update match states" on public.match_states;
create policy "authenticated users can update match states"
on public.match_states
for update
to authenticated
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'match_states'
  ) then
    alter publication supabase_realtime add table public.match_states;
  end if;
end;
$$;
