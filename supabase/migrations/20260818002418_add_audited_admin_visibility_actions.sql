CREATE TABLE private.admin_visibility_action_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type           text NOT NULL,
  status                text NOT NULL DEFAULT 'succeeded',
  surface_key           text NOT NULL,
  surface_display_name  text NOT NULL,
  route_path            text NOT NULL,
  actor_user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_discord_user_id text NOT NULL,
  actor_username        text NOT NULL,
  target_key            text NOT NULL,
  player_name           text NOT NULL,
  field_label           text NOT NULL,
  before_hidden         boolean NOT NULL,
  after_hidden          boolean NOT NULL,
  target_action_id      uuid REFERENCES private.admin_visibility_action_logs(id) ON DELETE RESTRICT,
  created_at            timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  completed_at          timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  undone_at             timestamp with time zone,
  undone_by_action_id   uuid REFERENCES private.admin_visibility_action_logs(id) ON DELETE RESTRICT,
  CONSTRAINT admin_visibility_action_logs_action_type_check
    CHECK (action_type IN ('visibility', 'undo')),
  CONSTRAINT admin_visibility_action_logs_status_check
    CHECK (status = 'succeeded'),
  CONSTRAINT admin_visibility_action_logs_surface_check
    CHECK (surface_key IN ('championship-qualifiers', 'gpi', 'global-ranks')),
  CONSTRAINT admin_visibility_action_logs_change_check
    CHECK (before_hidden IS DISTINCT FROM after_hidden),
  CONSTRAINT admin_visibility_action_logs_target_check
    CHECK (
      (action_type = 'visibility' AND target_action_id IS NULL)
      OR (action_type = 'undo' AND target_action_id IS NOT NULL)
    ),
  CONSTRAINT admin_visibility_action_logs_undone_check
    CHECK (
      (undone_by_action_id IS NULL AND undone_at IS NULL)
      OR (undone_by_action_id IS NOT NULL AND undone_at IS NOT NULL)
    )
);

ALTER TABLE private.admin_visibility_action_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.admin_visibility_action_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.admin_visibility_action_logs TO service_role;

CREATE INDEX admin_visibility_action_logs_created_at_idx
ON private.admin_visibility_action_logs (created_at DESC);

CREATE UNIQUE INDEX admin_visibility_action_logs_active_undo_idx
ON private.admin_visibility_action_logs (target_action_id)
WHERE action_type = 'undo';

CREATE FUNCTION private.require_admin_actor()
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
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL OR NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    actor_id,
    identity.provider_id,
    COALESCE(
      NULLIF(member.display_name, ''),
      NULLIF(member.username, ''),
      NULLIF(identity.identity_data->>'full_name', ''),
      NULLIF(identity.identity_data->>'name', ''),
      identity.provider_id
    )
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discord identity is required.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.require_admin_actor() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.apply_admin_visibility(
  p_surface_key text,
  p_target_key text,
  p_hidden boolean,
  p_actor_user_id uuid,
  p_actor_username text
)
RETURNS TABLE (
  surface_display_name text,
  route_path text,
  player_name text,
  field_label text,
  previous_hidden boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clean_surface text := btrim(COALESCE(p_surface_key, ''));
  clean_target text := btrim(COALESCE(p_target_key, ''));
  target_discord_id text;
  target_rank_key text;
  prior_hidden boolean;
  resolved_player_name text;
  resolved_surface_name text;
  resolved_route_path text;
  resolved_field_label text;
  championship_keys text[];
BEGIN
  IF p_hidden IS NULL OR p_actor_user_id IS NULL OR COALESCE(length(p_actor_username), 0) = 0 THEN
    RAISE EXCEPTION 'Visibility state and admin identity are required.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(clean_surface || ':' || clean_target, 0)
  );

  CASE clean_surface
    WHEN 'championship-qualifiers' THEN
      IF clean_target !~ '^(id:[0-9]{5,}|name:.+)$' THEN
        RAISE EXCEPTION 'Invalid Championship player key.' USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.championship_point_settings (id, updated_by_user_id)
      VALUES ('current', p_actor_user_id)
      ON CONFLICT (id) DO NOTHING;

      SELECT settings.hidden_player_keys
      INTO championship_keys
      FROM public.championship_point_settings AS settings
      WHERE settings.id = 'current'
      FOR UPDATE;

      prior_hidden := clean_target = ANY(championship_keys);
      IF prior_hidden = p_hidden THEN
        RAISE EXCEPTION 'Championship player visibility is already unchanged.' USING ERRCODE = '55000';
      END IF;

      UPDATE public.championship_point_settings AS settings
      SET
        hidden_player_keys = CASE
          WHEN p_hidden THEN pg_catalog.array_append(settings.hidden_player_keys, clean_target)
          ELSE pg_catalog.array_remove(settings.hidden_player_keys, clean_target)
        END,
        updated_by_user_id = p_actor_user_id
      WHERE settings.id = 'current';

      target_discord_id := CASE WHEN clean_target LIKE 'id:%' THEN substring(clean_target FROM 4) ELSE '' END;
      SELECT COALESCE(NULLIF(member.display_name, ''), NULLIF(member.username, ''))
      INTO resolved_player_name
      FROM public.discord_guild_members AS member
      WHERE member.discord_user_id = target_discord_id
      ORDER BY member.is_current_member DESC, member.updated_at DESC
      LIMIT 1;
      resolved_player_name := COALESCE(
        resolved_player_name,
        CASE WHEN clean_target LIKE 'name:%' THEN substring(clean_target FROM 6) ELSE target_discord_id END,
        clean_target
      );
      resolved_surface_name := 'Championship Qualifiers';
      resolved_route_path := '/championship.html?view=leaderboard&qualifier=tournaments';
      resolved_field_label := 'Hide';

    WHEN 'gpi' THEN
      IF clean_target !~ '^[0-9]{5,}$' THEN
        RAISE EXCEPTION 'Invalid GPI player ID.' USING ERRCODE = '22023';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.gpi_hidden_players AS hidden
        WHERE hidden.discord_user_id = clean_target
      ) INTO prior_hidden;
      IF prior_hidden = p_hidden THEN
        RAISE EXCEPTION 'GPI player visibility is already unchanged.' USING ERRCODE = '55000';
      END IF;

      IF p_hidden THEN
        INSERT INTO public.gpi_hidden_players (
          discord_user_id,
          hidden_at,
          hidden_by_user_id,
          hidden_by_username
        ) VALUES (
          clean_target,
          statement_timestamp(),
          p_actor_user_id,
          p_actor_username
        );
      ELSE
        DELETE FROM public.gpi_hidden_players AS hidden
        WHERE hidden.discord_user_id = clean_target;
      END IF;

      SELECT COALESCE(NULLIF(member.display_name, ''), NULLIF(member.username, ''))
      INTO resolved_player_name
      FROM public.discord_guild_members AS member
      WHERE member.discord_user_id = clean_target
      ORDER BY member.is_current_member DESC, member.updated_at DESC
      LIMIT 1;
      resolved_player_name := COALESCE(resolved_player_name, clean_target);
      resolved_surface_name := 'GPI';
      resolved_route_path := '/gpi.html';
      resolved_field_label := 'Hide';

    WHEN 'global-ranks' THEN
      target_discord_id := split_part(clean_target, ':', 1);
      target_rank_key := substring(clean_target FROM length(target_discord_id) + 2);
      IF target_discord_id !~ '^[0-9]{5,}$'
        OR target_rank_key NOT IN ('current_global_rank', 'max_global_rank_no_cs', 'max_global_rank_cs')
      THEN
        RAISE EXCEPTION 'Invalid global-rank visibility target.' USING ERRCODE = '22023';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.player_global_rank_moderation AS hidden
        WHERE hidden.discord_user_id = target_discord_id
          AND hidden.rank_key = target_rank_key
      ) INTO prior_hidden;
      IF prior_hidden = p_hidden THEN
        RAISE EXCEPTION 'Global-rank visibility is already unchanged.' USING ERRCODE = '55000';
      END IF;

      IF p_hidden THEN
        INSERT INTO public.player_global_rank_moderation (
          discord_user_id,
          rank_key,
          hidden_at,
          hidden_by_user_id,
          hidden_by_username
        ) VALUES (
          target_discord_id,
          target_rank_key,
          statement_timestamp(),
          p_actor_user_id,
          p_actor_username
        );
      ELSE
        DELETE FROM public.player_global_rank_moderation AS hidden
        WHERE hidden.discord_user_id = target_discord_id
          AND hidden.rank_key = target_rank_key;
      END IF;

      SELECT COALESCE(NULLIF(member.display_name, ''), NULLIF(member.username, ''))
      INTO resolved_player_name
      FROM public.discord_guild_members AS member
      WHERE member.discord_user_id = target_discord_id
      ORDER BY member.is_current_member DESC, member.updated_at DESC
      LIMIT 1;
      resolved_player_name := COALESCE(resolved_player_name, target_discord_id);
      resolved_surface_name := 'Global Ranks';
      resolved_route_path := '/records.html';
      resolved_field_label := CASE target_rank_key
        WHEN 'current_global_rank' THEN 'Current Rank visibility'
        WHEN 'max_global_rank_no_cs' THEN 'Max. Rank (no cloud saves) visibility'
        WHEN 'max_global_rank_cs' THEN 'Max. Rank (with cloud saves) visibility'
      END;

    ELSE
      RAISE EXCEPTION 'Unsupported admin visibility surface.' USING ERRCODE = '22023';
  END CASE;

  RETURN QUERY SELECT
    resolved_surface_name,
    resolved_route_path,
    resolved_player_name,
    resolved_field_label,
    prior_hidden;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.apply_admin_visibility(text, text, boolean, uuid, text)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_admin_visibility(
  p_surface_key text,
  p_target_key text,
  p_hidden boolean
)
RETURNS TABLE (
  action_id uuid,
  hidden boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
  visibility record;
  inserted_action private.admin_visibility_action_logs%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM private.require_admin_actor();
  SELECT * INTO visibility
  FROM private.apply_admin_visibility(
    p_surface_key,
    p_target_key,
    p_hidden,
    actor.actor_user_id,
    actor.actor_username
  );

  INSERT INTO private.admin_visibility_action_logs (
    action_type,
    surface_key,
    surface_display_name,
    route_path,
    actor_user_id,
    actor_discord_user_id,
    actor_username,
    target_key,
    player_name,
    field_label,
    before_hidden,
    after_hidden
  ) VALUES (
    'visibility',
    p_surface_key,
    visibility.surface_display_name,
    visibility.route_path,
    actor.actor_user_id,
    actor.actor_discord_user_id,
    actor.actor_username,
    p_target_key,
    visibility.player_name,
    visibility.field_label,
    visibility.previous_hidden,
    p_hidden
  )
  RETURNING * INTO inserted_action;

  RETURN QUERY SELECT inserted_action.id, inserted_action.after_hidden;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_admin_visibility(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_visibility(text, text, boolean) TO authenticated;

CREATE FUNCTION public.undo_admin_visibility_action(p_action_id uuid)
RETURNS TABLE (
  action_id uuid,
  hidden boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor record;
  target_action private.admin_visibility_action_logs%ROWTYPE;
  visibility record;
  undo_action private.admin_visibility_action_logs%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM private.require_admin_actor();

  SELECT log.*
  INTO target_action
  FROM private.admin_visibility_action_logs AS log
  WHERE log.id = p_action_id
  FOR UPDATE;

  IF NOT FOUND
    OR target_action.action_type <> 'visibility'
    OR target_action.status <> 'succeeded'
    OR target_action.undone_by_action_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM private.admin_visibility_action_logs AS prior_undo
      WHERE prior_undo.target_action_id = target_action.id
    )
  THEN
    RAISE EXCEPTION 'This visibility change cannot be undone.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO visibility
  FROM private.apply_admin_visibility(
    target_action.surface_key,
    target_action.target_key,
    target_action.before_hidden,
    actor.actor_user_id,
    actor.actor_username
  );

  IF visibility.previous_hidden IS DISTINCT FROM target_action.after_hidden THEN
    RAISE EXCEPTION 'Visibility changed after this action and cannot be safely undone.' USING ERRCODE = '55000';
  END IF;

  INSERT INTO private.admin_visibility_action_logs (
    action_type,
    surface_key,
    surface_display_name,
    route_path,
    actor_user_id,
    actor_discord_user_id,
    actor_username,
    target_key,
    player_name,
    field_label,
    before_hidden,
    after_hidden,
    target_action_id
  ) VALUES (
    'undo',
    target_action.surface_key,
    target_action.surface_display_name,
    target_action.route_path,
    actor.actor_user_id,
    actor.actor_discord_user_id,
    actor.actor_username,
    target_action.target_key,
    target_action.player_name,
    target_action.field_label,
    target_action.after_hidden,
    target_action.before_hidden,
    target_action.id
  )
  RETURNING * INTO undo_action;

  UPDATE private.admin_visibility_action_logs AS original
  SET
    undone_at = statement_timestamp(),
    undone_by_action_id = undo_action.id
  WHERE original.id = target_action.id;

  RETURN QUERY SELECT undo_action.id, undo_action.after_hidden;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'This visibility change has already been undone.' USING ERRCODE = '55000';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.undo_admin_visibility_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_admin_visibility_action(uuid) TO authenticated;

CREATE FUNCTION public.save_championship_point_values(p_settings jsonb)
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
  IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Championship point settings must be an object.' USING ERRCODE = '22023';
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

REVOKE EXECUTE ON FUNCTION public.save_championship_point_values(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_championship_point_values(jsonb) TO authenticated;

CREATE FUNCTION public.list_admin_action_logs(p_limit integer DEFAULT 100)
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
  ) AS combined
  ORDER BY combined.created_at DESC, combined.action_id DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_admin_action_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_action_logs(integer) TO authenticated;

REVOKE ALL ON TABLE public.championship_point_settings FROM anon, authenticated;
GRANT SELECT ON TABLE public.championship_point_settings TO anon, authenticated;
REVOKE ALL ON TABLE public.gpi_hidden_players FROM anon, authenticated;
GRANT SELECT ON TABLE public.gpi_hidden_players TO anon, authenticated;
REVOKE ALL ON TABLE public.player_global_rank_moderation FROM anon, authenticated;
GRANT SELECT ON TABLE public.player_global_rank_moderation TO anon, authenticated;
