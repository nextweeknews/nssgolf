DO $$
DECLARE
  updated_rows integer;
BEGIN
  UPDATE public.tournament_admin_events
  SET editor_tables = (
    SELECT jsonb_agg(
      CASE
        WHEN table_config->>'tab_key' IN ('season', 'playoffs', 'promotions') THEN
          jsonb_set(
            table_config,
            '{players}',
            jsonb_build_array(
              (table_config->'players'->0) || jsonb_build_object(
                'formula_columns',
                CASE table_config->>'tab_key'
                  WHEN 'playoffs' THEN jsonb_build_array(
                    jsonb_build_object('column', 'P', 'label', 'W'),
                    jsonb_build_object('column', 'Q', 'label', 'L'),
                    jsonb_build_object('column', 'S', 'label', 'M')
                  )
                  ELSE jsonb_build_array(
                    jsonb_build_object('column', 'P', 'label', 'W'),
                    jsonb_build_object('column', 'Q', 'label', 'L'),
                    jsonb_build_object('column', 'R', 'label', 'Dif'),
                    jsonb_build_object('column', 'S', 'label', 'M')
                  )
                END
              ),
              (table_config->'players'->1) || jsonb_build_object(
                'formula_columns',
                CASE table_config->>'tab_key'
                  WHEN 'playoffs' THEN jsonb_build_array(
                    jsonb_build_object('column', 'Y', 'label', 'W'),
                    jsonb_build_object('column', 'Z', 'label', 'L'),
                    jsonb_build_object('column', 'AB', 'label', 'M')
                  )
                  ELSE jsonb_build_array(
                    jsonb_build_object('column', 'Y', 'label', 'W'),
                    jsonb_build_object('column', 'Z', 'label', 'L'),
                    jsonb_build_object('column', 'AA', 'label', 'Dif'),
                    jsonb_build_object('column', 'AB', 'label', 'M')
                  )
                END
              )
            )
          )
        ELSE table_config
      END
      ORDER BY ordinal
    )
    FROM jsonb_array_elements(editor_tables) WITH ORDINALITY AS tables(table_config, ordinal)
  )
  WHERE event_key = 'superleague';

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 1 THEN
    RAISE EXCEPTION 'Super League tournament editor registry is missing.';
  END IF;
END;
$$;
