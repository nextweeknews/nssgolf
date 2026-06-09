-- Player-controlled public profile settings.
--
-- These settings are public-read so player pages can show country, time zone,
-- and self-reported global rank details. Authenticated users can only write the
-- settings row tied to their own Supabase profile and Discord ID.

create table if not exists public.player_settings (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  discord_user_id text not null unique check (discord_user_id ~ '^[0-9]+$'),
  country_1 text check (country_1 is null or country_1 ~ '^[A-Z]{2}$'),
  country_2 text check (country_2 is null or country_2 ~ '^[A-Z]{2}$'),
  time_zone text,
  current_global_rank text,
  max_global_rank_no_cs text,
  max_global_rank_cs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_settings_distinct_countries_check
    check (country_1 is null or country_2 is null or country_1 <> country_2)
);

create index if not exists player_settings_discord_user_idx
on public.player_settings (discord_user_id);

alter table public.player_settings
drop constraint if exists player_settings_current_global_rank_check;

alter table public.player_settings
add constraint player_settings_current_global_rank_check
check (
  current_global_rank is null
  or current_global_rank = any (array[
    '<A20','A21','A22','A23','A24','A25','A26','A27','A28','A29',
    'S0','S1','S2','S3','S4','S5','S6','S7','S8','S9',
    '∞0','∞1','∞2','∞3','∞4','∞5','∞6','∞7','∞8','∞9','∞10'
  ]::text[])
);

alter table public.player_settings
drop constraint if exists player_settings_max_global_rank_no_cs_check;

alter table public.player_settings
add constraint player_settings_max_global_rank_no_cs_check
check (
  max_global_rank_no_cs is null
  or max_global_rank_no_cs = any (array[
    '<A20','A21','A22','A23','A24','A25','A26','A27','A28','A29',
    'S0','S1','S2','S3','S4','S5','S6','S7','S8','S9',
    '∞0','∞1','∞2','∞3','∞4','∞5','∞6','∞7','∞8','∞9','∞10'
  ]::text[])
);

alter table public.player_settings
drop constraint if exists player_settings_max_global_rank_cs_check;

alter table public.player_settings
add constraint player_settings_max_global_rank_cs_check
check (
  max_global_rank_cs is null
  or max_global_rank_cs = any (array[
    '<A20','A21','A22','A23','A24','A25','A26','A27','A28','A29',
    'S0','S1','S2','S3','S4','S5','S6','S7','S8','S9',
    '∞0','∞1','∞2','∞3','∞4','∞5','∞6','∞7','∞8','∞9','∞10'
  ]::text[])
);

create or replace function public.set_player_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_player_settings_updated_at on public.player_settings;
create trigger set_player_settings_updated_at
before update on public.player_settings
for each row
execute function public.set_player_settings_updated_at();

alter table public.player_settings enable row level security;

drop policy if exists "player settings are publicly readable" on public.player_settings;
create policy "player settings are publicly readable"
on public.player_settings
for select
to anon, authenticated
using (true);

drop policy if exists "players can insert their own settings" on public.player_settings;
create policy "players can insert their own settings"
on public.player_settings
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.discord_user_id = player_settings.discord_user_id
  )
);

drop policy if exists "players can update their own settings" on public.player_settings;
create policy "players can update their own settings"
on public.player_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.discord_user_id = player_settings.discord_user_id
  )
);

grant select on public.player_settings to anon, authenticated;
grant insert, update on public.player_settings to authenticated;
grant select, insert, update, delete on public.player_settings to service_role;

create table if not exists public.player_custom_urls (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  discord_user_id text not null unique check (discord_user_id ~ '^[0-9]+$'),
  slug text not null unique,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by_user_id uuid references auth.users(id) on delete set null,
  approved_by_username text,
  updated_at timestamptz not null default now(),
  constraint player_custom_urls_slug_format_check
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])$'),
  constraint player_custom_urls_status_check
    check (status in ('pending', 'approved')),
  constraint player_custom_urls_pending_approval_check
    check (
      status = 'approved'
      or (approved_at is null and approved_by_user_id is null and approved_by_username is null)
    ),
  constraint player_custom_urls_approved_metadata_check
    check (
      status = 'pending'
      or (approved_at is not null and approved_by_username is not null and length(trim(approved_by_username)) > 0)
    ),
  constraint player_custom_urls_reserved_slug_check
    check (
      slug <> all (array[
        '404',
        'admin',
        'admin-settings',
        'api',
        'assets',
        'auth',
        'beataidan',
        'bot',
        'championship',
        'css',
        'discord',
        'export',
        'functions',
        'home',
        'index',
        'js',
        'lightningcup',
        'logos',
        'masters',
        'match',
        'node_modules',
        'noptational',
        'noptational-tabs',
        'package',
        'player',
        'player-profile',
        'player-settings',
        'players',
        'privacy',
        'proleague',
        'ranked-league-config',
        'records',
        'settings',
        'settings-data',
        'settings-page',
        'site-topbar',
        'superleague',
        'terms',
        'worldcup',
        'worldopen'
      ]::text[])
    )
);

create index if not exists player_custom_urls_status_idx
on public.player_custom_urls (status, requested_at);

create index if not exists player_custom_urls_discord_user_idx
on public.player_custom_urls (discord_user_id);

drop trigger if exists set_player_custom_urls_updated_at on public.player_custom_urls;
create trigger set_player_custom_urls_updated_at
before update on public.player_custom_urls
for each row
execute function public.set_player_settings_updated_at();

alter table public.player_custom_urls enable row level security;

drop policy if exists "approved player urls are publicly readable" on public.player_custom_urls;
create policy "approved player urls are publicly readable"
on public.player_custom_urls
for select
to anon, authenticated
using (status = 'approved');

drop policy if exists "players can view their own url claims" on public.player_custom_urls;
create policy "players can view their own url claims"
on public.player_custom_urls
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "admins can view all player url claims" on public.player_custom_urls;
create policy "admins can view all player url claims"
on public.player_custom_urls
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = auth.uid()
      and r.role_id = '1069007873985740890'
  )
);

drop policy if exists "players can create pending url claims" on public.player_custom_urls;
create policy "players can create pending url claims"
on public.player_custom_urls
for insert
to authenticated
with check (
  auth.uid() = user_id
  and status = 'pending'
  and approved_at is null
  and approved_by_user_id is null
  and approved_by_username is null
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.discord_user_id = player_custom_urls.discord_user_id
  )
);

drop policy if exists "players can update pending url claims" on public.player_custom_urls;
drop policy if exists "players can update their own url claims to pending" on public.player_custom_urls;
create policy "players can update their own url claims to pending"
on public.player_custom_urls
for update
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and status = 'pending'
  and approved_at is null
  and approved_by_user_id is null
  and approved_by_username is null
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.discord_user_id = player_custom_urls.discord_user_id
  )
);

drop policy if exists "admins can update player url claims" on public.player_custom_urls;
create policy "admins can update player url claims"
on public.player_custom_urls
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = auth.uid()
      and r.role_id = '1069007873985740890'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = auth.uid()
      and r.role_id = '1069007873985740890'
  )
);

drop policy if exists "admins can revoke player url claims" on public.player_custom_urls;
create policy "admins can revoke player url claims"
on public.player_custom_urls
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.discord_member_roles r
      on r.discord_user_id = p.discord_user_id
    where p.user_id = auth.uid()
      and r.role_id = '1069007873985740890'
  )
);

drop policy if exists "players can delete pending url claims" on public.player_custom_urls;
create policy "players can delete pending url claims"
on public.player_custom_urls
for delete
to authenticated
using (auth.uid() = user_id and status = 'pending');

grant select on public.player_custom_urls to anon, authenticated;
grant insert, update, delete on public.player_custom_urls to authenticated;
grant select, insert, update, delete on public.player_custom_urls to service_role;

notify pgrst, 'reload schema';
