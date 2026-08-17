DO $$
<<registry>>
DECLARE
  source_ranges text[] := ARRAY[]::text[];
  editable_ranges text[] := ARRAY[]::text[];
  formula_ranges text[] := ARRAY[]::text[];
  editor_tables jsonb := '[]'::jsonb;
  season_num integer;
  season_sheet text;
  season_ref text;
  short_season text;
  schedule_end integer;
  playoff_start integer;
  playoff_end integer;
  view_key text;
BEGIN
  FOREACH season_num IN ARRAY ARRAY[7, 6]
  LOOP
    season_sheet := format('Season %s', season_num);
    season_ref := format('''%s''', season_sheet);
    short_season := format('S%s', season_num);
    schedule_end := CASE season_num WHEN 7 THEN 136 ELSE 85 END;
    playoff_start := CASE season_num WHEN 7 THEN 138 ELSE 87 END;
    playoff_end := playoff_start + 5;
    view_key := format('season-%s', season_num);

    source_ranges := source_ranges || ARRAY[
      format('%s!I2:AB%s', season_ref, schedule_end),
      format('%s!I%s:AB%s', season_ref, playoff_start, playoff_end),
      format('''%s Winners Bracket''!A3:H80', short_season),
      format('''%s Losers Bracket''!A4:H62', short_season)
    ];
    editable_ranges := editable_ranges || ARRAY[
      format('%s!M2:O%s', season_ref, schedule_end),
      format('%s!V2:X%s', season_ref, schedule_end),
      format('%s!M%s:O%s', season_ref, playoff_start, playoff_end),
      format('%s!V%s:X%s', season_ref, playoff_start, playoff_end),
      format('''%s Winners Bracket''!E5:E68', short_season),
      format('''%s Winners Bracket''!H5:H68', short_season),
      format('''%s Losers Bracket''!E4:E62', short_season),
      format('''%s Losers Bracket''!H4:H62', short_season)
    ];
    formula_ranges := formula_ranges || ARRAY[
      format('%s!P2:S%s', season_ref, schedule_end),
      format('%s!Y2:AB%s', season_ref, schedule_end),
      format('%s!P%s:S%s', season_ref, playoff_start, playoff_end),
      format('%s!Y%s:AB%s', season_ref, playoff_start, playoff_end),
      format('''%s Winners Bracket''!A5:D68', short_season),
      format('''%s Winners Bracket''!F5:G68', short_season),
      format('''%s Losers Bracket''!A4:D62', short_season),
      format('''%s Losers Bracket''!F4:G62', short_season)
    ];

    editor_tables := editor_tables || jsonb_build_array(
      jsonb_build_object(
        'key', view_key || '-season',
        'label', 'Regular season',
        'group_key', view_key,
        'group_label', season_sheet,
        'season_value', season_num,
        'season_label', season_sheet,
        'stage_value', NULL,
        'tab_key', 'season',
        'tab_label', 'Season',
        'source_range', format('%s!I2:AB%s', season_ref, schedule_end),
        'data_start_row', 2,
        'data_end_row', schedule_end,
        'context_columns', jsonb_build_array('I', 'J'),
        'players', jsonb_build_array(
          jsonb_build_object('name_column', 'L', 'round_score_columns', jsonb_build_array('M', 'N', 'O')),
          jsonb_build_object('name_column', 'U', 'round_score_columns', jsonb_build_array('V', 'W', 'X'))
        )
      ),
      jsonb_build_object(
        'key', view_key || '-playoffs',
        'label', 'Playoffs',
        'group_key', view_key,
        'group_label', season_sheet,
        'season_value', season_num,
        'season_label', season_sheet,
        'stage_value', NULL,
        'tab_key', 'playoffs',
        'tab_label', 'Playoffs',
        'source_range', format('%s!I%s:AB%s', season_ref, playoff_start, playoff_end),
        'data_start_row', playoff_start,
        'data_end_row', playoff_end,
        'context_columns', jsonb_build_array('I', 'J'),
        'players', jsonb_build_array(
          jsonb_build_object('seed_column', 'K', 'name_column', 'L', 'round_score_columns', jsonb_build_array('M', 'N', 'O')),
          jsonb_build_object('seed_column', 'T', 'name_column', 'U', 'round_score_columns', jsonb_build_array('V', 'W', 'X'))
        )
      ),
      jsonb_build_object(
        'key', view_key || '-qualifier-winners',
        'label', 'Winners bracket',
        'group_key', view_key,
        'group_label', season_sheet,
        'season_value', season_num,
        'season_label', season_sheet,
        'stage_value', NULL,
        'tab_key', 'qualifier-winners',
        'tab_label', 'Qualifiers - Winners',
        'source_range', format('''%s Winners Bracket''!A3:H80', short_season),
        'data_start_row', 5,
        'data_end_row', 68,
        'context_columns', jsonb_build_array('A', 'B'),
        'players', jsonb_build_array(
          jsonb_build_object('seed_column', 'C', 'name_column', 'D', 'round_score_columns', '[]'::jsonb, 'result_column', 'E'),
          jsonb_build_object('seed_column', 'F', 'name_column', 'G', 'round_score_columns', '[]'::jsonb, 'result_column', 'H')
        )
      ),
      jsonb_build_object(
        'key', view_key || '-qualifier-losers',
        'label', 'Losers bracket',
        'group_key', view_key,
        'group_label', season_sheet,
        'season_value', season_num,
        'season_label', season_sheet,
        'stage_value', NULL,
        'tab_key', 'qualifier-losers',
        'tab_label', 'Qualifiers - Losers',
        'source_range', format('''%s Losers Bracket''!A4:H62', short_season),
        'data_start_row', 4,
        'data_end_row', 62,
        'context_columns', jsonb_build_array('A', 'B'),
        'players', jsonb_build_array(
          jsonb_build_object('seed_column', 'C', 'name_column', 'D', 'round_score_columns', '[]'::jsonb, 'result_column', 'E'),
          jsonb_build_object('seed_column', 'F', 'name_column', 'G', 'round_score_columns', '[]'::jsonb, 'result_column', 'H')
        )
      )
    );

    IF season_num = 7 THEN
      source_ranges := array_append(source_ranges, '''Season 7 Promotions''!I2:AB11');
      editable_ranges := editable_ranges || ARRAY[
        '''Season 7 Promotions''!M2:O11',
        '''Season 7 Promotions''!V2:X11'
      ];
      formula_ranges := formula_ranges || ARRAY[
        '''Season 7 Promotions''!P2:S11',
        '''Season 7 Promotions''!Y2:AB11'
      ];
      editor_tables := editor_tables || jsonb_build_array(jsonb_build_object(
        'key', 'season-7-promotions',
        'label', 'Promotions',
        'group_key', view_key,
        'group_label', season_sheet,
        'season_value', season_num,
        'season_label', season_sheet,
        'stage_value', NULL,
        'tab_key', 'promotions',
        'tab_label', 'Promotions',
        'source_range', '''Season 7 Promotions''!I2:AB11',
        'data_start_row', 2,
        'data_end_row', 11,
        'context_columns', jsonb_build_array('I', 'J'),
        'players', jsonb_build_array(
          jsonb_build_object('seed_column', 'K', 'name_column', 'L', 'round_score_columns', jsonb_build_array('M', 'N', 'O')),
          jsonb_build_object('seed_column', 'T', 'name_column', 'U', 'round_score_columns', jsonb_build_array('V', 'W', 'X'))
        )
      ));
    END IF;
  END LOOP;

  UPDATE public.tournament_admin_events
  SET
    source_ranges = registry.source_ranges,
    editable_ranges = registry.editable_ranges,
    formula_ranges = registry.formula_ranges,
    editor_tables = registry.editor_tables
  WHERE event_key = 'superleague';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Super League tournament editor registry is missing.';
  END IF;
END;
$$;
