DO $$
DECLARE
  stage_num integer;
  player_row integer;
  templates jsonb := '[]'::jsonb;
  template_editable_ranges jsonb;
  updated_count integer;
BEGIN
  FOR stage_num IN 1..3
  LOOP
    template_editable_ranges := '[]'::jsonb;
    player_row := 5;
    WHILE player_row <= 60
    LOOP
      template_editable_ranges := template_editable_ranges || jsonb_build_array(
        format('''{sheet}''!L%s:S%s', player_row, player_row + 3)
      );
      player_row := player_row + 5;
    END LOOP;
    template_editable_ranges := template_editable_ranges || jsonb_build_array(
      '''{sheet}''!C66:C101',
      '''{sheet}''!L66:S101'
    );

    templates := templates || jsonb_build_array(jsonb_build_object(
      'kind', 'iteration-template',
      'template_key', format('proleague-stage-%s', stage_num),
      'sheet_pattern', format('^Season ([0-9]+), Stage %s$', stage_num),
      'iteration_group', 1,
      'min_iteration', 8,
      'source_ranges', jsonb_build_array('''{sheet}''!A3:S101'),
      'editable_ranges', template_editable_ranges,
      'formula_ranges', jsonb_build_array(
        '''{sheet}''!A4:B101',
        '''{sheet}''!C4:C65',
        '''{sheet}''!D4:K101'
      ),
      'tables', jsonb_build_array(jsonb_build_object(
        'key', format('season-{iteration}-stage-%s-scores', stage_num),
        'label', 'Player scores',
        'group_key', format('season-{iteration}-stage-%s', stage_num),
        'group_label', format('Season {iteration}, Stage %s', stage_num),
        'season_value', '{iteration}',
        'season_label', 'Season {iteration}',
        'stage_value', stage_num,
        'source_range', '''{sheet}''!A3:S101',
        'data_start_row', 5,
        'data_end_row', 101,
        'excluded_rows', jsonb_build_array(9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59, 64, 65),
        'hide_context', true,
        'hide_seed', true,
        'round_label_style', 'week-round',
        'context_columns', '[]'::jsonb,
        'team_block', jsonb_build_object(
          'header_start_row', 4,
          'block_size', 5,
          'last_player_row', 63,
          'team_name_column', 'C'
        ),
        'add_player', jsonb_build_object(
          'start_row', 66,
          'end_row', 101,
          'name_column', 'C'
        ),
        'players', jsonb_build_array(jsonb_build_object(
          'name_column', 'C',
          'round_score_columns', jsonb_build_array('L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S')
        ))
      ))
    ));
  END LOOP;

  UPDATE public.tournament_admin_events
  SET editor_tables = editor_tables || templates,
      updated_at = now()
  WHERE event_key = 'proleague';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Pro League tournament editor registry is missing.';
  END IF;
END;
$$;
