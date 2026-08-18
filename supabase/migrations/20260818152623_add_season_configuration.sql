CREATE TABLE public.season_configuration (
  id                          text PRIMARY KEY,
  ranked_league_season        smallint NOT NULL,
  shotgun_pro_league_season   smallint NOT NULL,
  shotgun_pro_league_stage    smallint NOT NULL,
  super_league_season         smallint NOT NULL,
  updated_at                  timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  updated_by_user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT season_configuration_singleton_check CHECK (id = 'current'),
  CONSTRAINT season_configuration_ranked_season_check CHECK (ranked_league_season BETWEEN 7 AND 99),
  CONSTRAINT season_configuration_pro_season_check CHECK (shotgun_pro_league_season BETWEEN 1 AND 99),
  CONSTRAINT season_configuration_pro_stage_check CHECK (shotgun_pro_league_stage BETWEEN 1 AND 3),
  CONSTRAINT season_configuration_super_season_check CHECK (super_league_season BETWEEN 1 AND 99)
);

INSERT INTO public.season_configuration (
  id,
  ranked_league_season,
  shotgun_pro_league_season,
  shotgun_pro_league_stage,
  super_league_season
)
VALUES ('current', 13, 7, 3, 6);

ALTER TABLE public.season_configuration ENABLE ROW LEVEL SECURITY;
CREATE POLICY season_configuration_public_read
ON public.season_configuration
FOR SELECT
TO anon, authenticated
USING (id = 'current');

REVOKE ALL ON TABLE public.season_configuration FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  ranked_league_season,
  shotgun_pro_league_season,
  shotgun_pro_league_stage,
  super_league_season
) ON TABLE public.season_configuration TO anon, authenticated;
GRANT ALL ON TABLE public.season_configuration TO service_role;

CREATE TABLE private.season_configuration_action_logs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type              text NOT NULL,
  status                   text NOT NULL DEFAULT 'succeeded',
  actor_user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_discord_user_id    text NOT NULL,
  actor_username           text NOT NULL,
  changes                  jsonb NOT NULL,
  before_configuration     jsonb NOT NULL,
  after_configuration      jsonb NOT NULL,
  target_action_id         uuid REFERENCES private.season_configuration_action_logs(id) ON DELETE RESTRICT,
  created_at               timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  completed_at             timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  undone_at                timestamp with time zone,
  undone_by_action_id      uuid REFERENCES private.season_configuration_action_logs(id) ON DELETE RESTRICT,
  CONSTRAINT season_configuration_logs_action_type_check CHECK (action_type IN ('configuration', 'undo')),
  CONSTRAINT season_configuration_logs_status_check CHECK (status = 'succeeded'),
  CONSTRAINT season_configuration_logs_changes_check
    CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) BETWEEN 1 AND 4),
  CONSTRAINT season_configuration_logs_before_check CHECK (jsonb_typeof(before_configuration) = 'object'),
  CONSTRAINT season_configuration_logs_after_check CHECK (jsonb_typeof(after_configuration) = 'object'),
  CONSTRAINT season_configuration_logs_target_check CHECK (
    (action_type = 'configuration' AND target_action_id IS NULL)
    OR (action_type = 'undo' AND target_action_id IS NOT NULL)
  ),
  CONSTRAINT season_configuration_logs_undone_check CHECK (
    (undone_by_action_id IS NULL AND undone_at IS NULL)
    OR (undone_by_action_id IS NOT NULL AND undone_at IS NOT NULL)
  )
);

ALTER TABLE private.season_configuration_action_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.season_configuration_action_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.season_configuration_action_logs TO service_role;

CREATE INDEX season_configuration_action_logs_created_at_idx
ON private.season_configuration_action_logs (created_at DESC);

CREATE UNIQUE INDEX season_configuration_action_logs_active_undo_idx
ON private.season_configuration_action_logs (target_action_id)
WHERE action_type = 'undo';

CREATE FUNCTION public.update_season_configuration(
  p_ranked_league_season integer,
  p_shotgun_pro_league_season integer,
  p_shotgun_pro_league_stage integer,
  p_super_league_season integer,
  p_expected_configuration jsonb
)
RETURNS TABLE (
  action_id uuid,
  ranked_league_season smallint,
  shotgun_pro_league_season smallint,
  shotgun_pro_league_stage smallint,
  super_league_season smallint,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
  current_configuration public.season_configuration%ROWTYPE;
  saved_configuration public.season_configuration%ROWTYPE;
  inserted_action private.season_configuration_action_logs%ROWTYPE;
  before_configuration jsonb;
  after_configuration jsonb;
  configuration_changes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO actor FROM private.require_admin_actor();

  IF p_ranked_league_season IS NULL
    OR p_shotgun_pro_league_season IS NULL
    OR p_shotgun_pro_league_stage IS NULL
    OR p_super_league_season IS NULL
    OR p_ranked_league_season NOT BETWEEN 7 AND 99
    OR p_shotgun_pro_league_season NOT BETWEEN 1 AND 99
    OR p_shotgun_pro_league_stage NOT BETWEEN 1 AND 3
    OR p_super_league_season NOT BETWEEN 1 AND 99
  THEN
    RAISE EXCEPTION 'Ranked League must be Season 7 or later. Other seasons must be between 1 and 99, and the Pro League stage must be between 1 and 3.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('season-configuration', 0));

  SELECT configuration.*
  INTO current_configuration
  FROM public.season_configuration AS configuration
  WHERE configuration.id = 'current'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season configuration is unavailable.' USING ERRCODE = '55000';
  END IF;

  before_configuration := jsonb_build_object(
    'rankedLeagueSeason', current_configuration.ranked_league_season,
    'shotgunProLeagueSeason', current_configuration.shotgun_pro_league_season,
    'shotgunProLeagueStage', current_configuration.shotgun_pro_league_stage,
    'superLeagueSeason', current_configuration.super_league_season
  );
  IF p_expected_configuration IS NULL
    OR jsonb_typeof(p_expected_configuration) <> 'object'
    OR before_configuration IS DISTINCT FROM p_expected_configuration
  THEN
    RAISE EXCEPTION 'Season configuration changed since this page was loaded. Reload before saving.'
      USING ERRCODE = '55000';
  END IF;
  after_configuration := jsonb_build_object(
    'rankedLeagueSeason', p_ranked_league_season,
    'shotgunProLeagueSeason', p_shotgun_pro_league_season,
    'shotgunProLeagueStage', p_shotgun_pro_league_stage,
    'superLeagueSeason', p_super_league_season
  );

  IF current_configuration.ranked_league_season IS DISTINCT FROM p_ranked_league_season THEN
    configuration_changes := configuration_changes || jsonb_build_array(jsonb_build_object(
      'range', 'season-configuration:ranked-league-season',
      'before', jsonb_build_array(jsonb_build_array(current_configuration.ranked_league_season)),
      'after', jsonb_build_array(jsonb_build_array(p_ranked_league_season)),
      'playerName', 'Ranked League',
      'headers', jsonb_build_array('Season')
    ));
  END IF;
  IF current_configuration.shotgun_pro_league_season IS DISTINCT FROM p_shotgun_pro_league_season THEN
    configuration_changes := configuration_changes || jsonb_build_array(jsonb_build_object(
      'range', 'season-configuration:shotgun-pro-league-season',
      'before', jsonb_build_array(jsonb_build_array(current_configuration.shotgun_pro_league_season)),
      'after', jsonb_build_array(jsonb_build_array(p_shotgun_pro_league_season)),
      'playerName', 'Shotgun Pro League',
      'headers', jsonb_build_array('Season')
    ));
  END IF;
  IF current_configuration.shotgun_pro_league_stage IS DISTINCT FROM p_shotgun_pro_league_stage THEN
    configuration_changes := configuration_changes || jsonb_build_array(jsonb_build_object(
      'range', 'season-configuration:shotgun-pro-league-stage',
      'before', jsonb_build_array(jsonb_build_array(current_configuration.shotgun_pro_league_stage)),
      'after', jsonb_build_array(jsonb_build_array(p_shotgun_pro_league_stage)),
      'playerName', 'Shotgun Pro League',
      'headers', jsonb_build_array('Stage')
    ));
  END IF;
  IF current_configuration.super_league_season IS DISTINCT FROM p_super_league_season THEN
    configuration_changes := configuration_changes || jsonb_build_array(jsonb_build_object(
      'range', 'season-configuration:super-league-season',
      'before', jsonb_build_array(jsonb_build_array(current_configuration.super_league_season)),
      'after', jsonb_build_array(jsonb_build_array(p_super_league_season)),
      'playerName', 'Super League',
      'headers', jsonb_build_array('Season')
    ));
  END IF;

  IF jsonb_array_length(configuration_changes) = 0 THEN
    RAISE EXCEPTION 'There are no season configuration changes to save.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.season_configuration AS configuration
  SET
    ranked_league_season = p_ranked_league_season,
    shotgun_pro_league_season = p_shotgun_pro_league_season,
    shotgun_pro_league_stage = p_shotgun_pro_league_stage,
    super_league_season = p_super_league_season,
    updated_at = statement_timestamp(),
    updated_by_user_id = actor.actor_user_id
  WHERE configuration.id = 'current'
  RETURNING configuration.* INTO saved_configuration;

  INSERT INTO private.season_configuration_action_logs (
    action_type,
    actor_user_id,
    actor_discord_user_id,
    actor_username,
    changes,
    before_configuration,
    after_configuration
  ) VALUES (
    'configuration',
    actor.actor_user_id,
    actor.actor_discord_user_id,
    actor.actor_username,
    configuration_changes,
    before_configuration,
    after_configuration
  )
  RETURNING * INTO inserted_action;

  RETURN QUERY SELECT
    inserted_action.id,
    saved_configuration.ranked_league_season,
    saved_configuration.shotgun_pro_league_season,
    saved_configuration.shotgun_pro_league_stage,
    saved_configuration.super_league_season,
    saved_configuration.updated_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_season_configuration(integer, integer, integer, integer, jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_season_configuration(integer, integer, integer, integer, jsonb)
TO authenticated;

CREATE FUNCTION public.undo_season_configuration_action(p_action_id uuid)
RETURNS TABLE (
  action_id uuid,
  ranked_league_season smallint,
  shotgun_pro_league_season smallint,
  shotgun_pro_league_stage smallint,
  super_league_season smallint,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
  target_action private.season_configuration_action_logs%ROWTYPE;
  undo_action private.season_configuration_action_logs%ROWTYPE;
  current_configuration public.season_configuration%ROWTYPE;
  saved_configuration public.season_configuration%ROWTYPE;
  current_configuration_json jsonb;
  undo_changes jsonb;
BEGIN
  SELECT * INTO actor FROM private.require_admin_actor();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('season-configuration', 0));

  SELECT log.*
  INTO target_action
  FROM private.season_configuration_action_logs AS log
  WHERE log.id = p_action_id
  FOR UPDATE;

  IF NOT FOUND
    OR target_action.action_type <> 'configuration'
    OR target_action.status <> 'succeeded'
    OR target_action.undone_by_action_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM private.season_configuration_action_logs AS prior_undo
      WHERE prior_undo.target_action_id = target_action.id
    )
  THEN
    RAISE EXCEPTION 'This season configuration change cannot be undone.' USING ERRCODE = '55000';
  END IF;

  SELECT configuration.*
  INTO current_configuration
  FROM public.season_configuration AS configuration
  WHERE configuration.id = 'current'
  FOR UPDATE;

  current_configuration_json := jsonb_build_object(
    'rankedLeagueSeason', current_configuration.ranked_league_season,
    'shotgunProLeagueSeason', current_configuration.shotgun_pro_league_season,
    'shotgunProLeagueStage', current_configuration.shotgun_pro_league_stage,
    'superLeagueSeason', current_configuration.super_league_season
  );
  IF current_configuration_json IS DISTINCT FROM target_action.after_configuration THEN
    RAISE EXCEPTION 'Season configuration changed after this action and cannot be safely undone.'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.season_configuration AS configuration
  SET
    ranked_league_season = (target_action.before_configuration->>'rankedLeagueSeason')::smallint,
    shotgun_pro_league_season = (target_action.before_configuration->>'shotgunProLeagueSeason')::smallint,
    shotgun_pro_league_stage = (target_action.before_configuration->>'shotgunProLeagueStage')::smallint,
    super_league_season = (target_action.before_configuration->>'superLeagueSeason')::smallint,
    updated_at = statement_timestamp(),
    updated_by_user_id = actor.actor_user_id
  WHERE configuration.id = 'current'
  RETURNING configuration.* INTO saved_configuration;

  SELECT jsonb_agg(
    jsonb_build_object(
      'range', item.value->>'range',
      'before', item.value->'after',
      'after', item.value->'before',
      'playerName', item.value->>'playerName',
      'headers', item.value->'headers'
    )
    ORDER BY item.ordinality
  )
  INTO undo_changes
  FROM jsonb_array_elements(target_action.changes) WITH ORDINALITY AS item(value, ordinality);

  INSERT INTO private.season_configuration_action_logs (
    action_type,
    actor_user_id,
    actor_discord_user_id,
    actor_username,
    changes,
    before_configuration,
    after_configuration,
    target_action_id
  ) VALUES (
    'undo',
    actor.actor_user_id,
    actor.actor_discord_user_id,
    actor.actor_username,
    undo_changes,
    target_action.after_configuration,
    target_action.before_configuration,
    target_action.id
  )
  RETURNING * INTO undo_action;

  UPDATE private.season_configuration_action_logs AS original
  SET
    undone_at = statement_timestamp(),
    undone_by_action_id = undo_action.id
  WHERE original.id = target_action.id;

  RETURN QUERY SELECT
    undo_action.id,
    saved_configuration.ranked_league_season,
    saved_configuration.shotgun_pro_league_season,
    saved_configuration.shotgun_pro_league_stage,
    saved_configuration.super_league_season,
    saved_configuration.updated_at;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'This season configuration change has already been undone.' USING ERRCODE = '55000';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_season_configuration_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_season_configuration_action(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_admin_action_logs(p_limit integer DEFAULT 100)
RETURNS TABLE (
  action_id uuid,
  action_type text,
  status text,
  event_key text,
  event_display_name text,
  route_path text,
  actor_user_id uuid,
  actor_discord_user_id text,
  actor_username text,
  changes jsonb,
  target_action_id uuid,
  error_message text,
  created_at timestamp with time zone,
  completed_at timestamp with time zone,
  undone_at timestamp with time zone,
  undone_by_action_id uuid,
  can_undo boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM private.require_admin_actor();

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Log limit must be between 1 and 200.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT combined.*
  FROM (
    SELECT
      log.id AS action_id,
      log.action_type,
      log.status,
      log.event_key,
      log.event_display_name,
      log.route_path,
      log.actor_user_id,
      log.actor_discord_user_id,
      log.actor_username,
      log.changes,
      log.target_action_id,
      log.error_message,
      log.created_at,
      log.completed_at,
      log.undone_at,
      log.undone_by_action_id,
      log.action_type = 'edit'
        AND log.status = 'succeeded'
        AND log.undone_by_action_id IS NULL
        AND event.edit_enabled
        AND NOT event.archived
        AND NOT EXISTS (
          SELECT 1
          FROM private.tournament_result_action_logs AS undo_log
          WHERE undo_log.target_action_id = log.id
            AND undo_log.action_type = 'undo'
            AND undo_log.status IN ('pending', 'succeeded')
        ) AS can_undo
    FROM private.tournament_result_action_logs AS log
    JOIN public.tournament_admin_events AS event
      ON event.event_key = log.event_key

    UNION ALL

    SELECT
      log.id AS action_id,
      log.action_type,
      log.status,
      log.surface_key AS event_key,
      log.surface_display_name AS event_display_name,
      log.route_path,
      log.actor_user_id,
      log.actor_discord_user_id,
      log.actor_username,
      jsonb_build_array(jsonb_build_object(
        'range', log.surface_key || ':' || log.target_key,
        'before', jsonb_build_array(jsonb_build_array(CASE WHEN log.before_hidden THEN 'Hidden' ELSE 'Visible' END)),
        'after', jsonb_build_array(jsonb_build_array(CASE WHEN log.after_hidden THEN 'Hidden' ELSE 'Visible' END)),
        'playerName', log.player_name,
        'headers', jsonb_build_array(log.field_label)
      )) AS changes,
      log.target_action_id,
      NULL::text AS error_message,
      log.created_at,
      log.completed_at,
      log.undone_at,
      log.undone_by_action_id,
      log.action_type = 'visibility'
        AND log.status = 'succeeded'
        AND log.undone_by_action_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM private.admin_visibility_action_logs AS undo_log
          WHERE undo_log.target_action_id = log.id
        ) AS can_undo
    FROM private.admin_visibility_action_logs AS log

    UNION ALL

    SELECT
      log.id AS action_id,
      log.action_type,
      log.status,
      'season-configuration'::text AS event_key,
      'Season Configuration'::text AS event_display_name,
      '/admin/?section=season-configuration'::text AS route_path,
      log.actor_user_id,
      log.actor_discord_user_id,
      log.actor_username,
      log.changes,
      log.target_action_id,
      NULL::text AS error_message,
      log.created_at,
      log.completed_at,
      log.undone_at,
      log.undone_by_action_id,
      log.action_type = 'configuration'
        AND log.status = 'succeeded'
        AND log.undone_by_action_id IS NULL
        AND log.after_configuration = (
          SELECT jsonb_build_object(
            'rankedLeagueSeason', configuration.ranked_league_season,
            'shotgunProLeagueSeason', configuration.shotgun_pro_league_season,
            'shotgunProLeagueStage', configuration.shotgun_pro_league_stage,
            'superLeagueSeason', configuration.super_league_season
          )
          FROM public.season_configuration AS configuration
          WHERE configuration.id = 'current'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM private.season_configuration_action_logs AS newer_action
          WHERE newer_action.action_type = 'configuration'
            AND newer_action.undone_by_action_id IS NULL
            AND (newer_action.created_at, newer_action.id) > (log.created_at, log.id)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM private.season_configuration_action_logs AS undo_log
          WHERE undo_log.target_action_id = log.id
        ) AS can_undo
    FROM private.season_configuration_action_logs AS log
  ) AS combined
  ORDER BY combined.created_at DESC, combined.action_id DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_admin_action_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_action_logs(integer) TO authenticated;
