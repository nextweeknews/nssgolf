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

notify pgrst, 'reload schema';
