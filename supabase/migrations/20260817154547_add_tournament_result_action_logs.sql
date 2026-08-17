CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE private.tournament_result_action_logs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type             text NOT NULL,
  status                  text NOT NULL DEFAULT 'pending',
  event_key               text NOT NULL REFERENCES public.tournament_admin_events(event_key),
  event_display_name      text NOT NULL,
  route_path              text NOT NULL,
  actor_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_discord_user_id   text NOT NULL,
  actor_username          text NOT NULL,
  changes                 jsonb NOT NULL,
  target_action_id        uuid REFERENCES private.tournament_result_action_logs(id) ON DELETE RESTRICT,
  error_message           text,
  created_at              timestamp with time zone NOT NULL DEFAULT statement_timestamp(),
  completed_at            timestamp with time zone,
  undone_at               timestamp with time zone,
  undone_by_action_id     uuid REFERENCES private.tournament_result_action_logs(id) ON DELETE RESTRICT,
  CONSTRAINT tournament_result_action_logs_action_type_check
    CHECK (action_type IN ('edit', 'undo')),
  CONSTRAINT tournament_result_action_logs_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT tournament_result_action_logs_changes_check
    CHECK (jsonb_typeof(changes) = 'array' AND jsonb_array_length(changes) > 0),
  CONSTRAINT tournament_result_action_logs_target_check
    CHECK (
      (action_type = 'edit' AND target_action_id IS NULL)
      OR (action_type = 'undo' AND target_action_id IS NOT NULL)
    ),
  CONSTRAINT tournament_result_action_logs_completion_check
    CHECK (
      (status = 'pending' AND completed_at IS NULL)
      OR (status <> 'pending' AND completed_at IS NOT NULL)
    ),
  CONSTRAINT tournament_result_action_logs_error_check
    CHECK (
      (status = 'failed' AND error_message IS NOT NULL)
      OR (status <> 'failed' AND error_message IS NULL)
    ),
  CONSTRAINT tournament_result_action_logs_undone_check
    CHECK (
      (undone_by_action_id IS NULL AND undone_at IS NULL)
      OR (undone_by_action_id IS NOT NULL AND undone_at IS NOT NULL)
    )
);

ALTER TABLE private.tournament_result_action_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.tournament_result_action_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.tournament_result_action_logs TO service_role;

CREATE INDEX tournament_result_action_logs_created_at_idx
ON private.tournament_result_action_logs (created_at DESC);

CREATE INDEX tournament_result_action_logs_event_created_at_idx
ON private.tournament_result_action_logs (event_key, created_at DESC);

CREATE UNIQUE INDEX tournament_result_action_logs_active_undo_idx
ON private.tournament_result_action_logs (target_action_id)
WHERE action_type = 'undo' AND status IN ('pending', 'succeeded');

CREATE UNIQUE INDEX tournament_result_action_logs_pending_event_idx
ON private.tournament_result_action_logs (event_key)
WHERE status = 'pending';

CREATE FUNCTION public.create_tournament_result_action_log(
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
  actor_id uuid := auth.uid();
  actor_discord_id text;
  actor_name text;
  event_record public.tournament_admin_events%ROWTYPE;
  target_record private.tournament_result_action_logs%ROWTYPE;
  log_changes jsonb;
  inserted_record private.tournament_result_action_logs%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
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

REVOKE EXECUTE ON FUNCTION public.create_tournament_result_action_log(text, text, jsonb, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tournament_result_action_log(text, text, jsonb, uuid)
TO authenticated;

CREATE FUNCTION public.set_tournament_result_action_log_changes(
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
  actor_id uuid := auth.uid();
  updated_record private.tournament_result_action_logs%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
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

REVOKE EXECUTE ON FUNCTION public.set_tournament_result_action_log_changes(uuid, jsonb)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tournament_result_action_log_changes(uuid, jsonb)
TO authenticated;

CREATE FUNCTION public.complete_tournament_result_action_log(
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
  actor_id uuid := auth.uid();
  completed_record private.tournament_result_action_logs%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
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

REVOKE EXECUTE ON FUNCTION public.complete_tournament_result_action_log(uuid, boolean, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_tournament_result_action_log(uuid, boolean, text)
TO authenticated;

CREATE FUNCTION public.get_tournament_result_action_for_undo(p_action_id uuid)
RETURNS TABLE (
  action_id uuid,
  event_key text,
  sheet_id text,
  editable_ranges text[],
  changes jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    log.id,
    log.event_key,
    event.sheet_id,
    event.editable_ranges,
    log.changes
  FROM private.tournament_result_action_logs AS log
  JOIN public.tournament_admin_events AS event
    ON event.event_key = log.event_key
  WHERE log.id = p_action_id
    AND log.action_type = 'edit'
    AND log.status = 'succeeded'
    AND log.undone_by_action_id IS NULL
    AND event.edit_enabled
    AND NOT event.archived;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This tournament edit cannot be undone.' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tournament_result_action_for_undo(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_result_action_for_undo(uuid)
TO authenticated;

CREATE FUNCTION public.list_tournament_result_action_logs(p_limit integer DEFAULT 100)
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
  IF auth.uid() IS NULL OR NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Log limit must be between 1 and 200.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    log.id,
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
  ORDER BY log.created_at DESC, log.id DESC
  LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_tournament_result_action_logs(integer)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tournament_result_action_logs(integer)
TO authenticated;
