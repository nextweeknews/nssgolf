begin;

-- Legacy bootstrap only. Once the canonical hardening migration exists, this
-- file must not be able to restore its retired grants or policies.
do $legacy_schema_guard$
begin
  if to_regclass('public.discord_guild_sync_state') is not null then
    raise exception 'This legacy schema file is retired for migrated projects. Apply Supabase migrations instead.';
  end if;
end;
$legacy_schema_guard$;

-- GPI leaderboard visibility moderation.
--
-- Public visitors can read hidden player IDs so the browser can remove those
-- rows before rendering public leaderboards. Only authenticated NSS Golf admins
-- can hide or unhide players from /gpi.html.

create table if not exists public.gpi_hidden_players (
  discord_user_id text primary key check (discord_user_id ~ '^[0-9]+$'),
  hidden_at timestamptz not null default now(),
  hidden_by_user_id uuid references auth.users(id) on delete set null,
  hidden_by_username text
);

alter table public.gpi_hidden_players
add column if not exists hidden_at timestamptz not null default now();

alter table public.gpi_hidden_players
add column if not exists hidden_by_user_id uuid references auth.users(id) on delete set null;

alter table public.gpi_hidden_players
add column if not exists hidden_by_username text;

alter table public.gpi_hidden_players enable row level security;

drop policy if exists "gpi hidden players are publicly readable" on public.gpi_hidden_players;
create policy "gpi hidden players are publicly readable"
on public.gpi_hidden_players
for select
to anon, authenticated
using (true);

drop policy if exists "admins can hide gpi players" on public.gpi_hidden_players;
create policy "admins can hide gpi players"
on public.gpi_hidden_players
for insert
to authenticated
with check (
  (hidden_by_user_id is null or hidden_by_user_id = (select auth.uid()))
  and exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = (select auth.uid())
      and r.role_id = '1069007873985740890'
  )
);

drop policy if exists "admins can update gpi hidden players" on public.gpi_hidden_players;
create policy "admins can update gpi hidden players"
on public.gpi_hidden_players
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = (select auth.uid())
      and r.role_id = '1069007873985740890'
  )
)
with check (
  (hidden_by_user_id is null or hidden_by_user_id = (select auth.uid()))
  and exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = (select auth.uid())
      and r.role_id = '1069007873985740890'
  )
);

drop policy if exists "admins can unhide gpi players" on public.gpi_hidden_players;
create policy "admins can unhide gpi players"
on public.gpi_hidden_players
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = (select auth.uid())
      and r.role_id = '1069007873985740890'
  )
);

grant select on public.gpi_hidden_players to anon, authenticated;
revoke insert, update, delete, truncate on public.gpi_hidden_players from anon, authenticated;
grant select, insert, update, delete on public.gpi_hidden_players to service_role;

notify pgrst, 'reload schema';

commit;
