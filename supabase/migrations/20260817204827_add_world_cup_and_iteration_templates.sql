-- Year-aware editor templates are expanded by the Worker only after the matching
-- sheet tab is confirmed in the configured workbook.
UPDATE public.tournament_admin_events AS event
SET editor_tables = jsonb_build_array(jsonb_build_object(
  'kind', 'iteration-template',
  'sheet_pattern', '^(20\d{2}) Results$',
  'iteration_group', 1,
  'source_ranges', to_jsonb(ARRAY(
    SELECT replace(item, '''2026 Results''', '''{sheet}''')
    FROM unnest(event.source_ranges) AS item
  )),
  'editable_ranges', to_jsonb(ARRAY(
    SELECT replace(item, '''2026 Results''', '''{sheet}''')
    FROM unnest(event.editable_ranges) AS item
  )),
  'formula_ranges', to_jsonb(ARRAY(
    SELECT replace(item, '''2026 Results''', '''{sheet}''')
    FROM unnest(event.formula_ranges) AS item
  )),
  'tables', (
    SELECT jsonb_agg(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(table_config, '{source_range}', to_jsonb(replace(table_config->>'source_range', '''2026 Results''', '''{sheet}'''))),
              '{tab_key}', to_jsonb((table_config->>'group_key')::text)
            ),
            '{tab_label}', to_jsonb((table_config->>'group_label')::text)
          ),
          '{group_key}', '"worldopen-{iteration}"'::jsonb
        ),
        '{group_label}', '"{iteration}"'::jsonb
      ) || jsonb_build_object('season_value', '{iteration}', 'season_label', '{iteration}')
    )
    FROM jsonb_array_elements(event.editor_tables) AS table_config
  )
))
WHERE event.event_key = 'worldopen';

UPDATE public.tournament_admin_events AS event
SET editor_tables = jsonb_build_array(jsonb_build_object(
  'kind', 'iteration-template',
  'sheet_pattern', '^Round Scores \((20\d{2})\)$',
  'iteration_group', 1,
  'source_ranges', to_jsonb(ARRAY(
    SELECT replace(item, '''Round Scores (2026)''', '''{sheet}''')
    FROM unnest(event.source_ranges) AS item
  )),
  'editable_ranges', to_jsonb(ARRAY(
    SELECT replace(item, '''Round Scores (2026)''', '''{sheet}''')
    FROM unnest(event.editable_ranges) AS item
  )),
  'formula_ranges', to_jsonb(ARRAY(
    SELECT replace(item, '''Round Scores (2026)''', '''{sheet}''')
    FROM unnest(event.formula_ranges) AS item
  )),
  'tables', (
    SELECT jsonb_agg(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(table_config, '{source_range}', to_jsonb(replace(table_config->>'source_range', '''Round Scores (2026)''', '''{sheet}'''))),
              '{tab_key}', to_jsonb((table_config->>'group_key')::text)
            ),
            '{tab_label}', to_jsonb((table_config->>'group_label')::text)
          ),
          '{group_key}', '"noptational-{iteration}"'::jsonb
        ),
        '{group_label}', '"{iteration}"'::jsonb
      ) || jsonb_build_object('season_value', '{iteration}', 'season_label', '{iteration}')
    )
    FROM jsonb_array_elements(event.editor_tables) AS table_config
  )
))
WHERE event.event_key = 'noptational';

INSERT INTO public.tournament_admin_events (
  event_key,
  display_name,
  route_path,
  sheet_id,
  source_ranges,
  editable_ranges,
  formula_ranges,
  editor_tables,
  sort_order
)
VALUES (
  'worldcup',
  'World Cup',
  '/worldcup',
  '1hmxKPrk4LH7U0kK60N6yghYB898GyTG0Erg3NtsGWXk',
  ARRAY['''World Cup 2025''!A1:X120', '''World Cup 2024''!A1:X120'],
  ARRAY[
    '''World Cup 2025''!F3:H120', '''World Cup 2025''!K2:K120', '''World Cup 2025''!N2:N120',
    '''World Cup 2025''!Q2:Q120', '''World Cup 2025''!V2:V120', '''World Cup 2025''!X2:X120',
    '''World Cup 2024''!F3:H120', '''World Cup 2024''!K2:K120', '''World Cup 2024''!N2:N120',
    '''World Cup 2024''!Q2:Q120', '''World Cup 2024''!V2:V120', '''World Cup 2024''!X2:X120'
  ],
  ARRAY[
    '''World Cup 2025''!A1:E120', '''World Cup 2025''!I1:J120', '''World Cup 2025''!L1:M120',
    '''World Cup 2025''!O1:P120', '''World Cup 2025''!R1:U120', '''World Cup 2025''!W1:W120',
    '''World Cup 2024''!A1:E120', '''World Cup 2024''!I1:J120', '''World Cup 2024''!L1:M120',
    '''World Cup 2024''!O1:P120', '''World Cup 2024''!R1:U120', '''World Cup 2024''!W1:W120'
  ],
  $json$
  [
    {
      "kind":"iteration-template",
      "sheet_pattern":"^World Cup (20\\d{2})$",
      "iteration_group":1,
      "source_ranges":["'{sheet}'!A1:X120"],
      "editable_ranges":[
        "'{sheet}'!F3:H120", "'{sheet}'!K2:K120", "'{sheet}'!N2:N120",
        "'{sheet}'!Q2:Q120", "'{sheet}'!V2:V120", "'{sheet}'!X2:X120"
      ],
      "formula_ranges":[
        "'{sheet}'!A1:E120", "'{sheet}'!I1:J120", "'{sheet}'!L1:M120",
        "'{sheet}'!O1:P120", "'{sheet}'!R1:U120", "'{sheet}'!W1:W120"
      ],
      "tables":[
        {
          "key":"group-standings", "label":"Standings",
          "group_key":"worldcup-{iteration}", "group_label":"{iteration}",
          "tab_key":"group-stage", "tab_label":"Group Stage",
          "season_value":"{iteration}", "season_label":"{iteration}",
          "source_range":"'{sheet}'!A1:X120", "data_start_row":3, "data_end_row":120,
          "row_filter":{"column":"E", "nonempty":true, "exclude_pattern":"^Group\\s"},
          "hide_context":true, "hide_seed":true,
          "round_labels":["Points","Differential","Record"],
          "players":[{"name_column":"E", "round_score_columns":["F","G","H"]}]
        },
        {
          "key":"group-games-1", "label":"Group matches 1",
          "group_key":"worldcup-{iteration}", "group_label":"{iteration}",
          "tab_key":"group-stage", "tab_label":"Group Stage",
          "season_value":"{iteration}", "season_label":"{iteration}",
          "source_range":"'{sheet}'!A1:X120", "data_start_row":2, "data_end_row":120,
          "row_stride":3, "context_block":{"column":"E", "start_row":2, "block_size":6},
          "hide_seed":true, "matchup_layout":true, "round_labels":["Score"],
          "players":[
            {"name_column":"J", "round_score_columns":["K"]},
            {"name_column":"J", "round_score_columns":["K"], "row_offset":1}
          ]
        },
        {
          "key":"group-games-2", "label":"Group matches 2",
          "group_key":"worldcup-{iteration}", "group_label":"{iteration}",
          "tab_key":"group-stage", "tab_label":"Group Stage",
          "season_value":"{iteration}", "season_label":"{iteration}",
          "source_range":"'{sheet}'!A1:X120", "data_start_row":2, "data_end_row":120,
          "row_stride":3, "context_block":{"column":"E", "start_row":2, "block_size":6},
          "hide_seed":true, "matchup_layout":true, "round_labels":["Score"],
          "players":[
            {"name_column":"M", "round_score_columns":["N"]},
            {"name_column":"M", "round_score_columns":["N"], "row_offset":1}
          ]
        },
        {
          "key":"group-games-3", "label":"Group matches 3",
          "group_key":"worldcup-{iteration}", "group_label":"{iteration}",
          "tab_key":"group-stage", "tab_label":"Group Stage",
          "season_value":"{iteration}", "season_label":"{iteration}",
          "source_range":"'{sheet}'!A1:X120", "data_start_row":2, "data_end_row":120,
          "row_stride":3, "context_block":{"column":"E", "start_row":2, "block_size":6},
          "hide_seed":true, "matchup_layout":true, "round_labels":["Score"],
          "players":[
            {"name_column":"P", "round_score_columns":["Q"]},
            {"name_column":"P", "round_score_columns":["Q"], "row_offset":1}
          ]
        },
        {
          "key":"bracket", "label":"Bracket",
          "group_key":"worldcup-{iteration}", "group_label":"{iteration}",
          "tab_key":"bracket-stage", "tab_label":"Bracket",
          "season_value":"{iteration}", "season_label":"{iteration}",
          "source_range":"'{sheet}'!A1:X120", "data_start_row":2, "data_end_row":120,
          "row_filter":{"column":"T", "nonempty":true},
          "context_columns":["T"], "hide_seed":true, "matchup_layout":true,
          "players":[
            {"name_column":"U", "round_score_columns":[], "result_column":"V"},
            {"name_column":"W", "round_score_columns":[], "result_column":"X"}
          ]
        }
      ]
    }
  ]
  $json$::jsonb,
  80
)
ON CONFLICT (event_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    route_path = EXCLUDED.route_path,
    sheet_id = EXCLUDED.sheet_id,
    source_ranges = EXCLUDED.source_ranges,
    editable_ranges = EXCLUDED.editable_ranges,
    formula_ranges = EXCLUDED.formula_ranges,
    editor_tables = EXCLUDED.editor_tables,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

DROP FUNCTION public.authorize_tournament_result_edit(text);

CREATE FUNCTION public.authorize_tournament_result_edit(p_event_key text)
RETURNS TABLE (
  event_key         text,
  sheet_id          text,
  source_ranges     text[],
  editable_ranges   text[],
  formula_ranges    text[],
  editor_tables     jsonb
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
    authorized_event.editable_ranges,
    authorized_event.formula_ranges,
    authorized_event.editor_tables;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authorize_tournament_result_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_tournament_result_edit(text) TO authenticated;
