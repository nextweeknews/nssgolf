-- Harden every Data API surface after auditing its browser, bot, and Worker use.
-- Browser roles receive only the exact read/write paths used by the site.

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION citext SET SCHEMA extensions;

-- Future objects are private by default. Every browser-facing object below is
-- granted explicitly so a later migration cannot accidentally expose it.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Authorization accepts only member, role, and assignment rows that match the
-- guild's completed role-assignment generation.
CREATE TABLE public.discord_guild_sync_state (
  guild_id text PRIMARY KEY,
  completed_at timestamp with time zone NOT NULL,
  CONSTRAINT discord_guild_sync_state_guild_id_check
    CHECK (guild_id ~ '^[0-9]+$')
);
ALTER TABLE public.discord_guild_sync_state ENABLE ROW LEVEL SECURITY;

WITH role_generations AS (
  SELECT
    role.guild_id,
    min(role.last_scanned_at) AS completed_at
  FROM public.discord_roles AS role
  WHERE role.is_current_role
  GROUP BY role.guild_id
  HAVING min(role.last_scanned_at) = max(role.last_scanned_at)
),
assignment_generations AS (
  SELECT
    member_role.guild_id,
    min(member_role.scanned_at) AS completed_at
  FROM public.discord_member_roles AS member_role
  GROUP BY member_role.guild_id
  HAVING min(member_role.scanned_at) = max(member_role.scanned_at)
)
INSERT INTO public.discord_guild_sync_state (guild_id, completed_at)
SELECT role_generation.guild_id, role_generation.completed_at
FROM role_generations AS role_generation
JOIN assignment_generations AS assignment_generation
  ON assignment_generation.guild_id = role_generation.guild_id
 AND assignment_generation.completed_at = role_generation.completed_at;

-- ---------------------------------------------------------------------------
-- Canonical authenticated Discord identity and live-session checks
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.current_session_actor()
RETURNS TABLE (
  actor_user_id uuid,
  actor_discord_user_id text,
  actor_username text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    identity.user_id,
    identity.provider_id,
    COALESCE(
      NULLIF(member.display_name, ''),
      NULLIF(member.username, ''),
      NULLIF(identity.identity_data->>'full_name', ''),
      NULLIF(identity.identity_data->>'name', ''),
      identity.provider_id
    )
  FROM auth.identities AS identity
  JOIN auth.sessions AS session
    ON session.user_id = identity.user_id
   AND session.id::text = COALESCE(
     NULLIF(current_setting('request.jwt.claim.session_id', true), ''),
     NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'session_id'
   )
   AND (session.not_after IS NULL OR session.not_after > statement_timestamp())
  LEFT JOIN LATERAL (
    SELECT guild_member.display_name, guild_member.username
    FROM public.discord_guild_members AS guild_member
    WHERE guild_member.discord_user_id = identity.provider_id
    ORDER BY guild_member.is_current_member DESC, guild_member.updated_at DESC
    LIMIT 1
  ) AS member ON true
  WHERE identity.user_id = (SELECT auth.uid())
    AND identity.provider = 'discord'
    AND identity.provider_id ~ '^[0-9]+$'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_session_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT actor.actor_user_id
  FROM private.current_session_actor() AS actor;
$$;

CREATE OR REPLACE FUNCTION private.current_discord_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT actor.actor_discord_user_id
  FROM private.current_session_actor() AS actor;
$$;

CREATE OR REPLACE FUNCTION private.user_is_discord_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM auth.identities AS identity
      JOIN public.discord_member_roles AS member_role
        ON member_role.discord_user_id = identity.provider_id
      JOIN public.discord_guild_sync_state AS sync_state
        ON sync_state.guild_id = member_role.guild_id
       AND sync_state.completed_at = member_role.scanned_at
      JOIN public.discord_guild_members AS guild_member
        ON guild_member.guild_id = member_role.guild_id
       AND guild_member.discord_user_id = member_role.discord_user_id
       AND guild_member.is_current_member
       AND guild_member.last_scanned_at = sync_state.completed_at
      JOIN public.discord_roles AS discord_role
        ON discord_role.guild_id = member_role.guild_id
       AND discord_role.role_id = member_role.role_id
       AND discord_role.is_current_role
       AND discord_role.last_scanned_at = sync_state.completed_at
      WHERE identity.user_id = p_user_id
        AND identity.provider = 'discord'
        AND member_role.role_id = '1069007873985740890'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_tournament_result_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT private.user_is_discord_admin(actor.actor_user_id)
      FROM private.current_session_actor() AS actor
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION private.require_admin_actor()
RETURNS TABLE (
  actor_user_id uuid,
  actor_discord_user_id text,
  actor_username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT actor.*
  FROM private.current_session_actor() AS actor
  WHERE private.user_is_discord_admin(actor.actor_user_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.has_exact_json_keys(
  p_value jsonb,
  p_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) <> 'object' THEN false
    ELSE (
      SELECT count(*) = cardinality(p_keys)
        AND COALESCE(bool_and(key = ANY(p_keys)), false)
      FROM jsonb_object_keys(p_value) AS object_key(key)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION private.is_bounded_point_object(
  p_value jsonb,
  p_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT private.has_exact_json_keys(p_value, p_keys) THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_each(p_value) AS entry(key, value)
      WHERE jsonb_typeof(entry.value) <> 'number'
        OR (entry.value #>> '{}') !~ '^(0|[1-9][0-9]{0,4})$'
        OR CASE
          WHEN (entry.value #>> '{}') ~ '^(0|[1-9][0-9]{0,4})$'
          THEN (entry.value #>> '{}')::integer > 10000
          ELSE false
        END
    )
  END;
$$;

CREATE OR REPLACE FUNCTION private.is_bounded_point_array(
  p_value jsonb,
  p_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(jsonb_typeof(p_value), '') <> 'array' THEN false
    WHEN jsonb_array_length(p_value) <> p_length THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_value) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'number'
        OR (item.value #>> '{}') !~ '^(0|[1-9][0-9]{0,4})$'
        OR CASE
          WHEN (item.value #>> '{}') ~ '^(0|[1-9][0-9]{0,4})$'
          THEN (item.value #>> '{}')::integer > 10000
          ELSE false
        END
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.save_championship_point_values(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
  saved_settings jsonb;
BEGIN
  SELECT * INTO actor FROM private.require_admin_actor();

  IF p_settings IS NULL
    OR octet_length(p_settings::text) > 10000
    OR NOT private.has_exact_json_keys(
      p_settings,
      ARRAY[
        'lightningCup2026',
        'worldCup2025',
        'worldOpen',
        'noptational2026',
        'superLeagueS5',
        'superLeagueS6'
      ]
    )
    OR NOT private.is_bounded_point_object(
      p_settings->'lightningCup2026',
      ARRAY['winner', 'runnerUp', 'semifinalist', 'quarterfinalist', 'roundOf16', 'roundOf32', 'roundOf64']
    )
    OR NOT private.is_bounded_point_object(
      p_settings->'worldCup2025',
      ARRAY['winner', 'runnerUp', 'thirdPlace', 'fourthPlace', 'quarterfinalist', 'roundOf16', 'groupThird', 'groupFourth']
    )
    OR NOT private.is_bounded_point_object(
      p_settings->'worldOpen',
      ARRAY['secondRound', 'roundOf32', 'roundOf16', 'quarterfinalist', 'semifinalist', 'runnerUp', 'winner']
    )
    OR NOT private.has_exact_json_keys(p_settings->'noptational2026', ARRAY['placements'])
    OR NOT private.is_bounded_point_array(p_settings->'noptational2026'->'placements', 44)
    OR NOT private.has_exact_json_keys(
      p_settings->'superLeagueS5',
      ARRAY['division1', 'division2', 'division3']
    )
    OR NOT private.is_bounded_point_array(p_settings->'superLeagueS5'->'division1', 8)
    OR NOT private.is_bounded_point_array(p_settings->'superLeagueS5'->'division2', 8)
    OR NOT private.is_bounded_point_array(p_settings->'superLeagueS5'->'division3', 8)
    OR NOT private.has_exact_json_keys(
      p_settings->'superLeagueS6',
      ARRAY['division1', 'division2', 'division3']
    )
    OR NOT private.is_bounded_point_array(p_settings->'superLeagueS6'->'division1', 8)
    OR NOT private.is_bounded_point_array(p_settings->'superLeagueS6'->'division2', 8)
    OR NOT private.is_bounded_point_array(p_settings->'superLeagueS6'->'division3', 8)
  THEN
    RAISE EXCEPTION 'Championship point settings do not match the supported scoring schema.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.championship_point_settings (
    id,
    settings,
    updated_by_user_id
  ) VALUES (
    'current',
    p_settings,
    actor.actor_user_id
  )
  ON CONFLICT (id) DO UPDATE
  SET
    settings = EXCLUDED.settings,
    updated_by_user_id = actor.actor_user_id
  RETURNING settings INTO saved_settings;

  RETURN saved_settings;
END;
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.current_session_actor() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_session_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_discord_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_is_discord_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_discord_actor()
RETURNS TABLE (
  actor_user_id uuid,
  actor_discord_user_id text,
  actor_username text,
  is_admin boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    actor.actor_user_id,
    actor.actor_discord_user_id,
    actor.actor_username,
    private.user_is_discord_admin(actor.actor_user_id)
  FROM private.current_session_actor() AS actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A live Discord session is required.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_my_profile()
RETURNS TABLE (
  user_id uuid,
  username extensions.citext,
  discord_user_id text,
  full_name text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM private.current_session_actor();
  IF actor.actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A live Discord session is required.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles AS profile (user_id, discord_user_id, full_name)
  VALUES (actor.actor_user_id, actor.actor_discord_user_id, actor.actor_username)
  ON CONFLICT ON CONSTRAINT profiles_pkey DO UPDATE
  SET
    discord_user_id = EXCLUDED.discord_user_id,
    full_name = EXCLUDED.full_name;

  RETURN QUERY
  SELECT profile.user_id, profile.username, profile.discord_user_id, profile.full_name
  FROM public.profiles AS profile
  WHERE profile.user_id = actor.actor_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_discord_actor() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_discord_actor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_profile() TO authenticated;

-- Trigger functions are not API endpoints.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lightning Cup bracket cutoff and visibility
-- ---------------------------------------------------------------------------

CREATE TABLE public.bracket_event_settings (
  year text PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  edit_deadline_at timestamp with time zone NOT NULL,
  picks_public_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT bracket_event_settings_year_check CHECK (year ~ '^[0-9]{4}$'),
  CONSTRAINT bracket_event_settings_event_key_check
    CHECK (event_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

INSERT INTO public.bracket_event_settings (
  year,
  event_key,
  display_name,
  edit_deadline_at,
  picks_public_at
)
VALUES (
  '2026',
  'lightningcup',
  'Lightning Cup 2026',
  '2026-04-10 17:00:00+00',
  '2026-04-10 17:00:00+00'
);

ALTER TABLE public.bracket_event_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bracket_event_settings_public_read
ON public.bracket_event_settings
FOR SELECT
TO anon, authenticated
USING (true);

ALTER TABLE public.brackets ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.bracket_picks ALTER COLUMN year SET NOT NULL;
ALTER TABLE public.brackets
  ADD CONSTRAINT brackets_year_fkey
  FOREIGN KEY (year) REFERENCES public.bracket_event_settings(year);
ALTER TABLE public.bracket_picks
  ADD CONSTRAINT bracket_picks_year_fkey
  FOREIGN KEY (year) REFERENCES public.bracket_event_settings(year);

DROP POLICY IF EXISTS brackets_insert_own ON public.brackets;
DROP POLICY IF EXISTS brackets_update_own ON public.brackets;
CREATE POLICY brackets_insert_own_before_deadline
ON public.brackets
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT private.current_session_user_id())
  AND char_length(btrim(bracket_name)) BETWEEN 1 AND 64
  AND EXISTS (
    SELECT 1
    FROM public.bracket_event_settings AS event
    WHERE event.year = brackets.year
      AND statement_timestamp() < event.edit_deadline_at
  )
);
CREATE POLICY brackets_update_own_before_deadline
ON public.brackets
FOR UPDATE
TO authenticated
USING (
  user_id = (SELECT private.current_session_user_id())
  AND EXISTS (
    SELECT 1
    FROM public.bracket_event_settings AS event
    WHERE event.year = brackets.year
      AND statement_timestamp() < event.edit_deadline_at
  )
)
WITH CHECK (
  user_id = (SELECT private.current_session_user_id())
  AND char_length(btrim(bracket_name)) BETWEEN 1 AND 64
  AND EXISTS (
    SELECT 1
    FROM public.bracket_event_settings AS event
    WHERE event.year = brackets.year
      AND statement_timestamp() < event.edit_deadline_at
  )
);

DROP POLICY IF EXISTS bracket_picks_public_read ON public.bracket_picks;
DROP POLICY IF EXISTS bracket_picks_insert_own ON public.bracket_picks;
DROP POLICY IF EXISTS bracket_picks_update_own ON public.bracket_picks;
CREATE POLICY bracket_picks_anonymous_after_public_read
ON public.bracket_picks
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.brackets AS bracket
    JOIN public.bracket_event_settings AS event ON event.year = bracket.year
    WHERE bracket.id = bracket_picks.bracket_id
      AND bracket.year = bracket_picks.year
      AND statement_timestamp() >= event.picks_public_at
  )
);
CREATE POLICY bracket_picks_authenticated_owner_or_public_read
ON public.bracket_picks
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.brackets AS bracket
    JOIN public.bracket_event_settings AS event ON event.year = bracket.year
    WHERE bracket.id = bracket_picks.bracket_id
      AND bracket.year = bracket_picks.year
      AND (
        statement_timestamp() >= event.picks_public_at
        OR bracket.user_id = (SELECT private.current_session_user_id())
      )
  )
);
CREATE POLICY bracket_picks_insert_own_before_deadline
ON public.bracket_picks
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.brackets AS bracket
    JOIN public.bracket_event_settings AS event ON event.year = bracket.year
    WHERE bracket.id = bracket_picks.bracket_id
      AND bracket.year = bracket_picks.year
      AND bracket.user_id = (SELECT private.current_session_user_id())
      AND statement_timestamp() < event.edit_deadline_at
  )
);
CREATE POLICY bracket_picks_update_own_before_deadline
ON public.bracket_picks
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.brackets AS bracket
    JOIN public.bracket_event_settings AS event ON event.year = bracket.year
    WHERE bracket.id = bracket_picks.bracket_id
      AND bracket.year = bracket_picks.year
      AND bracket.user_id = (SELECT private.current_session_user_id())
      AND statement_timestamp() < event.edit_deadline_at
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.brackets AS bracket
    JOIN public.bracket_event_settings AS event ON event.year = bracket.year
    WHERE bracket.id = bracket_picks.bracket_id
      AND bracket.year = bracket_picks.year
      AND bracket.user_id = (SELECT private.current_session_user_id())
      AND statement_timestamp() < event.edit_deadline_at
  )
);
CREATE POLICY bracket_picks_delete_own_before_deadline
ON public.bracket_picks
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.brackets AS bracket
    JOIN public.bracket_event_settings AS event ON event.year = bracket.year
    WHERE bracket.id = bracket_picks.bracket_id
      AND bracket.year = bracket_picks.year
      AND bracket.user_id = (SELECT private.current_session_user_id())
      AND statement_timestamp() < event.edit_deadline_at
  )
);

-- Preserve the legacy view shape without continuing to expose unused bracket
-- audit timestamps through it.
CREATE OR REPLACE VIEW public.bracket_leaderboard AS
SELECT
  bracket.id AS bracket_id,
  bracket.bracket_name,
  profile.user_id,
  profile.username,
  COALESCE(sum(pick.points_awarded), 0::bigint) AS actual_score,
  NULL::timestamp with time zone AS created_at,
  NULL::timestamp with time zone AS updated_at,
  bracket.submitted_at
FROM public.brackets AS bracket
JOIN public.profiles AS profile ON profile.user_id = bracket.user_id
LEFT JOIN public.bracket_picks AS pick ON pick.bracket_id = bracket.id
GROUP BY bracket.id, bracket.bracket_name, profile.user_id, profile.username,
  bracket.submitted_at;
ALTER VIEW public.bracket_leaderboard SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Lightning Cup match states: public reads, Worker-only competitor/admin writes
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "authenticated users can create match states" ON public.match_states;
DROP POLICY IF EXISTS "authenticated users can update match states" ON public.match_states;

CREATE OR REPLACE FUNCTION public.upsert_lightning_cup_match_state(
  p_actor_user_id uuid,
  p_match_id bigint,
  p_state jsonb,
  p_competitor_discord_user_ids text[]
)
RETURNS TABLE (
  match_id bigint,
  state jsonb,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_discord_id text;
BEGIN
  IF p_actor_user_id IS DISTINCT FROM private.worker_actor_user_id() THEN
    RAISE EXCEPTION 'Worker actor header does not match the requested actor.'
      USING ERRCODE = '42501';
  END IF;

  SELECT identity.provider_id
  INTO actor_discord_id
  FROM auth.identities AS identity
  WHERE identity.user_id = p_actor_user_id
    AND identity.provider = 'discord'
    AND identity.provider_id ~ '^[0-9]+$'
  LIMIT 1;

  IF actor_discord_id IS NULL
    OR (
      NOT private.user_is_discord_admin(p_actor_user_id)
      AND NOT actor_discord_id = ANY(COALESCE(p_competitor_discord_user_ids, '{}'::text[]))
    )
  THEN
    RAISE EXCEPTION 'Only a match competitor or Discord administrator may edit this match.'
      USING ERRCODE = '42501';
  END IF;

  IF p_match_id < 1 OR p_match_id > 63
    OR p_state IS NULL
    OR jsonb_typeof(p_state) <> 'object'
    OR COALESCE((p_state->>'version')::integer, 0) <> 1
    OR jsonb_typeof(p_state->'sets') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_state->'sets') <> 3
    OR jsonb_typeof(p_state->'history') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_state->'history') > 200
    OR jsonb_typeof(p_state->'undoStack') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_state->'undoStack') > 40
    OR octet_length(p_state::text) > 100000
  THEN
    RAISE EXCEPTION 'Invalid Lightning Cup match state.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO public.match_states AS match_state (match_id, state, updated_by)
  VALUES (p_match_id, p_state, p_actor_user_id)
  ON CONFLICT ON CONSTRAINT match_states_pkey DO UPDATE
  SET state = EXCLUDED.state,
      updated_by = EXCLUDED.updated_by
  RETURNING match_state.match_id, match_state.state, match_state.updated_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_lightning_cup_match_state(uuid, bigint, jsonb, text[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_lightning_cup_match_state(uuid, bigint, jsonb, text[])
TO service_role;

-- ---------------------------------------------------------------------------
-- RLS for public reporting tables previously protected by grants alone
-- ---------------------------------------------------------------------------

ALTER TABLE public.internal_ranked_elo_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_ranked_elo_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_ranked_gpi_match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_ranked_gpi_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_ranked_gpi_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_tournament_gpi_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_tournament_gpi_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_tournament_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_ranked_elo_ratings_public_read
ON public.internal_ranked_elo_ratings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY internal_ranked_elo_runs_public_read
ON public.internal_ranked_elo_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY internal_ranked_gpi_match_results_public_read
ON public.internal_ranked_gpi_match_results FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY internal_ranked_gpi_ratings_public_read
ON public.internal_ranked_gpi_ratings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY internal_ranked_gpi_runs_public_read
ON public.internal_ranked_gpi_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY internal_tournament_gpi_ratings_public_read
ON public.internal_tournament_gpi_ratings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY internal_tournament_gpi_runs_public_read
ON public.internal_tournament_gpi_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY internal_tournament_matches_public_read
ON public.internal_tournament_matches FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Canonical identity for self-service rows and admin URL moderation
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "discord users can view event blocked roles" ON public.event_blocked_roles;
DROP POLICY IF EXISTS "discord users can view event required roles" ON public.event_required_roles;
DROP POLICY IF EXISTS "discord users can create their own event signups" ON public.event_signups;
DROP POLICY IF EXISTS "discord users can delete their own event signups" ON public.event_signups;
DROP POLICY IF EXISTS "discord users can view event signups" ON public.event_signups;
DROP POLICY IF EXISTS "discord users can view signup events" ON public.events;

CREATE OR REPLACE FUNCTION private.can_current_discord_actor_signup(
  p_event_id uuid,
  p_guild_id text,
  p_discord_user_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_discord_user_id = (SELECT private.current_discord_user_id())
    AND EXISTS (
      SELECT 1
      FROM public.events AS event
      JOIN public.discord_guild_sync_state AS sync_state
        ON sync_state.guild_id = event.guild_id
      JOIN public.discord_guild_members AS guild_member
        ON guild_member.guild_id = event.guild_id
       AND guild_member.discord_user_id = p_discord_user_id
       AND guild_member.is_current_member
       AND guild_member.last_scanned_at = sync_state.completed_at
      WHERE event.id = p_event_id
        AND event.guild_id = p_guild_id
        AND (event.deadline_at IS NULL OR statement_timestamp() < event.deadline_at)
        AND (
          (
            EXISTS (
              SELECT 1
              FROM public.event_required_roles AS required
              WHERE required.event_id = event.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.event_required_roles AS required
              WHERE required.event_id = event.id
                AND NOT EXISTS (
                  SELECT 1
                  FROM public.discord_member_roles AS member_role
                  JOIN public.discord_roles AS discord_role
                    ON discord_role.guild_id = member_role.guild_id
                   AND discord_role.role_id = member_role.role_id
                   AND discord_role.is_current_role
                   AND discord_role.last_scanned_at = sync_state.completed_at
                  WHERE member_role.guild_id = required.guild_id
                    AND member_role.role_id = required.role_id
                    AND member_role.discord_user_id = p_discord_user_id
                    AND member_role.scanned_at = sync_state.completed_at
                )
            )
          )
          OR (
            NOT EXISTS (
              SELECT 1
              FROM public.event_required_roles AS required
              WHERE required.event_id = event.id
            )
            AND (
              event.required_role_id IS NULL
              OR EXISTS (
                SELECT 1
                FROM public.discord_member_roles AS member_role
                JOIN public.discord_roles AS discord_role
                  ON discord_role.guild_id = member_role.guild_id
                 AND discord_role.role_id = member_role.role_id
                 AND discord_role.is_current_role
                 AND discord_role.last_scanned_at = sync_state.completed_at
                WHERE member_role.guild_id = event.guild_id
                  AND member_role.discord_user_id = p_discord_user_id
                  AND member_role.role_id = event.required_role_id
                  AND member_role.scanned_at = sync_state.completed_at
              )
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.event_blocked_roles AS blocked
          JOIN public.discord_member_roles AS member_role
            ON member_role.guild_id = blocked.guild_id
           AND member_role.role_id = blocked.role_id
           AND member_role.discord_user_id = p_discord_user_id
           AND member_role.scanned_at = sync_state.completed_at
          JOIN public.discord_roles AS discord_role
            ON discord_role.guild_id = member_role.guild_id
           AND discord_role.role_id = member_role.role_id
           AND discord_role.is_current_role
           AND discord_role.last_scanned_at = sync_state.completed_at
          WHERE blocked.event_id = event.id
        )
    );
$$;

REVOKE EXECUTE ON FUNCTION private.can_current_discord_actor_signup(uuid, text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_current_discord_actor_signup(uuid, text, text)
TO authenticated;

CREATE POLICY events_live_discord_read
ON public.events FOR SELECT TO authenticated
USING ((SELECT private.current_discord_user_id()) IS NOT NULL);
CREATE POLICY event_signups_live_discord_read
ON public.event_signups FOR SELECT TO authenticated
USING ((SELECT private.current_discord_user_id()) IS NOT NULL);
CREATE POLICY event_signups_insert_own_before_deadline
ON public.event_signups FOR INSERT TO authenticated
WITH CHECK (
  discord_user_id = (SELECT private.current_discord_user_id())
  AND char_length(btrim(username)) BETWEEN 1 AND 32
  AND char_length(btrim(display_name)) BETWEEN 1 AND 100
  AND private.can_current_discord_actor_signup(
    event_id,
    guild_id,
    discord_user_id
  )
);
CREATE POLICY event_signups_delete_own_before_deadline
ON public.event_signups FOR DELETE TO authenticated
USING (
  discord_user_id = (SELECT private.current_discord_user_id())
  AND EXISTS (
    SELECT 1
    FROM public.events AS event
    WHERE event.id = event_signups.event_id
      AND (event.deadline_at IS NULL OR statement_timestamp() < event.deadline_at)
  )
);

DROP POLICY IF EXISTS "players can insert their own settings" ON public.player_settings;
DROP POLICY IF EXISTS "players can update their own settings" ON public.player_settings;
CREATE POLICY player_settings_insert_own_discord_identity
ON public.player_settings FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT private.current_session_user_id())
  AND discord_user_id = (SELECT private.current_discord_user_id())
);
CREATE POLICY player_settings_update_own_discord_identity
ON public.player_settings FOR UPDATE TO authenticated
USING (
  (user_id IS NULL OR user_id = (SELECT private.current_session_user_id()))
  AND discord_user_id = (SELECT private.current_discord_user_id())
)
WITH CHECK (
  user_id = (SELECT private.current_session_user_id())
  AND discord_user_id = (SELECT private.current_discord_user_id())
);

DROP POLICY IF EXISTS "players can create pending url claims" ON public.player_custom_urls;
DROP POLICY IF EXISTS "players can update their own url claims to pending" ON public.player_custom_urls;
DROP POLICY IF EXISTS "players can delete pending url claims" ON public.player_custom_urls;
DROP POLICY IF EXISTS "players can view their own url claims" ON public.player_custom_urls;
DROP POLICY IF EXISTS "admins can revoke player url claims" ON public.player_custom_urls;
DROP POLICY IF EXISTS "admins can update player url claims" ON public.player_custom_urls;
DROP POLICY IF EXISTS "admins can view all player url claims" ON public.player_custom_urls;
DROP POLICY IF EXISTS "approved player urls are publicly readable" ON public.player_custom_urls;

CREATE POLICY player_custom_urls_approved_public_read
ON public.player_custom_urls FOR SELECT TO anon
USING (status = 'approved');
CREATE POLICY player_custom_urls_authenticated_read
ON public.player_custom_urls FOR SELECT TO authenticated
USING (
  status = 'approved'
  OR user_id = (SELECT private.current_session_user_id())
);
CREATE POLICY player_custom_urls_owner_insert_pending
ON public.player_custom_urls FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT private.current_session_user_id())
  AND discord_user_id = (SELECT private.current_discord_user_id())
  AND status = 'pending'
  AND approved_at IS NULL
  AND approved_by_user_id IS NULL
  AND approved_by_username IS NULL
);
CREATE POLICY player_custom_urls_owner_update_to_pending
ON public.player_custom_urls FOR UPDATE TO authenticated
USING (user_id = (SELECT private.current_session_user_id()))
WITH CHECK (
  user_id = (SELECT private.current_session_user_id())
  AND discord_user_id = (SELECT private.current_discord_user_id())
  AND status = 'pending'
  AND approved_at IS NULL
  AND approved_by_user_id IS NULL
  AND approved_by_username IS NULL
);
CREATE POLICY player_custom_urls_owner_delete_pending
ON public.player_custom_urls FOR DELETE TO authenticated
USING (
  user_id = (SELECT private.current_session_user_id())
  AND status = 'pending'
);

CREATE OR REPLACE FUNCTION public.list_player_custom_url_claims()
RETURNS TABLE (
  user_id uuid,
  discord_user_id text,
  slug text,
  status text,
  requested_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by_username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_admin_actor();

  RETURN QUERY
  SELECT
    claim.user_id,
    claim.discord_user_id,
    claim.slug,
    claim.status,
    claim.requested_at,
    claim.approved_at,
    claim.approved_by_username
  FROM public.player_custom_urls AS claim
  WHERE claim.status IN ('pending', 'approved')
  ORDER BY claim.status DESC, claim.requested_at, claim.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_player_custom_url_claim(
  p_user_id uuid,
  p_slug text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
BEGIN
  SELECT * INTO actor FROM private.require_admin_actor();

  UPDATE public.player_custom_urls AS claim
  SET
    status = 'approved',
    approved_at = statement_timestamp(),
    approved_by_user_id = actor.actor_user_id,
    approved_by_username = actor.actor_username
  WHERE claim.user_id = p_user_id
    AND claim.slug = p_slug
    AND claim.status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending custom URL claim was not found.' USING ERRCODE = '55000';
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_player_custom_url_claim(
  p_user_id uuid,
  p_slug text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.require_admin_actor();

  DELETE FROM public.player_custom_urls AS claim
  WHERE claim.user_id = p_user_id
    AND claim.slug = p_slug
    AND claim.status IN ('pending', 'approved');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Custom URL claim was not found.' USING ERRCODE = '55000';
  END IF;

  RETURN true;
END;
$$;

-- These tables are intentionally writable only through audited admin RPCs.
-- Removing the obsolete direct-write policies prevents a future broad grant
-- from silently re-enabling an unaudited path.
DROP POLICY IF EXISTS "admins can create championship settings"
ON public.championship_point_settings;
DROP POLICY IF EXISTS "admins can update championship settings"
ON public.championship_point_settings;
DROP POLICY IF EXISTS "admins can hide gpi players" ON public.gpi_hidden_players;
DROP POLICY IF EXISTS "admins can unhide gpi players" ON public.gpi_hidden_players;
DROP POLICY IF EXISTS "admins can update gpi hidden players" ON public.gpi_hidden_players;
DROP POLICY IF EXISTS "admins can create global rank moderation"
ON public.player_global_rank_moderation;
DROP POLICY IF EXISTS "admins can delete global rank moderation"
ON public.player_global_rank_moderation;
DROP POLICY IF EXISTS "admins can update global rank moderation"
ON public.player_global_rank_moderation;

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own_username
ON public.profiles FOR UPDATE TO authenticated
USING (user_id = (SELECT private.current_session_user_id()))
WITH CHECK (
  user_id = (SELECT private.current_session_user_id())
  AND username IS NOT NULL
  AND char_length(btrim(username::text)) BETWEEN 1 AND 32
);

DROP POLICY IF EXISTS "public can read tournament editor configuration"
ON public.tournament_admin_events;
DROP POLICY IF EXISTS "tournament result admins can view edit events"
ON public.tournament_admin_events;
DROP POLICY IF EXISTS "tournament result admins can archive edit events"
ON public.tournament_admin_events;
CREATE POLICY tournament_editor_safe_configuration_public_read
ON public.tournament_admin_events
FOR SELECT
TO anon, authenticated
USING (true);

-- ---------------------------------------------------------------------------
-- Exact table and sequence grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.bracket_leaderboard,
  public.internal_ranked_elo_ratings,
  public.internal_ranked_gpi_match_results,
  public.internal_ranked_gpi_ratings,
  public.internal_ranked_gpi_runs,
  public.internal_tournament_gpi_ratings,
  public.ranked
TO anon, authenticated;

GRANT SELECT (year, event_key, display_name, edit_deadline_at, picks_public_at)
ON public.bracket_event_settings TO anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  bracket_name,
  submitted_at,
  year
) ON public.brackets TO anon, authenticated;
GRANT SELECT (
  bracket_id,
  match_id,
  round_code,
  round_number,
  selected_winner_name,
  selected_winner_seed,
  is_correct,
  points_awarded,
  year
) ON public.bracket_picks TO anon, authenticated;
GRANT SELECT (
  guild_id,
  discord_user_id,
  username,
  global_name,
  is_bot,
  display_name,
  nickname,
  avatar_url,
  server_avatar_url,
  joined_at,
  is_current_member,
  updated_at
) ON public.discord_guild_members TO anon, authenticated;
GRANT SELECT (guild_id, discord_user_id, role_id)
ON public.discord_member_roles TO anon, authenticated;
GRANT SELECT (guild_id, role_id, name, position)
ON public.discord_roles TO anon, authenticated;
GRANT SELECT (match_id, state, updated_at)
ON public.match_states TO anon, authenticated;
GRANT SELECT (
  league_key,
  league_player_name,
  league_player_key,
  guild_id,
  discord_user_id,
  active,
  notes
) ON public.player_league_aliases TO anon, authenticated;

GRANT SELECT (slug, discord_user_id, status)
ON public.player_custom_urls TO anon;
GRANT SELECT (user_id, slug, discord_user_id, status)
ON public.player_custom_urls TO authenticated;
GRANT SELECT (
  discord_user_id,
  country_1,
  country_2,
  time_zone,
  current_global_rank,
  max_global_rank_no_cs,
  max_global_rank_cs
) ON public.player_settings TO anon, authenticated;
GRANT SELECT (user_id, username, discord_user_id, full_name)
ON public.profiles TO anon, authenticated;
GRANT SELECT (id, settings, hidden_player_keys)
ON public.championship_point_settings TO anon, authenticated;
GRANT SELECT (discord_user_id)
ON public.gpi_hidden_players TO anon, authenticated;
GRANT SELECT (discord_user_id, rank_key)
ON public.player_global_rank_moderation TO anon, authenticated;

GRANT SELECT (
  id,
  calculation_version,
  base_rating,
  k_factor,
  season_start,
  season_end,
  match_count,
  player_count,
  created_at
) ON public.internal_ranked_elo_runs TO anon, authenticated;

GRANT SELECT (
  id,
  calculation_version,
  model,
  base_rating,
  rating_scale,
  event_start,
  event_end,
  match_count,
  player_count,
  latest_match_at,
  created_at
) ON public.internal_tournament_gpi_runs TO anon, authenticated;

GRANT SELECT (
  match_hash,
  event_key,
  event_name,
  event_order,
  match_order,
  source_match_id,
  round_label,
  timestamp_ms,
  played_at,
  player_a_discord_user_id,
  player_a_name,
  player_a_score,
  player_b_discord_user_id,
  player_b_name,
  player_b_score,
  winner_discord_user_id
) ON public.internal_tournament_matches TO anon, authenticated;

GRANT SELECT (
  event_key,
  display_name,
  route_path,
  sheet_id,
  source_ranges,
  editable_ranges,
  formula_ranges,
  editor_tables,
  edit_enabled,
  archived,
  archived_at
) ON public.tournament_admin_events TO anon;

GRANT SELECT (
  event_id,
  event_name,
  guild_id,
  discord_user_id,
  username,
  display_name,
  signed_up_at
) ON public.event_signups TO authenticated;
GRANT SELECT (id, name, deadline_at, created_at)
ON public.events TO authenticated;
GRANT SELECT (
  event_key,
  display_name,
  route_path,
  sheet_id,
  source_ranges,
  editable_ranges,
  formula_ranges,
  editor_tables,
  edit_enabled,
  archived,
  archived_at
) ON public.tournament_admin_events TO authenticated;

GRANT INSERT (user_id, bracket_name, year)
ON public.brackets TO authenticated;
GRANT UPDATE (bracket_name)
ON public.brackets TO authenticated;

GRANT INSERT (
  bracket_id,
  match_id,
  round_code,
  round_number,
  selected_winner_name,
  selected_winner_seed,
  year
) ON public.bracket_picks TO authenticated;
GRANT UPDATE (
  bracket_id,
  match_id,
  round_code,
  round_number,
  selected_winner_name,
  selected_winner_seed,
  year
) ON public.bracket_picks TO authenticated;
GRANT DELETE ON public.bracket_picks TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.bracket_picks_id_seq TO authenticated;

GRANT INSERT (
  event_id,
  event_name,
  guild_id,
  discord_user_id,
  username,
  display_name
) ON public.event_signups TO authenticated;
GRANT DELETE ON public.event_signups TO authenticated;

GRANT INSERT (
  user_id,
  discord_user_id,
  country_1,
  country_2,
  time_zone,
  current_global_rank,
  max_global_rank_no_cs,
  max_global_rank_cs
) ON public.player_settings TO authenticated;
GRANT UPDATE (
  user_id,
  discord_user_id,
  country_1,
  country_2,
  time_zone,
  current_global_rank,
  max_global_rank_no_cs,
  max_global_rank_cs
) ON public.player_settings TO authenticated;

GRANT INSERT (
  user_id,
  discord_user_id,
  slug,
  status
) ON public.player_custom_urls TO authenticated;
GRANT DELETE ON public.player_custom_urls TO authenticated;
GRANT UPDATE (
  slug,
  status,
  approved_at,
  approved_by_user_id,
  approved_by_username
) ON public.player_custom_urls TO authenticated;

GRANT UPDATE (username) ON public.profiles TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Direct access to secrets, raw imports, internal match JSON, bot display state,
-- and audit logs remains service-only/deny-by-default.
REVOKE ALL ON TABLE
  public.discord_global_rank_display_messages,
  public.event_signup_display_messages,
  public.internal_ranked_matches
FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Function hardening and Worker-only action-log lifecycle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.worker_actor_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(
      NULLIF(current_setting('request.headers', true), '')::jsonb
        ->>'x-nssgolf-actor-user-id',
      ''
    ) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN (
      NULLIF(current_setting('request.headers', true), '')::jsonb
        ->>'x-nssgolf-actor-user-id'
    )::uuid
    ELSE NULL
  END;
$$;

REVOKE EXECUTE ON FUNCTION private.worker_actor_user_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.worker_actor_user_id() TO service_role;

CREATE OR REPLACE FUNCTION public.create_tournament_result_action_log(
  p_event_key text,
  p_action_type text,
  p_changes jsonb DEFAULT NULL,
  p_target_action_id uuid DEFAULT NULL
)
RETURNS TABLE (
  action_id uuid,
  changes jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := private.worker_actor_user_id();
  actor_discord_id text;
  actor_name text;
  event_record public.tournament_admin_events%ROWTYPE;
  target_record private.tournament_result_action_logs%ROWTYPE;
  log_changes jsonb;
  inserted_record private.tournament_result_action_logs%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT private.user_is_discord_admin(actor_id) THEN
    RAISE EXCEPTION 'A verified Worker administrator context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_action_type IS NULL OR p_action_type NOT IN ('edit', 'undo') THEN
    RAISE EXCEPTION 'Unsupported tournament action type.' USING ERRCODE = '22023';
  END IF;

  SELECT event.*
  INTO event_record
  FROM public.tournament_admin_events AS event
  WHERE event.event_key = p_event_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown tournament admin event: %', p_event_key USING ERRCODE = '22023';
  END IF;

  IF NOT event_record.edit_enabled OR event_record.archived THEN
    RAISE EXCEPTION 'Tournament result editing is not active for %.', p_event_key
      USING ERRCODE = '55000';
  END IF;

  SELECT
    identity.provider_id,
    COALESCE(
      NULLIF(member.display_name, ''),
      NULLIF(member.username, ''),
      NULLIF(identity.identity_data->>'full_name', ''),
      NULLIF(identity.identity_data->>'name', ''),
      identity.provider_id
    )
  INTO actor_discord_id, actor_name
  FROM auth.identities AS identity
  LEFT JOIN LATERAL (
    SELECT guild_member.display_name, guild_member.username
    FROM public.discord_guild_members AS guild_member
    WHERE guild_member.discord_user_id = identity.provider_id
    ORDER BY guild_member.is_current_member DESC, guild_member.updated_at DESC
    LIMIT 1
  ) AS member ON true
  WHERE identity.user_id = actor_id
    AND identity.provider = 'discord'
  LIMIT 1;

  IF actor_discord_id IS NULL OR actor_name IS NULL THEN
    RAISE EXCEPTION 'Discord identity is required.' USING ERRCODE = '42501';
  END IF;

  IF p_action_type = 'edit' THEN
    IF p_target_action_id IS NOT NULL
      OR p_changes IS NULL
      OR jsonb_typeof(p_changes) <> 'array'
      OR jsonb_array_length(p_changes) = 0
      OR jsonb_array_length(p_changes) > 200
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_changes) AS item(value)
        WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
          OR COALESCE(length(btrim(item.value->>'range')), 0) = 0
          OR length(item.value->>'range') > 250
          OR jsonb_typeof(item.value->'before') IS DISTINCT FROM 'array'
          OR jsonb_typeof(item.value->'after') IS DISTINCT FROM 'array'
      )
    THEN
      RAISE EXCEPTION 'Invalid tournament result changes.' USING ERRCODE = '22023';
    END IF;
    log_changes := p_changes;
  ELSE
    IF p_target_action_id IS NULL THEN
      RAISE EXCEPTION 'Undo target is required.' USING ERRCODE = '22023';
    END IF;

    SELECT log.*
    INTO target_record
    FROM private.tournament_result_action_logs AS log
    WHERE log.id = p_target_action_id
    FOR UPDATE;

    IF NOT FOUND
      OR target_record.action_type <> 'edit'
      OR target_record.status <> 'succeeded'
      OR target_record.event_key <> p_event_key
      OR target_record.undone_by_action_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'This tournament edit cannot be undone.' USING ERRCODE = '55000';
    END IF;

    SELECT jsonb_agg(
      jsonb_build_object(
        'range', item.value->>'range',
        'before', item.value->'after',
        'after', item.value->'before'
      )
      ORDER BY item.ordinality
    )
    INTO log_changes
    FROM jsonb_array_elements(target_record.changes) WITH ORDINALITY AS item(value, ordinality);
  END IF;

  UPDATE private.tournament_result_action_logs AS stale_log
  SET
    status = 'failed',
    error_message = 'Action expired before completion.',
    completed_at = statement_timestamp()
  WHERE stale_log.event_key = event_record.event_key
    AND stale_log.status = 'pending'
    AND stale_log.created_at < statement_timestamp() - interval '5 minutes';

  INSERT INTO private.tournament_result_action_logs (
    action_type,
    event_key,
    event_display_name,
    route_path,
    actor_user_id,
    actor_discord_user_id,
    actor_username,
    changes,
    target_action_id
  )
  VALUES (
    p_action_type,
    event_record.event_key,
    event_record.display_name,
    event_record.route_path,
    actor_id,
    actor_discord_id,
    actor_name,
    log_changes,
    p_target_action_id
  )
  RETURNING * INTO inserted_record;

  RETURN QUERY SELECT inserted_record.id, inserted_record.changes;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Another tournament action is already pending for this event.' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.set_tournament_result_action_log_changes(
  p_action_id uuid,
  p_changes jsonb
)
RETURNS TABLE (
  action_id uuid,
  changes jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := private.worker_actor_user_id();
  updated_record private.tournament_result_action_logs%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT private.user_is_discord_admin(actor_id) THEN
    RAISE EXCEPTION 'A verified Worker administrator context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_action_id IS NULL
    OR p_changes IS NULL
    OR jsonb_typeof(p_changes) <> 'array'
    OR jsonb_array_length(p_changes) = 0
    OR jsonb_array_length(p_changes) > 200
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_changes) AS item(value)
      WHERE jsonb_typeof(item.value) IS DISTINCT FROM 'object'
        OR COALESCE(length(btrim(item.value->>'range')), 0) = 0
        OR length(item.value->>'range') > 250
        OR jsonb_typeof(item.value->'before') IS DISTINCT FROM 'array'
        OR jsonb_typeof(item.value->'after') IS DISTINCT FROM 'array'
    )
  THEN
    RAISE EXCEPTION 'Invalid tournament result changes.' USING ERRCODE = '22023';
  END IF;

  UPDATE private.tournament_result_action_logs AS log
  SET changes = p_changes
  WHERE log.id = p_action_id
    AND log.actor_user_id = actor_id
    AND log.action_type = 'edit'
    AND log.status = 'pending'
  RETURNING * INTO updated_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending tournament edit action was not found.' USING ERRCODE = '55000';
  END IF;

  RETURN QUERY SELECT updated_record.id, updated_record.changes;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tournament_result_action_log(
  p_action_id uuid,
  p_succeeded boolean,
  p_error_message text DEFAULT NULL
)
RETURNS TABLE (
  action_id uuid,
  status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := private.worker_actor_user_id();
  completed_record private.tournament_result_action_logs%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT private.user_is_discord_admin(actor_id) THEN
    RAISE EXCEPTION 'A verified Worker administrator context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_action_id IS NULL OR p_succeeded IS NULL THEN
    RAISE EXCEPTION 'Action ID and completion state are required.' USING ERRCODE = '22023';
  END IF;

  UPDATE private.tournament_result_action_logs AS log
  SET
    status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
    error_message = CASE
      WHEN p_succeeded THEN NULL
      ELSE COALESCE(NULLIF(btrim(p_error_message), ''), 'Tournament result write failed.')
    END,
    completed_at = statement_timestamp()
  WHERE log.id = p_action_id
    AND log.actor_user_id = actor_id
    AND log.status = 'pending'
  RETURNING * INTO completed_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending tournament action was not found.' USING ERRCODE = '55000';
  END IF;

  IF p_succeeded
    AND completed_record.action_type = 'edit'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(completed_record.changes) AS item(value)
      WHERE item.value->'before' = '[]'::jsonb
    )
  THEN
    RAISE EXCEPTION 'Tournament edit values were not finalized before completion.'
      USING ERRCODE = '55000';
  END IF;

  IF p_succeeded AND completed_record.action_type = 'undo' THEN
    UPDATE private.tournament_result_action_logs AS target
    SET
      undone_at = statement_timestamp(),
      undone_by_action_id = completed_record.id
    WHERE target.id = completed_record.target_action_id
      AND target.action_type = 'edit'
      AND target.status = 'succeeded'
      AND target.undone_by_action_id IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Undo target is no longer available.' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN QUERY SELECT completed_record.id, completed_record.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_internal_ranked_head_to_head_matches(
  player_a_id text,
  player_b_id text
)
RETURNS TABLE (
  match_hash text,
  season integer,
  timestamp_ms bigint,
  played_at timestamp with time zone,
  player_a_place integer,
  player_b_place integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH match_players AS (
    SELECT
      matches.match_hash,
      matches.season,
      matches.timestamp_ms,
      matches.played_at,
      player.value->>'player_id' AS discord_user_id,
      (result.value->>'place')::integer AS place
    FROM public.internal_ranked_matches AS matches
    CROSS JOIN LATERAL jsonb_array_elements(matches.raw_match->'results') AS result(value)
    CROSS JOIN LATERAL jsonb_array_elements(result.value->'players') AS player(value)
    WHERE player_a_id ~ '^[0-9]{17,20}$'
      AND player_b_id ~ '^[0-9]{17,20}$'
      AND player_a_id <> player_b_id
      AND player.value->>'player_id' IN (player_a_id, player_b_id)
      AND result.value->>'place' ~ '^[0-9]+$'
  )
  SELECT
    player_a.match_hash,
    player_a.season,
    player_a.timestamp_ms,
    player_a.played_at,
    player_a.place,
    player_b.place
  FROM match_players AS player_a
  JOIN match_players AS player_b ON player_b.match_hash = player_a.match_hash
  WHERE player_a.discord_user_id = player_a_id
    AND player_b.discord_user_id = player_b_id
  ORDER BY player_a.timestamp_ms, player_a.match_hash;
$$;

-- Browser signups can read only the public event fields. The trigger needs a
-- narrowly scoped definer path to copy the canonical guild/name without
-- granting every event audit column to authenticated users.
CREATE OR REPLACE FUNCTION public.set_event_signup_event_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  matched_guild_id text;
  matched_event_name text;
BEGIN
  SELECT event.guild_id, event.name
  INTO matched_guild_id, matched_event_name
  FROM public.events AS event
  WHERE event.id = new.event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_id does not reference an event'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  new.guild_id := matched_guild_id;
  new.event_name := matched_event_name;
  RETURN new;
END;
$$;

-- Fix the advisor's mutable-search-path findings on invoker/trigger helpers.
ALTER FUNCTION public.base_points_for_round(smallint) SET search_path = pg_catalog, public;
ALTER FUNCTION public.normalize_player_alias_key(text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_championship_point_settings_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_discord_global_rank_display_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_discord_sync_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_event_blocked_role_event_fields() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_event_required_role_event_fields() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_event_signup_display_event_fields() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_event_signup_display_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_internal_ranked_matches_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_match_states_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_player_league_aliases_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_player_settings_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_signup_event_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog, public;
ALTER FUNCTION public.sync_event_signup_event_name() SET search_path = pg_catalog, public;

-- These RPCs perform their own live Discord-admin check before touching the
-- private event configuration. Definer security lets the narrow API contract
-- work without restoring direct table/audit-column privileges to admins.
ALTER FUNCTION public.get_tournament_admin_edit_context(text) SECURITY DEFINER;
ALTER FUNCTION public.authorize_tournament_result_edit(text) SECURITY DEFINER;
ALTER FUNCTION public.set_tournament_result_archived(text, boolean) SECURITY DEFINER;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_internal_ranked_head_to_head_matches(text, text)
TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_editor_read_context(text)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_discord_actor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_result_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_admin_edit_context(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_tournament_result_edit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tournament_result_archived(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_result_action_for_undo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tournament_result_action_logs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_visibility(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_admin_visibility_action(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_action_logs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_championship_point_values(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_player_custom_url_claims() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_player_custom_url_claim(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_player_custom_url_claim(uuid, text) TO authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_tournament_result_action_log(text, text, jsonb, uuid)
FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tournament_result_action_log_changes(uuid, jsonb)
FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_tournament_result_action_log(uuid, boolean, text)
FROM authenticated;

-- Triggers do not require caller EXECUTE privileges.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
