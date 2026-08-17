UPDATE public.tournament_admin_events AS event
SET source_ranges = ARRAY[
      '''2026 Results''!A1:F65', '''2026 Results''!H1:M33', '''2026 Results''!O1:T33',
      '''2026 Results''!V1:AA17', '''2026 Results''!AC1:AH9', '''2026 Results''!AJ1:AO5',
      '''2026 Results''!AQ1:AV3'
    ],
    editable_ranges = ARRAY[
      '''2026 Results''!C2:D33', '''2026 Results''!E2:F33',
      '''2026 Results''!J2:K17', '''2026 Results''!L2:M17',
      '''2026 Results''!Q2:R17', '''2026 Results''!S2:T17',
      '''2026 Results''!X2:Y9', '''2026 Results''!Z2:AA9',
      '''2026 Results''!AE2:AF5', '''2026 Results''!AG2:AH5',
      '''2026 Results''!AL2:AM3', '''2026 Results''!AN2:AO3',
      '''2026 Results''!AS2:AT2', '''2026 Results''!AU2:AV2'
    ],
    formula_ranges = ARRAY[
      '''2026 Results''!A2:A65', '''2026 Results''!H2:H33', '''2026 Results''!O2:O33',
      '''2026 Results''!V2:V17', '''2026 Results''!AC2:AC9', '''2026 Results''!AJ2:AJ5',
      '''2026 Results''!AQ2:AQ3', '''2026 Results''!AX2'
    ],
    editor_tables = (
      SELECT jsonb_agg(
        template || jsonb_build_object(
          'source_ranges', $json$[
            "'{sheet}'!A1:F65", "'{sheet}'!H1:M33", "'{sheet}'!O1:T33",
            "'{sheet}'!V1:AA17", "'{sheet}'!AC1:AH9", "'{sheet}'!AJ1:AO5",
            "'{sheet}'!AQ1:AV3"
          ]$json$::jsonb,
          'editable_ranges', $json$[
            "'{sheet}'!C2:D33", "'{sheet}'!E2:F33",
            "'{sheet}'!J2:K17", "'{sheet}'!L2:M17",
            "'{sheet}'!Q2:R17", "'{sheet}'!S2:T17",
            "'{sheet}'!X2:Y9", "'{sheet}'!Z2:AA9",
            "'{sheet}'!AE2:AF5", "'{sheet}'!AG2:AH5",
            "'{sheet}'!AL2:AM3", "'{sheet}'!AN2:AO3",
            "'{sheet}'!AS2:AT2", "'{sheet}'!AU2:AV2"
          ]$json$::jsonb,
          'formula_ranges', $json$[
            "'{sheet}'!A2:A65", "'{sheet}'!H2:H33", "'{sheet}'!O2:O33",
            "'{sheet}'!V2:V17", "'{sheet}'!AC2:AC9", "'{sheet}'!AJ2:AJ5",
            "'{sheet}'!AQ2:AQ3", "'{sheet}'!AX2"
          ]$json$::jsonb,
          'tables', (
            SELECT jsonb_agg(
              table_config || jsonb_build_object(
                'source_range', CASE table_config->>'key'
                  WHEN 'round-1' THEN '''{sheet}''!A1:F65'
                  WHEN 'round-2' THEN '''{sheet}''!H1:M33'
                  WHEN 'round-3' THEN '''{sheet}''!O1:T33'
                  WHEN 'round-4' THEN '''{sheet}''!V1:AA17'
                  WHEN 'round-5' THEN '''{sheet}''!AC1:AH9'
                  WHEN 'round-6' THEN '''{sheet}''!AJ1:AO5'
                  WHEN 'round-7' THEN '''{sheet}''!AQ1:AV3'
                END,
                'player_options', CASE table_config->>'key'
                  WHEN 'round-1' THEN '{"column":"A","start_row":2,"end_row":65}'::jsonb
                  WHEN 'round-2' THEN '{"column":"H","start_row":2,"end_row":33}'::jsonb
                  WHEN 'round-3' THEN '{"column":"O","start_row":2,"end_row":33}'::jsonb
                  WHEN 'round-4' THEN '{"column":"V","start_row":2,"end_row":17}'::jsonb
                  WHEN 'round-5' THEN '{"column":"AC","start_row":2,"end_row":9}'::jsonb
                  WHEN 'round-6' THEN '{"column":"AJ","start_row":2,"end_row":5}'::jsonb
                  WHEN 'round-7' THEN '{"column":"AQ","start_row":2,"end_row":3}'::jsonb
                END,
                'players', (
                  SELECT jsonb_agg(player_config || '{"editable_name":true}'::jsonb)
                  FROM jsonb_array_elements(table_config->'players') AS player_config
                )
              )
            )
            FROM jsonb_array_elements(template->'tables') AS table_config
          )
        )
      )
      FROM jsonb_array_elements(event.editor_tables) AS template
    ),
    updated_at = now()
WHERE event.event_key = 'worldopen';

UPDATE public.tournament_admin_events AS event
SET editor_tables = (
  SELECT jsonb_agg(
    CASE
      WHEN template->>'kind' = 'iteration-template' THEN
        jsonb_set(
          template,
          '{tables}',
          (
            SELECT jsonb_agg(
              CASE
                WHEN table_config->>'key' = 'group-standings' THEN
                  jsonb_set(
                    table_config,
                    '{context_block}',
                    '{"column":"E","start_row":2,"block_size":6}'::jsonb
                  )
                ELSE table_config
              END
            )
            FROM jsonb_array_elements(template->'tables') AS table_config
          )
        )
      ELSE template
    END
  )
  FROM jsonb_array_elements(event.editor_tables) AS template
), updated_at = now()
WHERE event.event_key = 'worldcup';

UPDATE public.tournament_admin_events AS event
SET editor_tables = (
  SELECT jsonb_agg(
    CASE
      WHEN template->>'kind' = 'iteration-template' THEN
        jsonb_set(
          template,
          '{tables}',
          $json$
          [
            {
              "key":"scores", "label":"Scores",
              "group_key":"noptational-{iteration}", "group_label":"{iteration}",
              "season_value":"{iteration}", "season_label":"{iteration}",
              "source_range":"'{sheet}'!A1:J72", "data_start_row":2, "data_end_row":72,
              "hide_context":true, "hide_seed":true,
              "header_groups":[
                {"label":"Classic","span":2},
                {"label":"Resort","span":2},
                {"label":"Specials","span":3},
                {"label":"18 Holes","span":2}
              ],
              "round_labels":["1","2","1","2","1","2","3","1","2"],
              "players":[{"name_column":"A","round_score_columns":["B","C","D","E","F","G","H","I","J"]}]
            }
          ]
          $json$::jsonb
        )
      ELSE template
    END
  )
  FROM jsonb_array_elements(event.editor_tables) AS template
), updated_at = now()
WHERE event.event_key = 'noptational';
