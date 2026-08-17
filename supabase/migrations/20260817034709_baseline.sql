-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP EXTENSION pg_net;

DROP EXTENSION pg_graphql;

CREATE EXTENSION citext WITH SCHEMA public;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

CREATE SEQUENCE public.bracket_picks_id_seq;

CREATE SEQUENCE public.internal_ranked_elo_runs_id_seq;

CREATE SEQUENCE public.internal_ranked_gpi_runs_id_seq;

CREATE SEQUENCE public.internal_tournament_gpi_runs_id_seq;

CREATE FUNCTION public.base_points_for_round (
  round_number smallint
)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  AS $function$
  select case round_number
    when 1 then 1
    when 2 then 2
    when 3 then 4
    when 4 then 8
    when 5 then 16
    when 6 then 32
    else 0
  end;
$function$;

GRANT ALL ON FUNCTION public.base_points_for_round(smallint) TO anon;

GRANT ALL ON FUNCTION public.base_points_for_round(smallint) TO authenticated;

GRANT ALL ON FUNCTION public.base_points_for_round(smallint) TO service_role;

CREATE FUNCTION public.get_internal_ranked_head_to_head_matches (
  player_a_id text,
  player_b_id text
)
  RETURNS TABLE (
    match_hash     text,
    season         integer,
    timestamp_ms   bigint,
    played_at      timestamp with time zone,
    player_a_place integer,
    player_b_place integer
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  with match_players as (
    select
      matches.match_hash,
      matches.season,
      matches.timestamp_ms,
      matches.played_at,
      player.value ->> 'player_id' as discord_user_id,
      (result.value ->> 'place')::integer as place
    from public.internal_ranked_matches as matches
    cross join lateral jsonb_array_elements(matches.raw_match -> 'results') as result(value)
    cross join lateral jsonb_array_elements(result.value -> 'players') as player(value)
    where
      player_a_id ~ '^[0-9]+$'
      and player_b_id ~ '^[0-9]+$'
      and player_a_id <> player_b_id
      and player.value ->> 'player_id' in (player_a_id, player_b_id)
      and result.value ->> 'place' ~ '^[0-9]+$'
  )
  select
    player_a.match_hash,
    player_a.season,
    player_a.timestamp_ms,
    player_a.played_at,
    player_a.place as player_a_place,
    player_b.place as player_b_place
  from match_players as player_a
  join match_players as player_b
    on player_b.match_hash = player_a.match_hash
  where
    player_a.discord_user_id = player_a_id
    and player_b.discord_user_id = player_b_id
  order by player_a.timestamp_ms, player_a.match_hash;
$function$;

REVOKE ALL ON FUNCTION public.get_internal_ranked_head_to_head_matches(text, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_internal_ranked_head_to_head_matches(text, text) TO anon;

GRANT ALL ON FUNCTION public.get_internal_ranked_head_to_head_matches(text, text) TO authenticated;

GRANT ALL ON FUNCTION public.get_internal_ranked_head_to_head_matches(text, text) TO service_role;

CREATE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;

GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

CREATE FUNCTION public.normalize_player_alias_key (
  alias text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  AS $function$
  select regexp_replace(lower(trim(coalesce(alias, ''))), '[^a-z0-9]+', '', 'g');
$function$;

GRANT ALL ON FUNCTION public.normalize_player_alias_key(text) TO anon;

GRANT ALL ON FUNCTION public.normalize_player_alias_key(text) TO authenticated;

GRANT ALL ON FUNCTION public.normalize_player_alias_key(text) TO service_role;

CREATE FUNCTION public.set_championship_point_settings_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_championship_point_settings_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_championship_point_settings_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_championship_point_settings_updated_at() TO service_role;

CREATE FUNCTION public.set_discord_global_rank_display_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_discord_global_rank_display_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_discord_global_rank_display_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_discord_global_rank_display_updated_at() TO service_role;

CREATE FUNCTION public.set_discord_sync_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_discord_sync_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_discord_sync_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_discord_sync_updated_at() TO service_role;

CREATE FUNCTION public.set_event_blocked_role_event_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
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
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_event_blocked_role_event_fields() TO anon;

GRANT ALL ON FUNCTION public.set_event_blocked_role_event_fields() TO authenticated;

GRANT ALL ON FUNCTION public.set_event_blocked_role_event_fields() TO service_role;

CREATE FUNCTION public.set_event_required_role_event_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
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
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_event_required_role_event_fields() TO anon;

GRANT ALL ON FUNCTION public.set_event_required_role_event_fields() TO authenticated;

GRANT ALL ON FUNCTION public.set_event_required_role_event_fields() TO service_role;

CREATE FUNCTION public.set_event_signup_display_event_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
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
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_event_signup_display_event_fields() TO anon;

GRANT ALL ON FUNCTION public.set_event_signup_display_event_fields() TO authenticated;

GRANT ALL ON FUNCTION public.set_event_signup_display_event_fields() TO service_role;

CREATE FUNCTION public.set_event_signup_display_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_event_signup_display_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_event_signup_display_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_event_signup_display_updated_at() TO service_role;

CREATE FUNCTION public.set_event_signup_event_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
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
$function$;

GRANT ALL ON FUNCTION public.set_event_signup_event_fields() TO anon;

GRANT ALL ON FUNCTION public.set_event_signup_event_fields() TO authenticated;

GRANT ALL ON FUNCTION public.set_event_signup_event_fields() TO service_role;

CREATE FUNCTION public.set_internal_ranked_matches_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_internal_ranked_matches_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_internal_ranked_matches_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_internal_ranked_matches_updated_at() TO service_role;

CREATE FUNCTION public.set_match_states_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_match_states_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_match_states_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_match_states_updated_at() TO service_role;

CREATE FUNCTION public.set_player_league_aliases_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_player_league_aliases_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_player_league_aliases_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_player_league_aliases_updated_at() TO service_role;

CREATE FUNCTION public.set_player_settings_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_player_settings_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_player_settings_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_player_settings_updated_at() TO service_role;

CREATE FUNCTION public.set_signup_event_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_signup_event_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_signup_event_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_signup_event_updated_at() TO service_role;

CREATE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;

CREATE FUNCTION public.sync_event_signup_event_name()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  update public.event_signups
  set event_name = new.name
  where event_id = new.id;

  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.sync_event_signup_event_name() TO anon;

GRANT ALL ON FUNCTION public.sync_event_signup_event_name() TO authenticated;

GRANT ALL ON FUNCTION public.sync_event_signup_event_name() TO service_role;

CREATE TABLE public.bracket_picks (
  id                   bigint                   DEFAULT nextval('public.bracket_picks_id_seq'::regclass) NOT NULL,
  bracket_id           uuid                     NOT NULL,
  match_id             integer                  NOT NULL,
  round_code           text                     NOT NULL,
  round_number         smallint                 NOT NULL,
  selected_winner_name text                     NOT NULL,
  selected_winner_seed smallint                 NOT NULL,
  is_correct           boolean,
  points_awarded       integer,
  created_at           timestamp with time zone DEFAULT now() NOT NULL,
  updated_at           timestamp with time zone DEFAULT now() NOT NULL,
  year                 text
);

ALTER SEQUENCE public.bracket_picks_id_seq OWNED BY public.bracket_picks.id;

GRANT ALL ON SEQUENCE public.bracket_picks_id_seq TO anon;

GRANT ALL ON SEQUENCE public.bracket_picks_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.bracket_picks_id_seq TO service_role;

ALTER TABLE public.bracket_picks
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_bracket_id_match_id_key UNIQUE (bracket_id, match_id);

ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_match_id_check CHECK (match_id >= 1 AND match_id <= 63);

ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_pkey PRIMARY KEY (id);

ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_round_code_check CHECK (round_code = ANY (ARRAY['R64'::text, 'R32'::text, 'R16'::text, 'R8'::text, 'R4'::text, 'Final'::text]));

ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_round_number_check CHECK (round_number >= 1 AND round_number <= 6);

ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_selected_winner_seed_check CHECK (selected_winner_seed >= 1 AND selected_winner_seed <= 16);

GRANT ALL ON public.bracket_picks TO anon;

GRANT ALL ON public.bracket_picks TO authenticated;

GRANT ALL ON public.bracket_picks TO service_role;

CREATE INDEX idx_bracket_picks_bracket_id ON public.bracket_picks (bracket_id);

CREATE INDEX idx_bracket_picks_match_id ON public.bracket_picks (match_id);

CREATE TRIGGER set_bracket_picks_updated_at
  BEFORE UPDATE ON public.bracket_picks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY bracket_picks_public_read ON public.bracket_picks
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.brackets (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id      uuid                     NOT NULL,
  bracket_name text                     NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  updated_at   timestamp with time zone DEFAULT now() NOT NULL,
  submitted_at timestamp with time zone,
  year         text
);

CREATE POLICY bracket_picks_insert_own ON public.bracket_picks
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.brackets b
  WHERE ((b.id = bracket_picks.bracket_id) AND (b.user_id = auth.uid())))));

CREATE POLICY bracket_picks_update_own ON public.bracket_picks
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.brackets b
  WHERE ((b.id = bracket_picks.bracket_id) AND (b.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.brackets b
  WHERE ((b.id = bracket_picks.bracket_id) AND (b.user_id = auth.uid())))));

ALTER TABLE public.brackets
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.brackets
  ADD CONSTRAINT brackets_pkey PRIMARY KEY (id);

ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_bracket_id_fkey FOREIGN KEY (bracket_id) REFERENCES public.brackets(id) ON DELETE CASCADE;

GRANT ALL ON public.brackets TO anon;

GRANT ALL ON public.brackets TO authenticated;

GRANT ALL ON public.brackets TO service_role;

CREATE UNIQUE INDEX brackets_user_id_year_key ON public.brackets (user_id, year);

CREATE TRIGGER set_brackets_updated_at
  BEFORE UPDATE ON public.brackets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY brackets_insert_own ON public.brackets
  FOR INSERT
  TO authenticated
  WITH CHECK (((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)));

CREATE POLICY brackets_public_read ON public.brackets
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY brackets_update_own ON public.brackets
  FOR UPDATE
  TO authenticated
  USING (((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)))
  WITH CHECK (((auth.uid() IS NOT NULL) AND (auth.uid() = user_id)));

CREATE TABLE public.championship_point_settings (
  id                 text                     DEFAULT 'current'::text NOT NULL,
  settings           jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  hidden_player_keys text[]                   DEFAULT '{}'::text[] NOT NULL,
  updated_by_user_id uuid,
  created_at         timestamp with time zone DEFAULT now() NOT NULL,
  updated_at         timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.championship_point_settings
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.championship_point_settings
  ADD CONSTRAINT championship_point_settings_current_id_check CHECK (id = 'current'::text);

ALTER TABLE public.championship_point_settings
  ADD CONSTRAINT championship_point_settings_pkey PRIMARY KEY (id);

ALTER TABLE public.championship_point_settings
  ADD CONSTRAINT championship_point_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

GRANT ALL ON public.championship_point_settings TO anon;

GRANT ALL ON public.championship_point_settings TO authenticated;

GRANT ALL ON public.championship_point_settings TO service_role;

CREATE TRIGGER set_championship_point_settings_updated_at
  BEFORE UPDATE ON public.championship_point_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_championship_point_settings_updated_at();

CREATE POLICY "championship settings are publicly readable" ON public.championship_point_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.discord_global_rank_display_messages (
  guild_id                   text                     NOT NULL,
  channel_id                 text                     NOT NULL,
  rank_key                   text                     NOT NULL,
  webhook_id                 text                     NOT NULL,
  webhook_token              text                     NOT NULL,
  message_id                 text                     NOT NULL,
  created_by_discord_user_id text,
  created_at                 timestamp with time zone DEFAULT now() NOT NULL,
  updated_at                 timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.discord_global_rank_display_messages
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.discord_global_rank_display_messages
  ADD CONSTRAINT discord_global_rank_display_me_created_by_discord_user_id_check CHECK (created_by_discord_user_id IS NULL OR created_by_discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_global_rank_display_messages
  ADD CONSTRAINT discord_global_rank_display_messages_channel_id_check CHECK (channel_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_global_rank_display_messages
  ADD CONSTRAINT discord_global_rank_display_messages_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_global_rank_display_messages
  ADD CONSTRAINT discord_global_rank_display_messages_message_id_check CHECK (message_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_global_rank_display_messages
  ADD CONSTRAINT discord_global_rank_display_messages_pkey PRIMARY KEY (guild_id, channel_id, rank_key);

ALTER TABLE public.discord_global_rank_display_messages
  ADD CONSTRAINT discord_global_rank_display_messages_rank_key_check
    CHECK (rank_key = ANY (ARRAY['current_global_rank'::text, 'max_global_rank_no_cs'::text, 'max_global_rank_cs'::text]));

ALTER TABLE public.discord_global_rank_display_messages
  ADD CONSTRAINT discord_global_rank_display_messages_webhook_id_check CHECK (webhook_id ~ '^[0-9]+$'::text);

GRANT ALL ON public.discord_global_rank_display_messages TO service_role;

CREATE INDEX discord_global_rank_display_messages_rank_key_idx ON public.discord_global_rank_display_messages (guild_id, rank_key);

CREATE TRIGGER set_discord_global_rank_display_updated_at
  BEFORE UPDATE ON public.discord_global_rank_display_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_discord_global_rank_display_updated_at();

CREATE TABLE public.discord_guild_members (
  guild_id          text                     NOT NULL,
  discord_user_id   text                     NOT NULL,
  username          text                     NOT NULL,
  global_name       text,
  discriminator     text,
  is_bot            boolean                  DEFAULT false NOT NULL,
  display_name      text                     NOT NULL,
  nickname          text,
  avatar_url        text,
  server_avatar_url text,
  joined_at         timestamp with time zone,
  is_current_member boolean                  DEFAULT true NOT NULL,
  last_scanned_at   timestamp with time zone DEFAULT now() NOT NULL,
  created_at        timestamp with time zone DEFAULT now() NOT NULL,
  updated_at        timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.discord_guild_members
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.discord_guild_members
  ADD CONSTRAINT discord_guild_members_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_guild_members
  ADD CONSTRAINT discord_guild_members_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_guild_members
  ADD CONSTRAINT discord_guild_members_pkey PRIMARY KEY (guild_id, discord_user_id);

GRANT ALL ON public.discord_guild_members TO anon;

GRANT ALL ON public.discord_guild_members TO authenticated;

GRANT ALL ON public.discord_guild_members TO service_role;

CREATE INDEX discord_guild_members_guild_display_name_idx ON public.discord_guild_members (guild_id, display_name);

CREATE INDEX discord_guild_members_current_idx ON public.discord_guild_members (guild_id, is_current_member);

CREATE TRIGGER set_discord_guild_members_updated_at
  BEFORE UPDATE ON public.discord_guild_members
  FOR EACH ROW
  EXECUTE FUNCTION public.set_discord_sync_updated_at();

CREATE POLICY "discord guild members are publicly readable" ON public.discord_guild_members
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.discord_member_roles (
  guild_id        text                     NOT NULL,
  discord_user_id text                     NOT NULL,
  role_id         text                     NOT NULL,
  scanned_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.discord_member_roles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.discord_member_roles
  ADD CONSTRAINT discord_member_roles_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_member_roles
  ADD CONSTRAINT discord_member_roles_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_member_roles
  ADD CONSTRAINT discord_member_roles_guild_id_discord_user_id_fkey FOREIGN KEY (guild_id, discord_user_id) REFERENCES public.discord_guild_members(guild_id, discord_user_id)
    ON DELETE CASCADE;

ALTER TABLE public.discord_member_roles
  ADD CONSTRAINT discord_member_roles_pkey PRIMARY KEY (guild_id, discord_user_id, role_id);

ALTER TABLE public.discord_member_roles
  ADD CONSTRAINT discord_member_roles_role_id_check CHECK (role_id ~ '^[0-9]+$'::text);

GRANT ALL ON public.discord_member_roles TO anon;

GRANT ALL ON public.discord_member_roles TO authenticated;

GRANT ALL ON public.discord_member_roles TO service_role;

CREATE INDEX discord_member_roles_role_idx ON public.discord_member_roles (guild_id, role_id);

CREATE POLICY "discord member roles are publicly readable" ON public.discord_member_roles
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.discord_roles (
  guild_id        text                     NOT NULL,
  role_id         text                     NOT NULL,
  name            text                     NOT NULL,
  "position"      integer                  DEFAULT 0 NOT NULL,
  color           integer                  DEFAULT 0 NOT NULL,
  is_managed      boolean                  DEFAULT false NOT NULL,
  is_mentionable  boolean                  DEFAULT false NOT NULL,
  is_hoisted      boolean                  DEFAULT false NOT NULL,
  is_current_role boolean                  DEFAULT true NOT NULL,
  last_scanned_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  updated_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.discord_roles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.discord_roles
  ADD CONSTRAINT discord_roles_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.discord_roles
  ADD CONSTRAINT discord_roles_pkey PRIMARY KEY (guild_id, role_id);

ALTER TABLE public.discord_member_roles
  ADD CONSTRAINT discord_member_roles_guild_id_role_id_fkey FOREIGN KEY (guild_id, role_id) REFERENCES public.discord_roles(guild_id, role_id) ON DELETE CASCADE;

ALTER TABLE public.discord_roles
  ADD CONSTRAINT discord_roles_role_id_check CHECK (role_id ~ '^[0-9]+$'::text);

GRANT ALL ON public.discord_roles TO anon;

GRANT ALL ON public.discord_roles TO authenticated;

GRANT ALL ON public.discord_roles TO service_role;

CREATE INDEX discord_roles_current_idx ON public.discord_roles (guild_id, is_current_role);

CREATE INDEX discord_roles_guild_name_idx ON public.discord_roles (guild_id, name);

CREATE TRIGGER set_discord_roles_updated_at
  BEFORE UPDATE ON public.discord_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_discord_sync_updated_at();

CREATE POLICY "discord roles are publicly readable" ON public.discord_roles
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.event_blocked_roles (
  event_id   uuid                     NOT NULL,
  guild_id   text                     NOT NULL,
  role_id    text                     NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.event_blocked_roles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_blocked_roles
  ADD CONSTRAINT event_blocked_roles_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_blocked_roles
  ADD CONSTRAINT event_blocked_roles_pkey PRIMARY KEY (event_id, role_id);

ALTER TABLE public.event_blocked_roles
  ADD CONSTRAINT event_blocked_roles_role_id_check CHECK (role_id ~ '^[0-9]+$'::text);

GRANT SELECT ON public.event_blocked_roles TO authenticated;

GRANT ALL ON public.event_blocked_roles TO service_role;

CREATE INDEX event_blocked_roles_role_idx ON public.event_blocked_roles (guild_id, role_id);

CREATE TRIGGER set_event_blocked_role_event_fields
  BEFORE INSERT OR UPDATE OF event_id ON public.event_blocked_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_event_blocked_role_event_fields();

CREATE TABLE public.event_required_roles (
  event_id   uuid                     NOT NULL,
  guild_id   text                     NOT NULL,
  role_id    text                     NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.event_required_roles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_required_roles
  ADD CONSTRAINT event_required_roles_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_required_roles
  ADD CONSTRAINT event_required_roles_pkey PRIMARY KEY (event_id, role_id);

ALTER TABLE public.event_required_roles
  ADD CONSTRAINT event_required_roles_role_id_check CHECK (role_id ~ '^[0-9]+$'::text);

GRANT SELECT ON public.event_required_roles TO authenticated;

GRANT ALL ON public.event_required_roles TO service_role;

CREATE INDEX event_required_roles_role_idx ON public.event_required_roles (guild_id, role_id);

CREATE TRIGGER set_event_required_role_event_fields
  BEFORE INSERT OR UPDATE OF event_id ON public.event_required_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_event_required_role_event_fields();

CREATE TABLE public.event_signup_display_messages (
  event_id                   uuid                     NOT NULL,
  guild_id                   text                     NOT NULL,
  channel_id                 text                     NOT NULL,
  message_id                 text                     NOT NULL,
  created_by_discord_user_id text,
  created_at                 timestamp with time zone DEFAULT now() NOT NULL,
  updated_at                 timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.event_signup_display_messages
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_signup_display_messages
  ADD CONSTRAINT event_signup_display_messages_channel_id_check CHECK (channel_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_signup_display_messages
  ADD CONSTRAINT event_signup_display_messages_created_by_discord_user_id_check CHECK (created_by_discord_user_id IS NULL OR created_by_discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_signup_display_messages
  ADD CONSTRAINT event_signup_display_messages_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_signup_display_messages
  ADD CONSTRAINT event_signup_display_messages_message_id_check CHECK (message_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_signup_display_messages
  ADD CONSTRAINT event_signup_display_messages_pkey PRIMARY KEY (event_id, channel_id);

GRANT ALL ON public.event_signup_display_messages TO service_role;

CREATE INDEX event_signup_display_messages_event_idx ON public.event_signup_display_messages (event_id);

CREATE TRIGGER set_event_signup_display_event_fields
  BEFORE INSERT OR UPDATE OF event_id ON public.event_signup_display_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_event_signup_display_event_fields();

CREATE TRIGGER set_event_signup_display_updated_at
  BEFORE UPDATE ON public.event_signup_display_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_event_signup_display_updated_at();

CREATE TABLE public.event_signups (
  event_id        uuid                     NOT NULL,
  event_name      text                     NOT NULL,
  guild_id        text                     NOT NULL,
  discord_user_id text                     NOT NULL,
  username        text                     NOT NULL,
  display_name    text                     NOT NULL,
  signed_up_at    timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.event_signups
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_signups
  ADD CONSTRAINT event_signups_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_signups
  ADD CONSTRAINT event_signups_display_name_check CHECK (length(btrim(display_name)) > 0);

ALTER TABLE public.event_signups
  ADD CONSTRAINT event_signups_event_name_check CHECK (length(btrim(event_name)) >= 1 AND length(btrim(event_name)) <= 100);

ALTER TABLE public.event_signups
  ADD CONSTRAINT event_signups_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.event_signups
  ADD CONSTRAINT event_signups_pkey PRIMARY KEY (event_id, discord_user_id);

ALTER TABLE public.event_signups
  ADD CONSTRAINT event_signups_username_check CHECK (length(btrim(username)) > 0);

GRANT DELETE, INSERT, SELECT ON public.event_signups TO authenticated;

GRANT ALL ON public.event_signups TO service_role;

CREATE INDEX event_signups_user_idx ON public.event_signups (guild_id, discord_user_id, signed_up_at DESC);

CREATE INDEX event_signups_event_time_idx ON public.event_signups (event_id, signed_up_at, discord_user_id);

CREATE TRIGGER set_event_signup_event_fields
  BEFORE INSERT OR UPDATE OF event_id ON public.event_signups
  FOR EACH ROW
  EXECUTE FUNCTION public.set_event_signup_event_fields();

CREATE TABLE public.events (
  id                         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  guild_id                   text                     NOT NULL,
  name                       text                     NOT NULL,
  name_key                   text                     GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  required_role_id           text,
  deadline_at                timestamp with time zone,
  created_by_discord_user_id text,
  created_at                 timestamp with time zone DEFAULT now() NOT NULL,
  updated_at                 timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.events
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.events
  ADD CONSTRAINT events_created_by_discord_user_id_check CHECK (created_by_discord_user_id IS NULL OR created_by_discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.events
  ADD CONSTRAINT events_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.events
  ADD CONSTRAINT events_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 100);

ALTER TABLE public.events
  ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE public.event_blocked_roles
  ADD CONSTRAINT event_blocked_roles_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.event_required_roles
  ADD CONSTRAINT event_required_roles_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.event_signup_display_messages
  ADD CONSTRAINT event_signup_display_messages_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.event_signups
  ADD CONSTRAINT event_signups_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.events
  ADD CONSTRAINT events_required_role_id_check CHECK (required_role_id IS NULL OR required_role_id ~ '^[0-9]+$'::text);

GRANT SELECT ON public.events TO authenticated;

GRANT ALL ON public.events TO service_role;

CREATE INDEX events_guild_created_at_idx ON public.events (guild_id, created_at DESC);

CREATE UNIQUE INDEX events_guild_name_key_idx ON public.events (guild_id, name_key);

CREATE TRIGGER set_signup_event_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_signup_event_updated_at();

CREATE TRIGGER sync_event_signup_event_name
  AFTER UPDATE OF name ON public.events
  FOR EACH ROW
  WHEN (old.name IS DISTINCT FROM new.name)
  EXECUTE FUNCTION public.sync_event_signup_event_name();

CREATE TABLE public.gpi_hidden_players (
  discord_user_id    text                     NOT NULL,
  hidden_at          timestamp with time zone DEFAULT now() NOT NULL,
  hidden_by_user_id  uuid,
  hidden_by_username text
);

ALTER TABLE public.gpi_hidden_players
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gpi_hidden_players
  ADD CONSTRAINT gpi_hidden_players_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.gpi_hidden_players
  ADD CONSTRAINT gpi_hidden_players_hidden_by_user_id_fkey FOREIGN KEY (hidden_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.gpi_hidden_players
  ADD CONSTRAINT gpi_hidden_players_pkey PRIMARY KEY (discord_user_id);

GRANT ALL ON public.gpi_hidden_players TO anon;

GRANT ALL ON public.gpi_hidden_players TO authenticated;

GRANT ALL ON public.gpi_hidden_players TO service_role;

CREATE POLICY "gpi hidden players are publicly readable" ON public.gpi_hidden_players
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.internal_ranked_elo_match_results (
  run_id          bigint                   NOT NULL,
  match_hash      text                     NOT NULL,
  season          integer                  NOT NULL,
  timestamp_ms    bigint                   NOT NULL,
  played_at       timestamp with time zone NOT NULL,
  discord_user_id text                     NOT NULL,
  display_name    text,
  place           integer                  NOT NULL,
  rating_before   numeric(12,4)            NOT NULL,
  rating_delta    numeric(12,4)            NOT NULL,
  rating_after    numeric(12,4)            NOT NULL,
  pairwise_wins   integer                  DEFAULT 0 NOT NULL,
  pairwise_losses integer                  DEFAULT 0 NOT NULL,
  pairwise_ties   integer                  DEFAULT 0 NOT NULL
);

ALTER TABLE public.internal_ranked_elo_match_results
  ADD CONSTRAINT internal_ranked_elo_match_results_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.internal_ranked_elo_match_results
  ADD CONSTRAINT internal_ranked_elo_match_results_pkey PRIMARY KEY (run_id, match_hash, discord_user_id);

GRANT SELECT ON public.internal_ranked_elo_match_results TO anon;

GRANT SELECT ON public.internal_ranked_elo_match_results TO authenticated;

GRANT ALL ON public.internal_ranked_elo_match_results TO service_role;

CREATE INDEX internal_ranked_elo_match_results_match_idx ON public.internal_ranked_elo_match_results (run_id, played_at, match_hash);

CREATE INDEX internal_ranked_elo_match_results_player_idx ON public.internal_ranked_elo_match_results (run_id, discord_user_id, played_at);

CREATE TABLE public.internal_ranked_elo_ratings (
  run_id                 bigint                   NOT NULL,
  discord_user_id        text                     NOT NULL,
  display_name           text,
  rating                 numeric(12,4)            NOT NULL,
  matches_played         integer                  DEFAULT 0 NOT NULL,
  pairwise_wins          integer                  DEFAULT 0 NOT NULL,
  pairwise_losses        integer                  DEFAULT 0 NOT NULL,
  pairwise_ties          integer                  DEFAULT 0 NOT NULL,
  pairwise_games         integer                  DEFAULT 0 NOT NULL,
  first_played_at        timestamp with time zone,
  last_played_at         timestamp with time zone,
  rank                   integer,
  first_place_finishes   integer                  DEFAULT 0 NOT NULL,
  outcome_win_percentage numeric(10,6)            DEFAULT 0 NOT NULL,
  match_win_percentage   numeric(10,6)            DEFAULT 0 NOT NULL
);

ALTER TABLE public.internal_ranked_elo_ratings
  ADD CONSTRAINT internal_ranked_elo_ratings_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.internal_ranked_elo_ratings
  ADD CONSTRAINT internal_ranked_elo_ratings_pkey PRIMARY KEY (run_id, discord_user_id);

GRANT SELECT ON public.internal_ranked_elo_ratings TO anon;

GRANT SELECT ON public.internal_ranked_elo_ratings TO authenticated;

GRANT ALL ON public.internal_ranked_elo_ratings TO service_role;

CREATE INDEX internal_ranked_elo_ratings_run_outcome_win_pct_idx ON public.internal_ranked_elo_ratings (run_id, outcome_win_percentage DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_elo_ratings_run_match_win_pct_idx ON public.internal_ranked_elo_ratings (run_id, match_win_percentage DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_elo_ratings_run_wins_idx ON public.internal_ranked_elo_ratings (run_id, pairwise_wins DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_elo_ratings_run_matches_idx ON public.internal_ranked_elo_ratings (run_id, matches_played DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_elo_ratings_run_rank_idx ON public.internal_ranked_elo_ratings (run_id, rank, discord_user_id);

CREATE INDEX internal_ranked_elo_ratings_run_rating_idx ON public.internal_ranked_elo_ratings (run_id, rating DESC, discord_user_id);

CREATE TABLE public.internal_ranked_elo_runs (
  id                  bigint                   DEFAULT nextval('public.internal_ranked_elo_runs_id_seq'::regclass) NOT NULL,
  calculation_version text                     NOT NULL,
  base_rating         numeric(12,4)            NOT NULL,
  k_factor            numeric(12,4)            NOT NULL,
  season_start        integer                  NOT NULL,
  season_end          integer                  NOT NULL,
  match_count         integer                  DEFAULT 0 NOT NULL,
  player_count        integer                  DEFAULT 0 NOT NULL,
  config              jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at          timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE public.internal_ranked_elo_runs_id_seq OWNED BY public.internal_ranked_elo_runs.id;

GRANT ALL ON SEQUENCE public.internal_ranked_elo_runs_id_seq TO anon;

GRANT ALL ON SEQUENCE public.internal_ranked_elo_runs_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.internal_ranked_elo_runs_id_seq TO service_role;

ALTER TABLE public.internal_ranked_elo_runs
  ADD CONSTRAINT internal_ranked_elo_runs_pkey PRIMARY KEY (id);

ALTER TABLE public.internal_ranked_elo_match_results
  ADD CONSTRAINT internal_ranked_elo_match_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.internal_ranked_elo_runs(id) ON DELETE CASCADE;

ALTER TABLE public.internal_ranked_elo_ratings
  ADD CONSTRAINT internal_ranked_elo_ratings_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.internal_ranked_elo_runs(id) ON DELETE CASCADE;

GRANT SELECT ON public.internal_ranked_elo_runs TO anon;

GRANT SELECT ON public.internal_ranked_elo_runs TO authenticated;

GRANT ALL ON public.internal_ranked_elo_runs TO service_role;

CREATE INDEX internal_ranked_elo_runs_created_at_idx ON public.internal_ranked_elo_runs (created_at DESC);

CREATE TABLE public.internal_ranked_gpi_match_results (
  run_id             bigint                   NOT NULL,
  match_hash         text                     NOT NULL,
  season             integer                  NOT NULL,
  timestamp_ms       bigint                   NOT NULL,
  played_at          timestamp with time zone NOT NULL,
  discord_user_id    text                     NOT NULL,
  display_name       text,
  place              integer                  NOT NULL,
  player_count       integer                  NOT NULL,
  participant_weight numeric(10,6)            DEFAULT 1 NOT NULL,
  normalized_score   numeric(10,6)            NOT NULL,
  expected_score     numeric(10,6)            NOT NULL,
  rating_before      numeric(12,4)            NOT NULL,
  rating_delta       numeric(12,4)            NOT NULL,
  rating_after       numeric(12,4)            NOT NULL,
  pairwise_wins      integer                  DEFAULT 0 NOT NULL,
  pairwise_losses    integer                  DEFAULT 0 NOT NULL,
  pairwise_ties      integer                  DEFAULT 0 NOT NULL
);

ALTER TABLE public.internal_ranked_gpi_match_results
  ADD CONSTRAINT internal_ranked_gpi_match_results_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.internal_ranked_gpi_match_results
  ADD CONSTRAINT internal_ranked_gpi_match_results_pkey PRIMARY KEY (run_id, match_hash, discord_user_id);

GRANT SELECT ON public.internal_ranked_gpi_match_results TO anon;

GRANT SELECT ON public.internal_ranked_gpi_match_results TO authenticated;

GRANT ALL ON public.internal_ranked_gpi_match_results TO service_role;

CREATE INDEX internal_ranked_gpi_match_results_match_idx ON public.internal_ranked_gpi_match_results (run_id, played_at, match_hash);

CREATE INDEX internal_ranked_gpi_match_results_player_idx ON public.internal_ranked_gpi_match_results (run_id, discord_user_id, played_at);

CREATE TABLE public.internal_ranked_gpi_ratings (
  run_id                     bigint                   NOT NULL,
  discord_user_id            text                     NOT NULL,
  display_name               text,
  rating                     numeric(12,4)            NOT NULL,
  raw_rating                 numeric(12,4)            NOT NULL,
  ability                    numeric(18,8)            NOT NULL,
  skill_log                  numeric(18,8)            NOT NULL,
  reliability                numeric(10,6)            DEFAULT 0 NOT NULL,
  matches_played             integer                  DEFAULT 0 NOT NULL,
  weighted_matches           numeric(14,8)            DEFAULT 0 NOT NULL,
  average_match_weight       numeric(10,6)            DEFAULT 0 NOT NULL,
  pairwise_wins              integer                  DEFAULT 0 NOT NULL,
  pairwise_losses            integer                  DEFAULT 0 NOT NULL,
  pairwise_ties              integer                  DEFAULT 0 NOT NULL,
  pairwise_games             integer                  DEFAULT 0 NOT NULL,
  first_place_finishes       integer                  DEFAULT 0 NOT NULL,
  outcome_win_percentage     numeric(10,6)            DEFAULT 0 NOT NULL,
  match_win_percentage       numeric(10,6)            DEFAULT 0 NOT NULL,
  placement_score_average    numeric(10,6)            DEFAULT 0 NOT NULL,
  weighted_placement_score   numeric(10,6)            DEFAULT 0 NOT NULL,
  first_played_at            timestamp with time zone,
  last_played_at             timestamp with time zone,
  rank                       integer,
  predictive_rating          numeric(12,4),
  performance_rating         numeric(12,4),
  resume_rating              numeric(12,4),
  expected_placement_score   numeric(10,6),
  performance_above_expected numeric(10,6),
  schedule_strength          numeric(12,4),
  resume_score               numeric(10,6),
  full_history_rating        numeric(12,4),
  potential_rating           numeric(12,4),
  recent_form_rating         numeric(12,4)
);

ALTER TABLE public.internal_ranked_gpi_ratings
  ADD CONSTRAINT internal_ranked_gpi_ratings_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.internal_ranked_gpi_ratings
  ADD CONSTRAINT internal_ranked_gpi_ratings_pkey PRIMARY KEY (run_id, discord_user_id);

GRANT SELECT ON public.internal_ranked_gpi_ratings TO anon;

GRANT SELECT ON public.internal_ranked_gpi_ratings TO authenticated;

GRANT ALL ON public.internal_ranked_gpi_ratings TO service_role;

CREATE INDEX internal_ranked_gpi_ratings_run_outcome_win_pct_idx ON public.internal_ranked_gpi_ratings (run_id, outcome_win_percentage DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_matches_idx ON public.internal_ranked_gpi_ratings (run_id, matches_played DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_rank_idx ON public.internal_ranked_gpi_ratings (run_id, rank, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_rating_idx ON public.internal_ranked_gpi_ratings (run_id, rating DESC, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_reliability_idx ON public.internal_ranked_gpi_ratings (run_id, reliability DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_weighted_placement_idx ON public.internal_ranked_gpi_ratings (run_id, weighted_placement_score DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_wins_idx ON public.internal_ranked_gpi_ratings (run_id, pairwise_wins DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_weighted_matches_idx ON public.internal_ranked_gpi_ratings (run_id, weighted_matches DESC, rank, discord_user_id);

CREATE INDEX internal_ranked_gpi_ratings_run_match_win_pct_idx ON public.internal_ranked_gpi_ratings (run_id, match_win_percentage DESC, rank, discord_user_id);

CREATE TABLE public.internal_ranked_gpi_runs (
  id                  bigint                   DEFAULT nextval('public.internal_ranked_gpi_runs_id_seq'::regclass) NOT NULL,
  calculation_version text                     NOT NULL,
  model               text                     NOT NULL,
  base_rating         numeric(12,4)            NOT NULL,
  rating_scale        numeric(12,6),
  season_start        integer                  NOT NULL,
  season_end          integer                  NOT NULL,
  match_count         integer                  DEFAULT 0 NOT NULL,
  player_count        integer                  DEFAULT 0 NOT NULL,
  latest_match_at     timestamp with time zone,
  config              jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at          timestamp with time zone DEFAULT now() NOT NULL,
  k_factor            numeric(12,4)
);

ALTER SEQUENCE public.internal_ranked_gpi_runs_id_seq OWNED BY public.internal_ranked_gpi_runs.id;

GRANT ALL ON SEQUENCE public.internal_ranked_gpi_runs_id_seq TO anon;

GRANT ALL ON SEQUENCE public.internal_ranked_gpi_runs_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.internal_ranked_gpi_runs_id_seq TO service_role;

ALTER TABLE public.internal_ranked_gpi_runs
  ADD CONSTRAINT internal_ranked_gpi_runs_pkey PRIMARY KEY (id);

ALTER TABLE public.internal_ranked_gpi_match_results
  ADD CONSTRAINT internal_ranked_gpi_match_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.internal_ranked_gpi_runs(id) ON DELETE CASCADE;

ALTER TABLE public.internal_ranked_gpi_ratings
  ADD CONSTRAINT internal_ranked_gpi_ratings_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.internal_ranked_gpi_runs(id) ON DELETE CASCADE;

GRANT SELECT ON public.internal_ranked_gpi_runs TO anon;

GRANT SELECT ON public.internal_ranked_gpi_runs TO authenticated;

GRANT ALL ON public.internal_ranked_gpi_runs TO service_role;

CREATE INDEX internal_ranked_gpi_runs_created_at_idx ON public.internal_ranked_gpi_runs (created_at DESC);

CREATE TABLE public.internal_ranked_matches (
  match_hash       text                     NOT NULL,
  season           integer                  NOT NULL,
  leaderboard      text                     NOT NULL,
  timestamp_ms     bigint                   NOT NULL,
  played_at        timestamp with time zone NOT NULL,
  versus           text                     NOT NULL,
  team_sizes       integer[]                DEFAULT '{}'::integer[] NOT NULL,
  result_signature text                     NOT NULL,
  raw_match        jsonb                    NOT NULL,
  imported_at      timestamp with time zone DEFAULT now() NOT NULL,
  updated_at       timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.internal_ranked_matches
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.internal_ranked_matches
  ADD CONSTRAINT internal_ranked_matches_pkey PRIMARY KEY (match_hash);

ALTER TABLE public.internal_ranked_elo_match_results
  ADD CONSTRAINT internal_ranked_elo_match_results_match_hash_fkey FOREIGN KEY (match_hash) REFERENCES public.internal_ranked_matches(match_hash) ON DELETE CASCADE;

ALTER TABLE public.internal_ranked_gpi_match_results
  ADD CONSTRAINT internal_ranked_gpi_match_results_match_hash_fkey FOREIGN KEY (match_hash) REFERENCES public.internal_ranked_matches(match_hash) ON DELETE CASCADE;

ALTER TABLE public.internal_ranked_matches
  ADD CONSTRAINT internal_ranked_matches_season_check CHECK (season >= 1);

ALTER TABLE public.internal_ranked_matches
  ADD CONSTRAINT internal_ranked_matches_timestamp_ms_check CHECK (timestamp_ms > 0);

GRANT ALL ON public.internal_ranked_matches TO service_role;

CREATE INDEX internal_ranked_matches_played_at_idx ON public.internal_ranked_matches (played_at, match_hash);

CREATE INDEX internal_ranked_matches_season_played_at_idx ON public.internal_ranked_matches (season, played_at);

CREATE INDEX internal_ranked_matches_result_signature_idx ON public.internal_ranked_matches (season, result_signature);

CREATE TRIGGER set_internal_ranked_matches_updated_at
  BEFORE UPDATE ON public.internal_ranked_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_internal_ranked_matches_updated_at();

CREATE TABLE public.internal_tournament_gpi_ratings (
  run_id                   bigint                   NOT NULL,
  discord_user_id          text                     NOT NULL,
  display_name             text,
  rating                   numeric(12,4)            NOT NULL,
  raw_rating               numeric(12,4)            NOT NULL,
  ability                  numeric(18,8)            NOT NULL,
  skill_log                numeric(18,8)            NOT NULL,
  reliability              numeric(10,6)            DEFAULT 0 NOT NULL,
  matches_played           integer                  DEFAULT 0 NOT NULL,
  weighted_matches         numeric(14,8)            DEFAULT 0 NOT NULL,
  average_match_weight     numeric(10,6)            DEFAULT 0 NOT NULL,
  pairwise_wins            integer                  DEFAULT 0 NOT NULL,
  pairwise_losses          integer                  DEFAULT 0 NOT NULL,
  pairwise_ties            integer                  DEFAULT 0 NOT NULL,
  pairwise_games           integer                  DEFAULT 0 NOT NULL,
  first_place_finishes     integer                  DEFAULT 0 NOT NULL,
  outcome_win_percentage   numeric(10,6)            DEFAULT 0 NOT NULL,
  match_win_percentage     numeric(10,6)            DEFAULT 0 NOT NULL,
  placement_score_average  numeric(10,6)            DEFAULT 0 NOT NULL,
  weighted_placement_score numeric(10,6)            DEFAULT 0 NOT NULL,
  first_played_at          timestamp with time zone,
  last_played_at           timestamp with time zone,
  rank                     integer
);

ALTER TABLE public.internal_tournament_gpi_ratings
  ADD CONSTRAINT internal_tournament_gpi_ratings_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.internal_tournament_gpi_ratings
  ADD CONSTRAINT internal_tournament_gpi_ratings_pkey PRIMARY KEY (run_id, discord_user_id);

GRANT ALL ON public.internal_tournament_gpi_ratings TO anon;

GRANT ALL ON public.internal_tournament_gpi_ratings TO authenticated;

GRANT ALL ON public.internal_tournament_gpi_ratings TO service_role;

CREATE INDEX internal_tournament_gpi_ratings_run_matches_idx ON public.internal_tournament_gpi_ratings (run_id, matches_played DESC, rank, discord_user_id);

CREATE INDEX internal_tournament_gpi_ratings_run_rating_idx ON public.internal_tournament_gpi_ratings (run_id, rating DESC, discord_user_id);

CREATE INDEX internal_tournament_gpi_ratings_run_rank_idx ON public.internal_tournament_gpi_ratings (run_id, rank, discord_user_id);

CREATE TABLE public.internal_tournament_gpi_runs (
  id                  bigint                   DEFAULT nextval('public.internal_tournament_gpi_runs_id_seq'::regclass) NOT NULL,
  calculation_version text                     NOT NULL,
  model               text                     NOT NULL,
  base_rating         numeric(12,4)            NOT NULL,
  rating_scale        numeric(12,6),
  event_start         text                     NOT NULL,
  event_end           text                     NOT NULL,
  match_count         integer                  DEFAULT 0 NOT NULL,
  player_count        integer                  DEFAULT 0 NOT NULL,
  latest_match_at     timestamp with time zone,
  config              jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at          timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE public.internal_tournament_gpi_runs_id_seq OWNED BY public.internal_tournament_gpi_runs.id;

GRANT ALL ON SEQUENCE public.internal_tournament_gpi_runs_id_seq TO anon;

GRANT ALL ON SEQUENCE public.internal_tournament_gpi_runs_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.internal_tournament_gpi_runs_id_seq TO service_role;

ALTER TABLE public.internal_tournament_gpi_runs
  ADD CONSTRAINT internal_tournament_gpi_runs_pkey PRIMARY KEY (id);

ALTER TABLE public.internal_tournament_gpi_ratings
  ADD CONSTRAINT internal_tournament_gpi_ratings_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.internal_tournament_gpi_runs(id) ON DELETE CASCADE;

GRANT ALL ON public.internal_tournament_gpi_runs TO anon;

GRANT ALL ON public.internal_tournament_gpi_runs TO authenticated;

GRANT ALL ON public.internal_tournament_gpi_runs TO service_role;

CREATE INDEX internal_tournament_gpi_runs_created_at_idx ON public.internal_tournament_gpi_runs (created_at DESC);

CREATE TABLE public.internal_tournament_matches (
  match_hash               text                     NOT NULL,
  event_key                text                     NOT NULL,
  event_name               text                     NOT NULL,
  event_order              integer                  NOT NULL,
  match_order              integer                  NOT NULL,
  source_match_id          text                     NOT NULL,
  round_label              text,
  timestamp_ms             bigint                   NOT NULL,
  played_at                timestamp with time zone NOT NULL,
  player_a_discord_user_id text                     NOT NULL,
  player_a_name            text                     NOT NULL,
  player_a_score           text,
  player_b_discord_user_id text                     NOT NULL,
  player_b_name            text                     NOT NULL,
  player_b_score           text,
  winner_discord_user_id   text                     NOT NULL,
  raw_match                jsonb                    NOT NULL,
  raw_source               jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  imported_at              timestamp with time zone DEFAULT now() NOT NULL,
  updated_at               timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_event_key_check CHECK (length(TRIM(BOTH FROM event_key)) > 0);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_event_key_source_match_id_key UNIQUE (event_key, source_match_id);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_event_name_check CHECK (length(TRIM(BOTH FROM event_name)) > 0);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_event_order_check CHECK (event_order > 0);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_match_order_check CHECK (match_order > 0);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_pkey PRIMARY KEY (match_hash);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_player_a_discord_user_id_check CHECK (player_a_discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_player_b_discord_user_id_check CHECK (player_b_discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_timestamp_ms_check CHECK (timestamp_ms > 0);

ALTER TABLE public.internal_tournament_matches
  ADD CONSTRAINT internal_tournament_matches_winner_discord_user_id_check CHECK (winner_discord_user_id ~ '^[0-9]+$'::text);

GRANT ALL ON public.internal_tournament_matches TO anon;

GRANT ALL ON public.internal_tournament_matches TO authenticated;

GRANT ALL ON public.internal_tournament_matches TO service_role;

CREATE INDEX internal_tournament_matches_player_b_idx ON public.internal_tournament_matches (player_b_discord_user_id, event_order, match_order);

CREATE INDEX internal_tournament_matches_order_idx ON public.internal_tournament_matches (event_order, match_order, match_hash);

CREATE INDEX internal_tournament_matches_player_a_idx ON public.internal_tournament_matches (player_a_discord_user_id, event_order, match_order);

CREATE TABLE public.match_states (
  match_id   bigint                   NOT NULL,
  state      jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);

ALTER TABLE public.match_states
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.match_states
  ADD CONSTRAINT match_states_pkey PRIMARY KEY (match_id);

ALTER TABLE public.match_states
  ADD CONSTRAINT match_states_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

GRANT ALL ON public.match_states TO anon;

GRANT ALL ON public.match_states TO authenticated;

GRANT ALL ON public.match_states TO service_role;

CREATE TRIGGER set_match_states_updated_at
  BEFORE UPDATE ON public.match_states
  FOR EACH ROW
  EXECUTE FUNCTION public.set_match_states_updated_at();

CREATE POLICY "authenticated users can create match states" ON public.match_states
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated users can update match states" ON public.match_states
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "match states are viewable" ON public.match_states
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.player_custom_urls (
  user_id              uuid                     NOT NULL,
  discord_user_id      text                     NOT NULL,
  slug                 text                     NOT NULL,
  status               text                     DEFAULT 'pending'::text NOT NULL,
  requested_at         timestamp with time zone DEFAULT now() NOT NULL,
  approved_at          timestamp with time zone,
  approved_by_user_id  uuid,
  approved_by_username text,
  updated_at           timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.player_custom_urls
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_approved_metadata_check CHECK (status = 'pending'::text OR approved_at IS NOT NULL AND approved_by_username IS
    NOT NULL AND length(TRIM(BOTH FROM approved_by_username)) > 0);

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_discord_user_id_key UNIQUE (discord_user_id);

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_pending_approval_check CHECK (status = 'approved'::text OR approved_at IS NULL AND approved_by_user_id IS NULL AND approved_by_username IS NULL);

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_pkey PRIMARY KEY (user_id);

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_reserved_slug_check
    CHECK
    (slug <> ALL (ARRAY['404'::text, 'admin'::text, 'admin-settings'::text, 'api'::text, 'assets'::text, 'auth'::text, 'beataidan'::text, 'bot'::text, 'championship'::text,
    'css'::text,
    'discord'::text,
    'export'::text,
    'functions'::text,
    'home'::text,
    'index'::text,
    'js'::text,
    'lightningcup'::text,
    'logos'::text,
    'masters'::text,
    'match'::text,
    'node_modules'::text,
    'noptational'::text,
    'noptational-tabs'::text,
    'package'::text,
    'player'::text,
    'player-profile'::text,
    'player-settings'::text,
    'players'::text,
    'privacy'::text,
    'proleague'::text,
    'ranked-league-config'::text,
    'records'::text, 'settings'::text, 'settings-data'::text, 'settings-page'::text, 'site-topbar'::text, 'superleague'::text, 'terms'::text, 'worldcup'::text, 'worldopen'::text]));

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_slug_format_check CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$'::text);

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_slug_key UNIQUE (slug);

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text]));

ALTER TABLE public.player_custom_urls
  ADD CONSTRAINT player_custom_urls_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.player_custom_urls TO anon;

GRANT ALL ON public.player_custom_urls TO authenticated;

GRANT ALL ON public.player_custom_urls TO service_role;

CREATE INDEX player_custom_urls_status_idx ON public.player_custom_urls (status, requested_at);

CREATE INDEX player_custom_urls_discord_user_idx ON public.player_custom_urls (discord_user_id);

CREATE TRIGGER set_player_custom_urls_updated_at
  BEFORE UPDATE ON public.player_custom_urls
  FOR EACH ROW
  EXECUTE FUNCTION public.set_player_settings_updated_at();

CREATE POLICY "approved player urls are publicly readable" ON public.player_custom_urls
  FOR SELECT
  TO anon, authenticated
  USING ((status = 'approved'::text));

CREATE POLICY "players can delete pending url claims" ON public.player_custom_urls
  FOR DELETE
  TO authenticated
  USING (((auth.uid() = user_id) AND (status = 'pending'::text)));

CREATE POLICY "players can view their own url claims" ON public.player_custom_urls
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE TABLE public.player_global_rank_moderation (
  discord_user_id    text                     NOT NULL,
  rank_key           text                     NOT NULL,
  hidden_at          timestamp with time zone DEFAULT now() NOT NULL,
  hidden_by_user_id  uuid,
  hidden_by_username text
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.event_signups, TABLE public.match_states, TABLE public.player_global_rank_moderation;

ALTER TABLE public.player_global_rank_moderation
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_global_rank_moderation
  ADD CONSTRAINT player_global_rank_moderation_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.player_global_rank_moderation
  ADD CONSTRAINT player_global_rank_moderation_hidden_by_user_id_fkey FOREIGN KEY (hidden_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.player_global_rank_moderation
  ADD CONSTRAINT player_global_rank_moderation_pkey PRIMARY KEY (discord_user_id, rank_key);

ALTER TABLE public.player_global_rank_moderation
  ADD CONSTRAINT player_global_rank_moderation_rank_key_check CHECK (rank_key = ANY (ARRAY['current_global_rank'::text, 'max_global_rank_no_cs'::text, 'max_global_rank_cs'::text]));

GRANT ALL ON public.player_global_rank_moderation TO anon;

GRANT ALL ON public.player_global_rank_moderation TO authenticated;

GRANT ALL ON public.player_global_rank_moderation TO service_role;

CREATE INDEX player_global_rank_moderation_rank_key_idx ON public.player_global_rank_moderation (rank_key);

CREATE POLICY "global rank moderation is publicly readable" ON public.player_global_rank_moderation
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.player_league_aliases (
  league_key         text                     NOT NULL,
  league_player_name text                     NOT NULL,
  league_player_key  text                     GENERATED ALWAYS AS (public.normalize_player_alias_key(league_player_name)) STORED NOT NULL,
  guild_id           text                     NOT NULL,
  discord_user_id    text,
  active             boolean                  DEFAULT true NOT NULL,
  source             text                     DEFAULT 'manual'::text NOT NULL,
  notes              text,
  created_at         timestamp with time zone DEFAULT now() NOT NULL,
  updated_at         timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.player_league_aliases
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_league_aliases
  ADD CONSTRAINT player_league_aliases_active_discord_user_id_check CHECK (active = false OR discord_user_id IS NOT NULL);

ALTER TABLE public.player_league_aliases
  ADD CONSTRAINT player_league_aliases_discord_user_id_format_check CHECK (discord_user_id IS NULL OR discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.player_league_aliases
  ADD CONSTRAINT player_league_aliases_guild_id_check CHECK (guild_id ~ '^[0-9]+$'::text);

ALTER TABLE public.player_league_aliases
  ADD CONSTRAINT player_league_aliases_guild_id_discord_user_id_fkey FOREIGN KEY (guild_id, discord_user_id) REFERENCES public.discord_guild_members(guild_id, discord_user_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.player_league_aliases
  ADD CONSTRAINT player_league_aliases_league_key_check CHECK (league_key ~ '^[a-z0-9_]+$'::text);

ALTER TABLE public.player_league_aliases
  ADD CONSTRAINT player_league_aliases_league_player_name_check CHECK (length(TRIM(BOTH FROM league_player_name)) > 0);

ALTER TABLE public.player_league_aliases
  ADD CONSTRAINT player_league_aliases_pkey PRIMARY KEY (league_key, league_player_key);

GRANT ALL ON public.player_league_aliases TO anon;

GRANT ALL ON public.player_league_aliases TO authenticated;

GRANT ALL ON public.player_league_aliases TO service_role;

CREATE INDEX player_league_aliases_discord_user_idx ON public.player_league_aliases (guild_id, discord_user_id)
  WHERE active;

CREATE INDEX player_league_aliases_league_name_idx ON public.player_league_aliases (league_key, league_player_name);

CREATE TRIGGER set_player_league_aliases_updated_at
  BEFORE UPDATE ON public.player_league_aliases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_player_league_aliases_updated_at();

CREATE POLICY "player league aliases are publicly readable" ON public.player_league_aliases
  FOR SELECT
  TO anon, authenticated
  USING ((active = true));

CREATE TABLE public.player_settings (
  user_id               uuid,
  discord_user_id       text                     NOT NULL,
  country_1             text,
  country_2             text,
  time_zone             text,
  current_global_rank   text,
  max_global_rank_no_cs text,
  max_global_rank_cs    text,
  created_at            timestamp with time zone DEFAULT now() NOT NULL,
  updated_at            timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.player_settings
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_country_1_check CHECK (country_1 IS NULL OR country_1 ~ '^[A-Z]{2}$'::text);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_country_2_check CHECK (country_2 IS NULL OR country_2 ~ '^[A-Z]{2}$'::text);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_current_global_rank_check
    CHECK
    (current_global_rank IS NULL OR (current_global_rank = ANY (ARRAY['<A20'::text, 'A21'::text, 'A22'::text, 'A23'::text, 'A24'::text, 'A25'::text, 'A26'::text, 'A27'::text,
    'A28'::text,
    'A29'::text,
    'S0'::text,
    'S1'::text, 'S2'::text, 'S3'::text, 'S4'::text, 'S5'::text, 'S6'::text, 'S7'::text, 'S8'::text, 'S9'::text])) OR current_global_rank ~ '^∞([0-9]|[1-4][0-9])$'::text);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_discord_user_id_check CHECK (discord_user_id ~ '^[0-9]+$'::text);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_distinct_countries_check CHECK (country_1 IS NULL OR country_2 IS NULL OR country_1 <> country_2);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_max_global_rank_cs_check
    CHECK
    (max_global_rank_cs IS NULL OR (max_global_rank_cs = ANY (ARRAY['<A20'::text, 'A21'::text, 'A22'::text, 'A23'::text, 'A24'::text, 'A25'::text, 'A26'::text, 'A27'::text,
    'A28'::text,
    'A29'::text,
    'S0'::text, 'S1'::text, 'S2'::text, 'S3'::text, 'S4'::text, 'S5'::text, 'S6'::text, 'S7'::text, 'S8'::text, 'S9'::text])) OR max_global_rank_cs ~ '^∞([0-9]|[1-4][0-9])$'::text);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_max_global_rank_no_cs_check
    CHECK
    (max_global_rank_no_cs IS NULL OR (max_global_rank_no_cs = ANY (ARRAY['<A20'::text, 'A21'::text, 'A22'::text, 'A23'::text, 'A24'::text, 'A25'::text, 'A26'::text, 'A27'::text,
    'A28'::text,
    'A29'::text,
    'S0'::text, 'S1'::text, 'S2'::text, 'S3'::text, 'S4'::text, 'S5'::text, 'S6'::text, 'S7'::text, 'S8'::text, 'S9'::text])) OR max_global_rank_no_cs ~ '^∞([0-9]|1[0-5])$'::text);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_pkey PRIMARY KEY (discord_user_id);

ALTER TABLE public.player_settings
  ADD CONSTRAINT player_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.player_settings TO anon;

GRANT ALL ON public.player_settings TO authenticated;

GRANT ALL ON public.player_settings TO service_role;

CREATE UNIQUE INDEX player_settings_user_id_unique_idx ON public.player_settings (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX player_settings_discord_user_idx ON public.player_settings (discord_user_id);

CREATE TRIGGER set_player_settings_updated_at
  BEFORE UPDATE ON public.player_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_player_settings_updated_at();

CREATE POLICY "player settings are publicly readable" ON public.player_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.profiles (
  user_id         uuid                     NOT NULL,
  username        public.citext,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  updated_at      timestamp with time zone DEFAULT now() NOT NULL,
  discord_user_id text,
  full_name       text
);

CREATE POLICY "admins can create championship settings" ON public.championship_point_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (((id = 'current'::text) AND ((updated_by_user_id IS NULL) OR (updated_by_user_id = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text))))));

CREATE POLICY "admins can update championship settings" ON public.championship_point_settings
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text)))))
  WITH CHECK (((id = 'current'::text) AND ((updated_by_user_id IS NULL) OR (updated_by_user_id = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text))))));

CREATE POLICY "discord users can view event blocked roles" ON public.event_blocked_roles
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.discord_user_id IS NOT NULL)))));

CREATE POLICY "discord users can view event required roles" ON public.event_required_roles
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.discord_user_id IS NOT NULL)))));

CREATE POLICY "discord users can create their own event signups" ON public.event_signups
  FOR INSERT
  TO authenticated
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.discord_user_id = event_signups.discord_user_id)))) AND (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_signups.event_id) AND (e.guild_id = event_signups.guild_id) AND ((e.deadline_at IS NULL) OR (now() < e.deadline_at)) AND (((EXISTS ( SELECT 1
           FROM public.event_required_roles rr
          WHERE (rr.event_id = e.id))) AND (NOT (EXISTS ( SELECT 1
           FROM public.event_required_roles rr
          WHERE ((rr.event_id = e.id) AND (NOT (EXISTS ( SELECT 1
                   FROM public.discord_member_roles r
                  WHERE ((r.guild_id = rr.guild_id) AND (r.role_id = rr.role_id) AND (r.discord_user_id = event_signups.discord_user_id)))))))))) OR ((NOT (EXISTS ( SELECT 1
           FROM public.event_required_roles rr
          WHERE (rr.event_id = e.id)))) AND ((e.required_role_id IS NULL) OR (EXISTS ( SELECT 1
           FROM public.discord_member_roles r
          WHERE ((r.guild_id = e.guild_id) AND (r.discord_user_id = event_signups.discord_user_id) AND (r.role_id = e.required_role_id))))))) AND (NOT (EXISTS ( SELECT 1
           FROM (public.event_blocked_roles b
             JOIN public.discord_member_roles r ON (((r.guild_id = b.guild_id) AND (r.role_id = b.role_id) AND (r.discord_user_id = event_signups.discord_user_id))))
          WHERE (b.event_id = event_signups.event_id)))))))));

CREATE POLICY "discord users can delete their own event signups" ON public.event_signups
  FOR DELETE
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.discord_user_id = event_signups.discord_user_id)))) AND (EXISTS ( SELECT 1
   FROM public.events e
  WHERE ((e.id = event_signups.event_id) AND ((e.deadline_at IS NULL) OR (now() < e.deadline_at)))))));

CREATE POLICY "discord users can view event signups" ON public.event_signups
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.discord_user_id IS NOT NULL)))));

CREATE POLICY "discord users can view signup events" ON public.events
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (p.discord_user_id IS NOT NULL)))));

CREATE POLICY "admins can hide gpi players" ON public.gpi_hidden_players
  FOR INSERT
  TO authenticated
  WITH CHECK ((((hidden_by_user_id IS NULL) OR (hidden_by_user_id = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text))))));

CREATE POLICY "admins can unhide gpi players" ON public.gpi_hidden_players
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text)))));

CREATE POLICY "admins can update gpi hidden players" ON public.gpi_hidden_players
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text)))))
  WITH CHECK ((((hidden_by_user_id IS NULL) OR (hidden_by_user_id = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text))))));

CREATE POLICY "admins can revoke player url claims" ON public.player_custom_urls
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = auth.uid()) AND (r.role_id = '1069007873985740890'::text)))));

CREATE POLICY "admins can update player url claims" ON public.player_custom_urls
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = auth.uid()) AND (r.role_id = '1069007873985740890'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = auth.uid()) AND (r.role_id = '1069007873985740890'::text)))));

CREATE POLICY "admins can view all player url claims" ON public.player_custom_urls
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = auth.uid()) AND (r.role_id = '1069007873985740890'::text)))));

CREATE POLICY "players can create pending url claims" ON public.player_custom_urls
  FOR INSERT
  TO authenticated
  WITH
    CHECK
    (((auth.uid() = user_id) AND (status = 'pending'::text) AND (approved_at IS NULL) AND (approved_by_user_id IS NULL) AND (approved_by_username IS NULL) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.discord_user_id = player_custom_urls.discord_user_id))))));

CREATE POLICY "players can update their own url claims to pending" ON public.player_custom_urls
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id))
  WITH
    CHECK
    (((auth.uid() = user_id) AND (status = 'pending'::text) AND (approved_at IS NULL) AND (approved_by_user_id IS NULL) AND (approved_by_username IS NULL) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.discord_user_id = player_custom_urls.discord_user_id))))));

CREATE POLICY "admins can create global rank moderation" ON public.player_global_rank_moderation
  FOR INSERT
  TO authenticated
  WITH CHECK ((((hidden_by_user_id IS NULL) OR (hidden_by_user_id = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text))))));

CREATE POLICY "admins can delete global rank moderation" ON public.player_global_rank_moderation
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text)))));

CREATE POLICY "admins can update global rank moderation" ON public.player_global_rank_moderation
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text)))))
  WITH CHECK ((((hidden_by_user_id IS NULL) OR (hidden_by_user_id = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM (public.profiles p
     JOIN public.discord_member_roles r ON ((r.discord_user_id = p.discord_user_id)))
  WHERE ((p.user_id = ( SELECT auth.uid() AS uid)) AND (r.role_id = '1069007873985740890'::text))))));

CREATE POLICY "players can insert their own settings" ON public.player_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.discord_user_id = player_settings.discord_user_id))))));

CREATE POLICY "players can update their own settings" ON public.player_settings
  FOR UPDATE
  TO authenticated
  USING ((((user_id IS NULL) OR (auth.uid() = user_id)) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.discord_user_id = player_settings.discord_user_id))))))
  WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.discord_user_id = player_settings.discord_user_id))))));

ALTER TABLE public.profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);

ALTER TABLE public.brackets
  ADD CONSTRAINT brackets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_key UNIQUE (username);

GRANT ALL ON public.profiles TO anon;

GRANT ALL ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY profiles_public_read ON public.profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.ranked (
  season  smallint NOT NULL,
  payload jsonb
);

ALTER TABLE public.ranked
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ranked
  ADD CONSTRAINT ranked_pkey PRIMARY KEY (season);

GRANT ALL ON public.ranked TO anon;

GRANT ALL ON public.ranked TO authenticated;

GRANT ALL ON public.ranked TO service_role;

CREATE POLICY "Public can read ranked" ON public.ranked
  FOR SELECT
  USING (true);

CREATE VIEW public.bracket_leaderboard AS SELECT b.id AS bracket_id,
    b.bracket_name,
    p.user_id,
    p.username,
    COALESCE(sum(bp.points_awarded), (0)::bigint) AS actual_score,
    b.created_at,
    b.updated_at,
    b.submitted_at
   FROM ((public.brackets b
     JOIN public.profiles p ON ((p.user_id = b.user_id)))
     LEFT JOIN public.bracket_picks bp ON ((bp.bracket_id = b.id)))
  GROUP BY b.id, b.bracket_name, p.user_id, p.username, b.created_at, b.updated_at, b.submitted_at;

GRANT ALL ON public.bracket_leaderboard TO anon;

GRANT ALL ON public.bracket_leaderboard TO authenticated;

GRANT ALL ON public.bracket_leaderboard TO service_role;
