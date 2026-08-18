DROP INDEX private.tournament_result_action_logs_created_at_idx;
CREATE INDEX tournament_result_action_logs_created_at_idx
ON private.tournament_result_action_logs (created_at DESC, id DESC);

DROP INDEX private.admin_visibility_action_logs_created_at_idx;
CREATE INDEX admin_visibility_action_logs_created_at_idx
ON private.admin_visibility_action_logs (created_at DESC, id DESC);

DROP INDEX private.season_configuration_action_logs_created_at_idx;
CREATE INDEX season_configuration_action_logs_created_at_idx
ON private.season_configuration_action_logs (created_at DESC, id DESC);

DROP FUNCTION public.list_admin_action_logs(integer);

CREATE FUNCTION public.list_admin_action_logs(
  p_limit integer DEFAULT 50,
  p_before_created_at timestamp with time zone DEFAULT NULL,
  p_before_action_id uuid DEFAULT NULL
)
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

  IF (p_before_created_at IS NULL) <> (p_before_action_id IS NULL) THEN
    RAISE EXCEPTION 'Log cursor is incomplete.' USING ERRCODE = '22023';
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
      CASE
        WHEN log.action_type = 'undo' THEN (
          SELECT jsonb_agg(
            undo_change.value || jsonb_strip_nulls(jsonb_build_object(
              'playerName', target_change.value->'playerName',
              'headers', target_change.value->'headers'
            ))
            ORDER BY undo_change.ordinality
          )
          FROM jsonb_array_elements(log.changes) WITH ORDINALITY AS undo_change(value, ordinality)
          LEFT JOIN private.tournament_result_action_logs AS target_log
            ON target_log.id = log.target_action_id
          LEFT JOIN LATERAL (
            SELECT item.value
            FROM jsonb_array_elements(target_log.changes) AS item(value)
            WHERE item.value->>'range' = undo_change.value->>'range'
            LIMIT 1
          ) AS target_change ON true
        )
        ELSE log.changes
      END AS changes,
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
  WHERE p_before_created_at IS NULL
    OR (combined.created_at, combined.action_id) < (p_before_created_at, p_before_action_id)
  ORDER BY combined.created_at DESC, combined.action_id DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_admin_action_logs(integer, timestamp with time zone, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_action_logs(integer, timestamp with time zone, uuid)
TO authenticated;
