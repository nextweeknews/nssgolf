-- Discord member and role storage for the NSS Golf bot.
--
-- Roles are modeled as a many-to-many relationship so each Discord member can
-- have any number of roles without changing the table structure.

create table if not exists public.discord_guild_members (
  guild_id text not null check (guild_id ~ '^[0-9]+$'),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  username text not null,
  global_name text,
  discriminator text,
  is_bot boolean not null default false,
  display_name text not null,
  nickname text,
  avatar_url text,
  server_avatar_url text,
  joined_at timestamptz,
  is_current_member boolean not null default true,
  last_scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, discord_user_id)
);

create table if not exists public.discord_roles (
  guild_id text not null check (guild_id ~ '^[0-9]+$'),
  role_id text not null check (role_id ~ '^[0-9]+$'),
  name text not null,
  position integer not null default 0,
  color integer not null default 0,
  is_managed boolean not null default false,
  is_mentionable boolean not null default false,
  is_hoisted boolean not null default false,
  is_current_role boolean not null default true,
  last_scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, role_id)
);

create table if not exists public.discord_member_roles (
  guild_id text not null check (guild_id ~ '^[0-9]+$'),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  role_id text not null check (role_id ~ '^[0-9]+$'),
  scanned_at timestamptz not null default now(),
  primary key (guild_id, discord_user_id, role_id),
  foreign key (guild_id, discord_user_id)
    references public.discord_guild_members (guild_id, discord_user_id)
    on delete cascade,
  foreign key (guild_id, role_id)
    references public.discord_roles (guild_id, role_id)
    on delete cascade
);

create index if not exists discord_guild_members_guild_display_name_idx
on public.discord_guild_members (guild_id, display_name);

create index if not exists discord_guild_members_current_idx
on public.discord_guild_members (guild_id, is_current_member);

create index if not exists discord_roles_guild_name_idx
on public.discord_roles (guild_id, name);

create index if not exists discord_roles_current_idx
on public.discord_roles (guild_id, is_current_role);

create index if not exists discord_member_roles_role_idx
on public.discord_member_roles (guild_id, role_id);

create or replace function public.set_discord_sync_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_discord_guild_members_updated_at on public.discord_guild_members;
create trigger set_discord_guild_members_updated_at
before update on public.discord_guild_members
for each row
execute function public.set_discord_sync_updated_at();

drop trigger if exists set_discord_roles_updated_at on public.discord_roles;
create trigger set_discord_roles_updated_at
before update on public.discord_roles
for each row
execute function public.set_discord_sync_updated_at();

alter table public.discord_guild_members enable row level security;
alter table public.discord_roles enable row level security;
alter table public.discord_member_roles enable row level security;

grant select, insert, update, delete on public.discord_guild_members to service_role;
grant select, insert, update, delete on public.discord_roles to service_role;
grant select, insert, update, delete on public.discord_member_roles to service_role;

notify pgrst, 'reload schema';
