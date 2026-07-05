-- Discord signup events and per-event signup rows.
--
-- Service-role bot commands manage events. Logged-in Supabase users with a
-- Discord-linked profile can read signup lists, create their own signup rows,
-- and remove their own signup rows through the Data API.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null check (guild_id ~ '^[0-9]+$'),
  name text not null check (length(btrim(name)) between 1 and 100),
  name_key text generated always as (lower(btrim(name))) stored,
  required_role_id text check (required_role_id is null or required_role_id ~ '^[0-9]+$'),
  deadline_at timestamptz,
  created_by_discord_user_id text check (
    created_by_discord_user_id is null
    or created_by_discord_user_id ~ '^[0-9]+$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists events_guild_name_key_idx
on public.events (guild_id, name_key);

create index if not exists events_guild_created_at_idx
on public.events (guild_id, created_at desc);

create table if not exists public.event_signups (
  event_id uuid not null references public.events(id) on delete cascade,
  event_name text not null check (length(btrim(event_name)) between 1 and 100),
  guild_id text not null check (guild_id ~ '^[0-9]+$'),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  username text not null check (length(btrim(username)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  signed_up_at timestamptz not null default now(),
  primary key (event_id, discord_user_id)
);

create index if not exists event_signups_event_time_idx
on public.event_signups (event_id, signed_up_at, discord_user_id);

create index if not exists event_signups_user_idx
on public.event_signups (guild_id, discord_user_id, signed_up_at desc);

create or replace function public.set_signup_event_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_signup_event_updated_at on public.events;
create trigger set_signup_event_updated_at
before update on public.events
for each row
execute function public.set_signup_event_updated_at();

create or replace function public.set_event_signup_event_fields()
returns trigger
language plpgsql
as $$
declare
  matched_event public.events%rowtype;
begin
  select *
  into matched_event
  from public.events
  where id = new.event_id;

  if not found then
    raise exception 'event_id does not reference an event'
      using errcode = 'foreign_key_violation';
  end if;

  new.guild_id = matched_event.guild_id;
  new.event_name = matched_event.name;
  return new;
end;
$$;

drop trigger if exists set_event_signup_event_fields on public.event_signups;
create trigger set_event_signup_event_fields
before insert or update of event_id on public.event_signups
for each row
execute function public.set_event_signup_event_fields();

create or replace function public.sync_event_signup_event_name()
returns trigger
language plpgsql
as $$
begin
  update public.event_signups
  set event_name = new.name
  where event_id = new.id;

  return new;
end;
$$;

drop trigger if exists sync_event_signup_event_name on public.events;
create trigger sync_event_signup_event_name
after update of name on public.events
for each row
when (old.name is distinct from new.name)
execute function public.sync_event_signup_event_name();

alter table public.events enable row level security;
alter table public.event_signups enable row level security;

drop policy if exists "discord users can view signup events" on public.events;
create policy "discord users can view signup events"
on public.events
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.discord_user_id is not null
  )
);

drop policy if exists "discord users can view event signups" on public.event_signups;
create policy "discord users can view event signups"
on public.event_signups
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.discord_user_id is not null
  )
);

drop policy if exists "discord users can create their own event signups" on public.event_signups;
create policy "discord users can create their own event signups"
on public.event_signups
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.discord_user_id = event_signups.discord_user_id
  )
  and exists (
    select 1
    from public.events e
    where e.id = event_signups.event_id
      and e.guild_id = event_signups.guild_id
      and (e.deadline_at is null or now() < e.deadline_at)
      and (
        e.required_role_id is null
        or exists (
          select 1
          from public.discord_member_roles r
          where r.guild_id = e.guild_id
            and r.discord_user_id = event_signups.discord_user_id
            and r.role_id = e.required_role_id
        )
      )
  )
);

drop policy if exists "discord users can delete their own event signups" on public.event_signups;
create policy "discord users can delete their own event signups"
on public.event_signups
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.discord_user_id = event_signups.discord_user_id
  )
  and exists (
    select 1
    from public.events e
    where e.id = event_signups.event_id
      and (e.deadline_at is null or now() < e.deadline_at)
  )
);

revoke all on public.events from anon, authenticated;
revoke all on public.event_signups from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.events to authenticated;
grant select, insert, delete on public.event_signups to authenticated;

grant select, insert, update, delete on public.events to service_role;
grant select, insert, update, delete on public.event_signups to service_role;

notify pgrst, 'reload schema';
