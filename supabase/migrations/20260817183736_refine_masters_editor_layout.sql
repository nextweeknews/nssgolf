UPDATE public.tournament_admin_events
SET editor_tables = (
  SELECT jsonb_agg(
    CASE table_config->>'key'
      WHEN 'qualifier-bracket' THEN table_config || jsonb_build_object(
        'group_key', 'qualifiers',
        'group_label', 'Qualifiers',
        'context_columns', jsonb_build_array('I'),
        'hide_seed', true
      )
      WHEN 'main-bracket' THEN table_config || jsonb_build_object(
        'group_key', 'bracket',
        'group_label', 'Bracket',
        'context_columns', jsonb_build_array('A'),
        'hide_seed', true
      )
      ELSE table_config
    END
    ORDER BY table_position
  )
  FROM jsonb_array_elements(editor_tables) WITH ORDINALITY AS tables(table_config, table_position)
)
WHERE event_key = 'masters';
