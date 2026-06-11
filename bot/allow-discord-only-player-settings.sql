-- Allow the Discord bot to create player_settings rows before a player has
-- logged into nssgolf.com.
--
-- Run this once in the Supabase SQL editor for the production project.

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'player_settings'
      and constraint_name = 'player_settings_pkey'
      and constraint_type = 'PRIMARY KEY'
  ) and not exists (
    select 1
    from information_schema.key_column_usage
    where table_schema = 'public'
      and table_name = 'player_settings'
      and constraint_name = 'player_settings_pkey'
      and column_name = 'discord_user_id'
  ) then
    alter table public.player_settings drop constraint player_settings_pkey;
  end if;
end;
$$;

alter table public.player_settings
alter column user_id drop not null;

alter table public.player_settings
drop constraint if exists player_settings_discord_user_id_key;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'player_settings'
      and constraint_name = 'player_settings_pkey'
      and constraint_type = 'PRIMARY KEY'
  ) then
    alter table public.player_settings add constraint player_settings_pkey primary key (discord_user_id);
  end if;
end;
$$;

create unique index if not exists player_settings_user_id_unique_idx
on public.player_settings (user_id)
where user_id is not null;

drop policy if exists "players can update their own settings" on public.player_settings;
create policy "players can update their own settings"
on public.player_settings
for update
to authenticated
using (
  (user_id is null or auth.uid() = user_id)
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.discord_user_id = player_settings.discord_user_id
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.discord_user_id = player_settings.discord_user_id
  )
);

notify pgrst, 'reload schema';
