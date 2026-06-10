-- Stored Discord webhook messages for global rank display boards.
--
-- These rows include webhook tokens, so they must only be readable by the
-- service-role key used by the Discord bot.

create table if not exists public.discord_global_rank_display_messages (
  guild_id text not null check (guild_id ~ '^[0-9]+$'),
  channel_id text not null check (channel_id ~ '^[0-9]+$'),
  rank_key text not null,
  webhook_id text not null check (webhook_id ~ '^[0-9]+$'),
  webhook_token text not null,
  message_id text not null check (message_id ~ '^[0-9]+$'),
  created_by_discord_user_id text check (created_by_discord_user_id is null or created_by_discord_user_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, channel_id, rank_key),
  constraint discord_global_rank_display_messages_rank_key_check
    check (rank_key = any (array[
      'current_global_rank',
      'max_global_rank_no_cs',
      'max_global_rank_cs'
    ]::text[]))
);

create index if not exists discord_global_rank_display_messages_rank_key_idx
on public.discord_global_rank_display_messages (guild_id, rank_key);

create or replace function public.set_discord_global_rank_display_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_discord_global_rank_display_updated_at
on public.discord_global_rank_display_messages;

create trigger set_discord_global_rank_display_updated_at
before update on public.discord_global_rank_display_messages
for each row
execute function public.set_discord_global_rank_display_updated_at();

alter table public.discord_global_rank_display_messages enable row level security;

revoke all on public.discord_global_rank_display_messages from anon, authenticated;
grant select, insert, update, delete on public.discord_global_rank_display_messages to service_role;

notify pgrst, 'reload schema';
