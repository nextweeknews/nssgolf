CREATE TABLE public.tournament_admin_events (
  event_key                   text PRIMARY KEY,
  display_name                text NOT NULL,
  route_path                  text NOT NULL UNIQUE,
  sheet_id                    text NOT NULL,
  source_ranges               text[] NOT NULL,
  sort_order                  integer NOT NULL DEFAULT 0,
  edit_enabled                boolean NOT NULL DEFAULT true,
  archived                    boolean NOT NULL DEFAULT false,
  archived_at                 timestamp with time zone,
  archived_by_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at                  timestamp with time zone NOT NULL DEFAULT now(),
  updated_by_user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tournament_admin_events_event_key_check
    CHECK (event_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT tournament_admin_events_route_path_check
    CHECK (route_path ~ '^/[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT tournament_admin_events_sheet_id_check
    CHECK (sheet_id ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT tournament_admin_events_source_ranges_check
    CHECK (cardinality(source_ranges) > 0),
  CONSTRAINT tournament_admin_events_archive_audit_check
    CHECK ((archived AND archived_at IS NOT NULL) OR (NOT archived AND archived_at IS NULL))
);

ALTER TABLE public.tournament_admin_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tournament_admin_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tournament_admin_events TO authenticated;
GRANT UPDATE (archived) ON TABLE public.tournament_admin_events TO authenticated;
GRANT ALL ON TABLE public.tournament_admin_events TO service_role;

CREATE FUNCTION public.is_tournament_result_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM auth.identities AS identity
      JOIN public.discord_member_roles AS member_role
        ON member_role.discord_user_id = identity.provider_id
      WHERE identity.user_id = (SELECT auth.uid())
        AND identity.provider = 'discord'
        AND member_role.role_id = '1069007873985740890'
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_tournament_result_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tournament_result_admin() TO authenticated;

CREATE POLICY "tournament result admins can view edit events"
ON public.tournament_admin_events
FOR SELECT
TO authenticated
USING ((SELECT public.is_tournament_result_admin()));

CREATE POLICY "tournament result admins can archive edit events"
ON public.tournament_admin_events
FOR UPDATE
TO authenticated
USING ((SELECT public.is_tournament_result_admin()))
WITH CHECK ((SELECT public.is_tournament_result_admin()));

CREATE FUNCTION public.set_tournament_admin_event_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  NEW.updated_by_user_id := auth.uid();

  IF NEW.archived IS DISTINCT FROM OLD.archived THEN
    NEW.archived_at := CASE WHEN NEW.archived THEN statement_timestamp() ELSE NULL END;
    NEW.archived_by_user_id := CASE WHEN NEW.archived THEN auth.uid() ELSE NULL END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_tournament_admin_event_audit() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER set_tournament_admin_event_audit
BEFORE UPDATE ON public.tournament_admin_events
FOR EACH ROW
EXECUTE FUNCTION public.set_tournament_admin_event_audit();

INSERT INTO public.tournament_admin_events (
  event_key,
  display_name,
  route_path,
  sheet_id,
  source_ranges,
  sort_order
)
VALUES
  (
    'masters',
    'World Golf Masters',
    '/masters',
    '16r1G1StlWQflPjAqFbHip_Y3hRo85F6iS3jYyK25CwE',
    ARRAY['''Qualifiers''!A:T', '''Bracket''!A1:R16', '''Discord IDs''!A:B'],
    10
  ),
  (
    'championship',
    'World Championship',
    '/championship',
    '10nVyu3uM_PbK6fDgmomtjlHakNJ1oIM66MRXXHX3k_Q',
    ARRAY['''Field''!B:C', '''Bracket''!A:Z'],
    20
  );

CREATE FUNCTION public.get_tournament_admin_edit_context(p_event_key text DEFAULT NULL)
RETURNS TABLE (
  event_key             text,
  display_name          text,
  route_path            text,
  sheet_id              text,
  source_ranges         text[],
  edit_enabled          boolean,
  archived              boolean,
  can_edit              boolean,
  archived_at           timestamp with time zone,
  archived_by_user_id   uuid,
  updated_at            timestamp with time zone,
  updated_by_user_id    uuid
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    event.event_key,
    event.display_name,
    event.route_path,
    event.sheet_id,
    event.source_ranges,
    event.edit_enabled,
    event.archived,
    event.edit_enabled AND NOT event.archived,
    event.archived_at,
    event.archived_by_user_id,
    event.updated_at,
    event.updated_by_user_id
  FROM public.tournament_admin_events AS event
  WHERE p_event_key IS NULL OR event.event_key = p_event_key
  ORDER BY event.sort_order, event.display_name;

  IF p_event_key IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'Unknown tournament admin event: %', p_event_key USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tournament_admin_edit_context(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_admin_edit_context(text) TO authenticated;

CREATE FUNCTION public.authorize_tournament_result_edit(p_event_key text)
RETURNS TABLE (
  event_key       text,
  sheet_id        text,
  source_ranges   text[]
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  authorized_event public.tournament_admin_events%ROWTYPE;
BEGIN
  IF NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  SELECT event.*
  INTO authorized_event
  FROM public.tournament_admin_events AS event
  WHERE event.event_key = p_event_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown tournament admin event: %', p_event_key USING ERRCODE = '22023';
  END IF;

  IF NOT authorized_event.edit_enabled THEN
    RAISE EXCEPTION 'Tournament result editing is disabled for %.', p_event_key
      USING ERRCODE = '55000';
  END IF;

  IF authorized_event.archived THEN
    RAISE EXCEPTION 'Tournament result editing is archived for %.', p_event_key
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT
    authorized_event.event_key,
    authorized_event.sheet_id,
    authorized_event.source_ranges;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authorize_tournament_result_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_tournament_result_edit(text) TO authenticated;

CREATE FUNCTION public.set_tournament_result_archived(p_event_key text, p_archived boolean)
RETURNS TABLE (
  event_key             text,
  display_name          text,
  route_path            text,
  sheet_id              text,
  source_ranges         text[],
  edit_enabled          boolean,
  archived              boolean,
  can_edit              boolean,
  archived_at           timestamp with time zone,
  archived_by_user_id   uuid,
  updated_at            timestamp with time zone,
  updated_by_user_id    uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_event_key IS NULL OR p_archived IS NULL THEN
    RAISE EXCEPTION 'Event key and archived state are required.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.tournament_admin_events AS event
  SET archived = p_archived
  WHERE event.event_key = p_event_key
  RETURNING
    event.event_key,
    event.display_name,
    event.route_path,
    event.sheet_id,
    event.source_ranges,
    event.edit_enabled,
    event.archived,
    event.edit_enabled AND NOT event.archived,
    event.archived_at,
    event.archived_by_user_id,
    event.updated_at,
    event.updated_by_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown tournament admin event: %', p_event_key USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_tournament_result_archived(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tournament_result_archived(text, boolean) TO authenticated;
