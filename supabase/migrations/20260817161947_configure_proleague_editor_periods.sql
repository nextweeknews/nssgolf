DO $$
<<registry>>
DECLARE
  source_ranges text[] := ARRAY[]::text[];
  editable_ranges text[] := ARRAY[]::text[];
  formula_ranges text[] := ARRAY[]::text[];
  editor_tables jsonb := '[]'::jsonb;
  season_num integer;
  stage_num integer;
  team_end_row integer;
  solo_start_row integer;
  header_row integer;
  excluded_rows integer[];
  sheet_name text;
  sheet_ref text;
  group_key text;
BEGIN
  source_ranges := array_append(source_ranges, '''2026 All-Stars''!B3:G35');
  editable_ranges := array_append(editable_ranges, '''2026 All-Stars''!D4:G35');
  formula_ranges := array_append(formula_ranges, '''2026 All-Stars''!C4:C35');
  editor_tables := editor_tables || jsonb_build_array(jsonb_build_object(
    'key', '2026-all-stars-scores',
    'label', 'Player scores',
    'group_key', '2026-all-stars',
    'group_label', '2026 All-Stars',
    'season_value', '2026-all-stars',
    'season_label', '2026 All-Stars',
    'stage_value', NULL,
    'source_range', '''2026 All-Stars''!B3:G35',
    'data_start_row', 4,
    'data_end_row', 35,
    'hide_context', true,
    'hide_seed', true,
    'round_label_style', 'week-round',
    'context_columns', '[]'::jsonb,
    'players', jsonb_build_array(jsonb_build_object(
      'name_column', 'B',
      'round_score_columns', jsonb_build_array('D', 'E', 'F', 'G')
    ))
  ));

  FOREACH season_num IN ARRAY ARRAY[7, 6]
  LOOP
    FOR stage_num IN 1..3
    LOOP
      sheet_name := format('Season %s, Stage %s', season_num, stage_num);
      sheet_ref := format('''%s''', sheet_name);
      group_key := format('season-%s-stage-%s', season_num, stage_num);
      team_end_row := 63;
      solo_start_row := 66;
      excluded_rows := ARRAY[]::integer[];

      header_row := 9;
      WHILE header_row < team_end_row
      LOOP
        excluded_rows := array_append(excluded_rows, header_row);
        header_row := header_row + 5;
      END LOOP;
      excluded_rows := excluded_rows || ARRAY[team_end_row + 1, team_end_row + 2];

      source_ranges := array_append(source_ranges, sheet_ref || '!A3:S101');
      formula_ranges := formula_ranges || ARRAY[
        sheet_ref || '!A4:B101',
        sheet_ref || '!C4:C65',
        sheet_ref || '!D4:K101'
      ];
      header_row := 4;
      WHILE header_row < team_end_row
      LOOP
        editable_ranges := array_append(
          editable_ranges,
          format('%s!L%s:S%s', sheet_ref, header_row + 1, header_row + 4)
        );
        header_row := header_row + 5;
      END LOOP;
      editable_ranges := editable_ranges || ARRAY[
        format('%s!C%s:C101', sheet_ref, solo_start_row),
        format('%s!L%s:S101', sheet_ref, solo_start_row)
      ];

      editor_tables := editor_tables || jsonb_build_array(jsonb_build_object(
        'key', group_key || '-scores',
        'label', 'Player scores',
        'group_key', group_key,
        'group_label', format('Season %s, Stage %s', season_num, stage_num),
        'season_value', season_num,
        'season_label', format('Season %s', season_num),
        'stage_value', stage_num,
        'source_range', sheet_ref || '!A3:S101',
        'data_start_row', 5,
        'data_end_row', 101,
        'excluded_rows', to_jsonb(excluded_rows),
        'hide_context', true,
        'hide_seed', true,
        'round_label_style', 'week-round',
        'context_columns', '[]'::jsonb,
        'team_block', jsonb_build_object(
          'header_start_row', 4,
          'block_size', 5,
          'last_player_row', team_end_row,
          'team_name_column', 'C'
        ),
        'add_player', jsonb_build_object(
          'start_row', solo_start_row,
          'end_row', 101,
          'name_column', 'C'
        ),
        'players', jsonb_build_array(jsonb_build_object(
          'name_column', 'C',
          'round_score_columns', jsonb_build_array('L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S')
        ))
      ));
    END LOOP;

    sheet_name := format('Season %s, Championship', season_num);
    sheet_ref := format('''%s''', sheet_name);
    group_key := format('season-%s-championship', season_num);
    source_ranges := source_ranges || ARRAY[
      sheet_ref || '!B3:H23',
      sheet_ref || '!O3:P9',
      sheet_ref || '!R4:S8'
    ];
    editable_ranges := editable_ranges || ARRAY[
      sheet_ref || '!E5:H8', sheet_ref || '!E10:H13',
      sheet_ref || '!E15:H18', sheet_ref || '!E20:H23',
      sheet_ref || '!P3', sheet_ref || '!P5', sheet_ref || '!P7', sheet_ref || '!P9',
      sheet_ref || '!S4', sheet_ref || '!S8'
    ];
    formula_ranges := formula_ranges || ARRAY[
      sheet_ref || '!B4:D23',
      sheet_ref || '!O3:O9'
    ];
    editor_tables := editor_tables || jsonb_build_array(
      jsonb_build_object(
        'key', group_key || '-player-scores',
        'label', 'Player scores',
        'group_key', group_key,
        'group_label', format('Season %s, Championship', season_num),
        'season_value', season_num,
        'season_label', format('Season %s', season_num),
        'stage_value', 'championship',
        'source_range', sheet_ref || '!B3:H23',
        'data_start_row', 5,
        'data_end_row', 23,
        'excluded_rows', jsonb_build_array(9, 14, 19),
        'hide_context', true,
        'hide_seed', true,
        'round_label_style', 'week-round',
        'context_columns', '[]'::jsonb,
        'team_block', jsonb_build_object(
          'header_start_row', 4,
          'block_size', 5,
          'last_player_row', 23,
          'team_name_column', 'B'
        ),
        'players', jsonb_build_array(jsonb_build_object(
          'name_column', 'B',
          'round_score_columns', jsonb_build_array('E', 'F', 'G', 'H')
        ))
      ),
      jsonb_build_object(
        'key', group_key || '-semifinals',
        'label', 'Semifinal team scores',
        'group_key', group_key,
        'group_label', format('Season %s, Championship', season_num),
        'season_value', season_num,
        'season_label', format('Season %s', season_num),
        'stage_value', 'championship',
        'source_range', sheet_ref || '!O3:P9',
        'data_start_row', 3,
        'data_end_row', 9,
        'excluded_rows', jsonb_build_array(4, 6, 8),
        'hide_context', true,
        'hide_seed', true,
        'name_is_team', true,
        'context_columns', '[]'::jsonb,
        'players', jsonb_build_array(jsonb_build_object(
          'name_column', 'O',
          'round_score_columns', '[]'::jsonb,
          'result_column', 'P'
        ))
      ),
      jsonb_build_object(
        'key', group_key || '-finals',
        'label', 'Final team scores',
        'group_key', group_key,
        'group_label', format('Season %s, Championship', season_num),
        'season_value', season_num,
        'season_label', format('Season %s', season_num),
        'stage_value', 'championship',
        'source_range', sheet_ref || '!R4:S8',
        'data_start_row', 4,
        'data_end_row', 8,
        'excluded_rows', jsonb_build_array(5, 6, 7),
        'hide_context', true,
        'hide_seed', true,
        'name_is_team', true,
        'context_columns', '[]'::jsonb,
        'players', jsonb_build_array(jsonb_build_object(
          'name_column', 'R',
          'round_score_columns', '[]'::jsonb,
          'result_column', 'S'
        ))
      )
    );
  END LOOP;

  FOREACH season_num IN ARRAY ARRAY[5, 4, 3, 2, 1]
  LOOP
    team_end_row := CASE season_num
      WHEN 5 THEN 63
      WHEN 4 THEN 53
      WHEN 3 THEN 48
      WHEN 2 THEN 43
      ELSE 38
    END;
    solo_start_row := team_end_row + 3;
    sheet_name := format('Season %s', season_num);
    sheet_ref := format('''%s''', sheet_name);
    group_key := format('season-%s', season_num);
    excluded_rows := ARRAY[]::integer[];

    header_row := 9;
    WHILE header_row < team_end_row
    LOOP
      excluded_rows := array_append(excluded_rows, header_row);
      header_row := header_row + 5;
    END LOOP;
    excluded_rows := excluded_rows || ARRAY[team_end_row + 1, team_end_row + 2];

    source_ranges := array_append(source_ranges, sheet_ref || '!A3:S101');
    formula_ranges := formula_ranges || ARRAY[
      sheet_ref || '!A4:B101',
      format('%s!C4:C%s', sheet_ref, solo_start_row - 1),
      sheet_ref || '!D4:K101'
    ];
    header_row := 4;
    WHILE header_row < team_end_row
    LOOP
      editable_ranges := array_append(
        editable_ranges,
        format('%s!L%s:S%s', sheet_ref, header_row + 1, header_row + 4)
      );
      header_row := header_row + 5;
    END LOOP;
    editable_ranges := editable_ranges || ARRAY[
      format('%s!C%s:C101', sheet_ref, solo_start_row),
      format('%s!L%s:S101', sheet_ref, solo_start_row)
    ];

    editor_tables := editor_tables || jsonb_build_array(jsonb_build_object(
      'key', group_key || '-scores',
      'label', 'Player scores',
      'group_key', group_key,
      'group_label', format('Season %s', season_num),
      'season_value', season_num,
      'season_label', format('Season %s', season_num),
      'stage_value', NULL,
      'source_range', sheet_ref || '!A3:S101',
      'data_start_row', 5,
      'data_end_row', 101,
      'excluded_rows', to_jsonb(excluded_rows),
      'hide_context', true,
      'hide_seed', true,
      'round_label_style', 'week-round',
      'context_columns', '[]'::jsonb,
      'team_block', jsonb_build_object(
        'header_start_row', 4,
        'block_size', 5,
        'last_player_row', team_end_row,
        'team_name_column', 'C'
      ),
      'add_player', jsonb_build_object(
        'start_row', solo_start_row,
        'end_row', 101,
        'name_column', 'C'
      ),
      'players', jsonb_build_array(jsonb_build_object(
        'name_column', 'C',
        'round_score_columns', jsonb_build_array('L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S')
      ))
    ));
  END LOOP;

  UPDATE public.tournament_admin_events
  SET
    source_ranges = registry.source_ranges,
    editable_ranges = registry.editable_ranges,
    formula_ranges = registry.formula_ranges,
    editor_tables = registry.editor_tables
  WHERE event_key = 'proleague';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pro League tournament editor registry is missing.';
  END IF;
END;
$$;
