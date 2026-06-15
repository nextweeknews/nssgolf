-- Championship leaderboard global settings.
--
-- Public visitors can read these settings so the leaderboard is consistent for
-- everyone. Only authenticated NSS Golf admins can edit point values or hidden
-- player keys from the browser.

create table if not exists public.championship_point_settings (
  id text primary key default 'current',
  settings jsonb not null default '{}'::jsonb,
  hidden_player_keys text[] not null default '{}'::text[],
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint championship_point_settings_current_id_check check (id = 'current')
);

alter table public.championship_point_settings
add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.championship_point_settings
add column if not exists hidden_player_keys text[] not null default '{}'::text[];

alter table public.championship_point_settings
add column if not exists updated_by_user_id uuid references auth.users(id) on delete set null;

alter table public.championship_point_settings
add column if not exists created_at timestamptz not null default now();

alter table public.championship_point_settings
add column if not exists updated_at timestamptz not null default now();

alter table public.championship_point_settings
drop constraint if exists championship_point_settings_current_id_check;

alter table public.championship_point_settings
add constraint championship_point_settings_current_id_check check (id = 'current');

create or replace function public.set_championship_point_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_championship_point_settings_updated_at on public.championship_point_settings;
create trigger set_championship_point_settings_updated_at
before update on public.championship_point_settings
for each row
execute function public.set_championship_point_settings_updated_at();

alter table public.championship_point_settings enable row level security;

drop policy if exists "championship settings are publicly readable" on public.championship_point_settings;
create policy "championship settings are publicly readable"
on public.championship_point_settings
for select
to anon, authenticated
using (true);

drop policy if exists "admins can create championship settings" on public.championship_point_settings;
create policy "admins can create championship settings"
on public.championship_point_settings
for insert
to authenticated
with check (
  id = 'current'
  and (updated_by_user_id is null or updated_by_user_id = (select auth.uid()))
  and exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = (select auth.uid())
      and r.role_id = '1069007873985740890'
  )
);

drop policy if exists "admins can update championship settings" on public.championship_point_settings;
create policy "admins can update championship settings"
on public.championship_point_settings
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
  id = 'current'
  and (updated_by_user_id is null or updated_by_user_id = (select auth.uid()))
  and exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = (select auth.uid())
      and r.role_id = '1069007873985740890'
  )
);

grant select on public.championship_point_settings to anon, authenticated;
grant insert, update on public.championship_point_settings to authenticated;
grant select, insert, update, delete on public.championship_point_settings to service_role;

notify pgrst, 'reload schema';
