ALTER TABLE public.tournament_admin_events
ADD COLUMN editable_ranges text[] NOT NULL DEFAULT ARRAY[]::text[],
ADD COLUMN formula_ranges text[] NOT NULL DEFAULT ARRAY[]::text[],
ADD COLUMN editor_tables jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.tournament_admin_events
SET
  editable_ranges = ARRAY[
    '''Qualifiers''!K2:N16',
    '''Qualifiers''!P2:S16',
    '''Bracket''!C2:I16',
    '''Bracket''!K2:Q16'
  ],
  formula_ranges = ARRAY[
    '''Qualifiers''!J2:J16',
    '''Qualifiers''!O2:O16',
    '''Qualifiers''!T2:T16',
    '''Bracket''!B10:B16',
    '''Bracket''!J10:J16',
    '''Bracket''!R2:R16'
  ],
  editor_tables = $json$
  [
    {
      "key": "qualifier-bracket",
      "label": "Qualifier bracket",
      "source_range": "'Qualifiers'!H1:T16",
      "header_row": 1,
      "data_start_row": 2,
      "data_end_row": 16,
      "context_columns": ["H", "I", "T"],
      "players": [
        {
          "name_column": "J",
          "round_score_columns": ["K", "L", "M"],
          "result_column": "N"
        },
        {
          "name_column": "O",
          "round_score_columns": ["P", "Q", "R"],
          "result_column": "S"
        }
      ]
    },
    {
      "key": "main-bracket",
      "label": "Main bracket",
      "source_range": "'Bracket'!A1:R16",
      "header_row": 1,
      "data_start_row": 2,
      "data_end_row": 16,
      "context_columns": ["A", "R"],
      "players": [
        {
          "name_column": "B",
          "round_score_columns": ["C", "D", "E", "F", "G"],
          "sudden_death_column": "H",
          "result_column": "I"
        },
        {
          "name_column": "J",
          "round_score_columns": ["K", "L", "M", "N", "O"],
          "sudden_death_column": "P",
          "result_column": "Q"
        }
      ]
    }
  ]
  $json$::jsonb
WHERE event_key = 'masters';

UPDATE public.tournament_admin_events
SET
  editable_ranges = ARRAY[
    '''Bracket''!E3:N66',
    '''Bracket''!Q3:Z66'
  ],
  formula_ranges = ARRAY[
    '''Bracket''!C3:D66',
    '''Bracket''!O3:P66',
    '''Bracket''!AA3:AB66'
  ],
  editor_tables = $json$
  [
    {
      "key": "main-bracket",
      "label": "Main bracket",
      "source_range": "'Bracket'!A2:Z66",
      "header_row": 2,
      "data_start_row": 3,
      "data_end_row": 66,
      "context_columns": ["A", "B"],
      "players": [
        {
          "seed_column": "C",
          "name_column": "D",
          "round_score_columns": ["F", "G", "H", "I", "J", "K", "L", "M", "N"],
          "result_column": "E"
        },
        {
          "seed_column": "O",
          "name_column": "P",
          "round_score_columns": ["R", "S", "T", "U", "V", "W", "X", "Y", "Z"],
          "result_column": "Q"
        }
      ]
    }
  ]
  $json$::jsonb
WHERE event_key = 'championship';

ALTER TABLE public.tournament_admin_events
ADD CONSTRAINT tournament_admin_events_editable_ranges_check
  CHECK (cardinality(editable_ranges) > 0),
ADD CONSTRAINT tournament_admin_events_formula_ranges_check
  CHECK (cardinality(formula_ranges) > 0),
ADD CONSTRAINT tournament_admin_events_editor_tables_check
  CHECK (
    jsonb_typeof(editor_tables) = 'array'
    AND jsonb_array_length(editor_tables) > 0
  );

DROP FUNCTION public.get_tournament_admin_edit_context(text);
DROP FUNCTION public.authorize_tournament_result_edit(text);
DROP FUNCTION public.set_tournament_result_archived(text, boolean);

CREATE FUNCTION public.get_tournament_admin_edit_context(p_event_key text DEFAULT NULL)
RETURNS TABLE (
  event_key             text,
  display_name          text,
  route_path            text,
  sheet_id              text,
  source_ranges         text[],
  editable_ranges       text[],
  formula_ranges        text[],
  editor_tables         jsonb,
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
    event.editable_ranges,
    event.formula_ranges,
    event.editor_tables,
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
  event_key         text,
  sheet_id          text,
  source_ranges     text[],
  editable_ranges   text[]
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
    authorized_event.source_ranges,
    authorized_event.editable_ranges;
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
  editable_ranges       text[],
  formula_ranges        text[],
  editor_tables         jsonb,
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
    event.editable_ranges,
    event.formula_ranges,
    event.editor_tables,
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
