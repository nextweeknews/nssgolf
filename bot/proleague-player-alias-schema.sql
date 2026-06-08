-- Shotgun Pro League player aliases.
--
-- The Google Sheet uses stable league names that do not always match current
-- Discord display names. This table maps those stable league aliases to the
-- canonical Discord user ID used by player pages.

create or replace function public.normalize_player_alias_key(alias text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(lower(trim(coalesce(alias, ''))), '[^a-z0-9]+', '', 'g');
$$;

create table if not exists public.player_league_aliases (
  league_key text not null check (league_key ~ '^[a-z0-9_]+$'),
  league_player_name text not null check (length(trim(league_player_name)) > 0),
  league_player_key text generated always as (public.normalize_player_alias_key(league_player_name)) stored,
  guild_id text not null check (guild_id ~ '^[0-9]+$'),
  discord_user_id text check (discord_user_id is null or discord_user_id ~ '^[0-9]+$'),
  active boolean not null default true,
  source text not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_key, league_player_key),
  constraint player_league_aliases_active_discord_user_id_check
    check (active = false or discord_user_id is not null),
  foreign key (guild_id, discord_user_id)
    references public.discord_guild_members (guild_id, discord_user_id)
    on update cascade
    on delete restrict
);

alter table public.player_league_aliases
alter column discord_user_id drop not null;

alter table public.player_league_aliases
drop constraint if exists player_league_aliases_discord_user_id_check;

alter table public.player_league_aliases
drop constraint if exists player_league_aliases_discord_user_id_format_check;

alter table public.player_league_aliases
add constraint player_league_aliases_discord_user_id_format_check
check (discord_user_id is null or discord_user_id ~ '^[0-9]+$');

alter table public.player_league_aliases
drop constraint if exists player_league_aliases_active_discord_user_id_check;

alter table public.player_league_aliases
add constraint player_league_aliases_active_discord_user_id_check
check (active = false or discord_user_id is not null);

create index if not exists player_league_aliases_discord_user_idx
on public.player_league_aliases (guild_id, discord_user_id)
where active;

create index if not exists player_league_aliases_league_name_idx
on public.player_league_aliases (league_key, league_player_name);

create or replace function public.set_player_league_aliases_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_player_league_aliases_updated_at on public.player_league_aliases;
create trigger set_player_league_aliases_updated_at
before update on public.player_league_aliases
for each row
execute function public.set_player_league_aliases_updated_at();

alter table public.player_league_aliases enable row level security;

drop policy if exists "player league aliases are publicly readable" on public.player_league_aliases;
create policy "player league aliases are publicly readable"
on public.player_league_aliases
for select
to anon, authenticated
using (active = true);

grant select on public.player_league_aliases to anon, authenticated;
grant select, insert, update, delete on public.player_league_aliases to service_role;

notify pgrst, 'reload schema';
