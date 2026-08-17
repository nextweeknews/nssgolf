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

CREATE POLICY "public can read tournament editor configuration"
ON public.tournament_admin_events
FOR SELECT
TO anon
USING (true);

CREATE FUNCTION public.get_tournament_editor_read_context(p_event_key text)
RETURNS TABLE (
  event_key       text,
  display_name    text,
  route_path      text,
  sheet_id        text,
  source_ranges   text[],
  editable_ranges text[],
  formula_ranges  text[],
  editor_tables   jsonb,
  edit_enabled    boolean,
  archived        boolean,
  can_edit        boolean,
  archived_at     timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    event.event_key,
    event.display_name,
    event.route_path,
    event.sheet_id,
    event.source_ranges,
    event.editable_ranges,
    event.formula_ranges,
    event.editor_tables,
    event.edit_enabled,
    event.archived,
    event.edit_enabled AND NOT event.archived,
    event.archived_at
  FROM public.tournament_admin_events AS event
  WHERE event.event_key = p_event_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown tournament editor event: %', p_event_key USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tournament_editor_read_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_editor_read_context(text) TO anon, authenticated;
