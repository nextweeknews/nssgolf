\set ON_ERROR_STOP on
\echo 1..1

BEGIN;

INSERT INTO auth.users (id)
VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '900000000000000001',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"900000000000000001"}',
    'discord'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '900000000000000002',
    '22222222-2222-2222-2222-222222222222',
    '{"sub":"900000000000000002"}',
    'discord'
  );

INSERT INTO auth.sessions (id, user_id)
VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-1111-1111-111111111111'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.discord_guild_members (guild_id, discord_user_id, username, display_name)
VALUES
  ('800000000000000001', '900000000000000001', 'admin', 'Admin'),
  ('800000000000000001', '900000000000000002', 'player', 'Player');

INSERT INTO public.discord_roles (guild_id, role_id, name)
VALUES ('800000000000000001', '1069007873985740890', 'Administrator');

INSERT INTO public.discord_member_roles (guild_id, discord_user_id, role_id)
VALUES ('800000000000000001', '900000000000000001', '1069007873985740890');

INSERT INTO public.discord_guild_sync_state (guild_id, completed_at)
VALUES ('800000000000000001', transaction_timestamp());

UPDATE public.profiles
SET username = 'admin',
    discord_user_id = '900000000000000001'
WHERE user_id = '11111111-1111-1111-1111-111111111111';

UPDATE public.profiles
SET username = 'profile-spoof',
    discord_user_id = '900000000000000001'
WHERE user_id = '22222222-2222-2222-2222-222222222222';

DO $$
BEGIN
  IF NOT has_function_privilege(
    'anon',
    'public.get_tournament_editor_read_context(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon cannot execute the public tournament editor read RPC';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_tournament_admin_edit_context(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon unexpectedly has execute privilege on the admin context RPC';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.authorize_tournament_result_edit(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.set_tournament_result_archived(text,boolean)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.create_tournament_result_action_log(text,text,jsonb,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.set_tournament_result_action_log_changes(uuid,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.complete_tournament_result_action_log(uuid,boolean,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.get_tournament_result_action_for_undo(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.list_tournament_result_action_logs(integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.set_admin_visibility(text,text,boolean)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.undo_admin_visibility_action(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.list_admin_action_logs(integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.save_championship_point_values(jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon unexpectedly has execute privilege on an admin mutation RPC';
  END IF;

  IF has_table_privilege('authenticated', 'private.tournament_result_action_logs', 'SELECT')
    OR has_table_privilege('authenticated', 'private.admin_visibility_action_logs', 'SELECT')
  THEN
    RAISE EXCEPTION 'authenticated users can unexpectedly access the private action log table';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.create_tournament_result_action_log(text,text,jsonb,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.set_tournament_result_action_log_changes(uuid,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.complete_tournament_result_action_log(uuid,boolean,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated users can unexpectedly call Worker-only lifecycle RPCs';
  END IF;

  IF has_table_privilege('anon', 'public.tournament_admin_events', 'SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has direct table access';
  END IF;

  IF has_table_privilege('authenticated', 'public.championship_point_settings', 'INSERT')
    OR has_table_privilege('authenticated', 'public.championship_point_settings', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.championship_point_settings', 'DELETE')
    OR has_table_privilege('authenticated', 'public.gpi_hidden_players', 'INSERT')
    OR has_table_privilege('authenticated', 'public.gpi_hidden_players', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.gpi_hidden_players', 'DELETE')
    OR has_table_privilege('authenticated', 'public.player_global_rank_moderation', 'INSERT')
    OR has_table_privilege('authenticated', 'public.player_global_rank_moderation', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.player_global_rank_moderation', 'DELETE')
  THEN
    RAISE EXCEPTION 'authenticated users can bypass audited visibility RPCs';
  END IF;

  IF has_column_privilege(
    'authenticated',
    'public.tournament_admin_events',
    'sheet_id',
    'UPDATE'
  ) OR has_column_privilege(
    'authenticated',
    'public.tournament_admin_events',
    'editable_ranges',
    'UPDATE'
  ) OR has_column_privilege(
    'authenticated',
    'public.tournament_admin_events',
    'archived',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated users can unexpectedly bypass tournament mutation RPCs';
  END IF;
END;
$$;

SET LOCAL ROLE anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.season_configuration
    WHERE id = 'current'
      AND ranked_league_season = 13
      AND shotgun_pro_league_season = 7
      AND shotgun_pro_league_stage = 3
      AND super_league_season = 6
  ) THEN
    RAISE EXCEPTION 'public season configuration is unavailable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_editor_read_context('worldcup')
    WHERE sheet_id = '1hmxKPrk4LH7U0kK60N6yghYB898GyTG0Erg3NtsGWXk'
      AND can_edit
  ) THEN
    RAISE EXCEPTION 'public World Cup editor context is unavailable';
  END IF;

  IF has_column_privilege(
    'anon',
    'public.tournament_admin_events',
    'updated_by_user_id',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon can read private tournament editor audit identities';
  END IF;
END;
$$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SELECT set_config('request.jwt.claim.session_id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);

DO $$
BEGIN
  IF public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'mutable profile Discord ID granted admin access';
  END IF;

  BEGIN
    PERFORM public.get_tournament_admin_edit_context();
    RAISE EXCEPTION 'non-admin unexpectedly read the admin context';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.list_tournament_result_action_logs(10);
    RAISE EXCEPTION 'non-admin unexpectedly read tournament action logs';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.set_admin_visibility('gpi', '900000000000000002', true);
    RAISE EXCEPTION 'non-admin unexpectedly changed GPI visibility';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.list_admin_action_logs(10);
    RAISE EXCEPTION 'non-admin unexpectedly read combined admin action logs';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.save_championship_point_values('{}'::jsonb);
    RAISE EXCEPTION 'non-admin unexpectedly changed Championship point values';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.update_season_configuration(
      14,
      8,
      2,
      7,
      '{"rankedLeagueSeason":13,"shotgunProLeagueSeason":7,"shotgunProLeagueStage":3,"superLeagueSeason":6}'::jsonb
    );
    RAISE EXCEPTION 'non-admin unexpectedly changed season configuration';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.session_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);

DO $$
DECLARE
  context_count integer;
  configuration_action_id uuid;
  configuration_undo_id uuid;
  newer_configuration_action_id uuid;
BEGIN
  SELECT count(*)
  INTO context_count
  FROM public.get_tournament_admin_edit_context();

  IF context_count <> 8 THEN
    RAISE EXCEPTION 'authenticated admin context RPC returned % events', context_count;
  END IF;

  BEGIN
    PERFORM public.update_season_configuration(
      6,
      8,
      2,
      7,
      '{"rankedLeagueSeason":13,"shotgunProLeagueSeason":7,"shotgunProLeagueStage":3,"superLeagueSeason":6}'::jsonb
    );
    RAISE EXCEPTION 'unsupported Ranked League season was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT result.action_id
  INTO configuration_action_id
  FROM public.update_season_configuration(
    14,
    8,
    2,
    7,
    '{"rankedLeagueSeason":13,"shotgunProLeagueSeason":7,"shotgunProLeagueStage":3,"superLeagueSeason":6}'::jsonb
  ) AS result;

  IF NOT EXISTS (
    SELECT 1
    FROM public.season_configuration
    WHERE id = 'current'
      AND ranked_league_season = 14
      AND shotgun_pro_league_season = 8
      AND shotgun_pro_league_stage = 2
      AND super_league_season = 7
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = configuration_action_id
      AND action_type = 'configuration'
      AND event_key = 'season-configuration'
      AND event_display_name = 'Season Configuration'
      AND jsonb_array_length(changes) = 4
      AND changes->0->>'playerName' = 'Ranked League'
      AND changes->2->'headers' = '["Stage"]'::jsonb
      AND can_undo
  ) THEN
    RAISE EXCEPTION 'season configuration update was not applied and logged';
  END IF;

  BEGIN
    PERFORM public.update_season_configuration(
      15,
      8,
      2,
      7,
      '{"rankedLeagueSeason":13,"shotgunProLeagueSeason":7,"shotgunProLeagueStage":3,"superLeagueSeason":6}'::jsonb
    );
    RAISE EXCEPTION 'stale season configuration snapshot overwrote newer values';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  SELECT result.action_id
  INTO newer_configuration_action_id
  FROM public.update_season_configuration(
    15,
    8,
    2,
    7,
    '{"rankedLeagueSeason":14,"shotgunProLeagueSeason":8,"shotgunProLeagueStage":2,"superLeagueSeason":7}'::jsonb
  ) AS result;

  IF EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = configuration_action_id
      AND can_undo
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = newer_configuration_action_id
      AND can_undo
  ) THEN
    RAISE EXCEPTION 'only the newest applicable season configuration action should be undoable';
  END IF;

  PERFORM public.undo_season_configuration_action(newer_configuration_action_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.season_configuration
    WHERE id = 'current'
      AND ranked_league_season = 14
      AND shotgun_pro_league_season = 8
      AND shotgun_pro_league_stage = 2
      AND super_league_season = 7
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = configuration_action_id
      AND can_undo
  ) OR EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = newer_configuration_action_id
      AND can_undo
  ) THEN
    RAISE EXCEPTION 'undo did not restore the preceding configuration action as undoable';
  END IF;

  SELECT result.action_id
  INTO configuration_undo_id
  FROM public.undo_season_configuration_action(configuration_action_id) AS result;

  IF NOT EXISTS (
    SELECT 1
    FROM public.season_configuration
    WHERE id = 'current'
      AND ranked_league_season = 13
      AND shotgun_pro_league_season = 7
      AND shotgun_pro_league_stage = 3
      AND super_league_season = 6
  ) OR EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = configuration_action_id
      AND can_undo
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = configuration_action_id
      AND undone_by_action_id = configuration_undo_id
      AND undone_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'season configuration undo did not restore and close the original action';
  END IF;

  BEGIN
    PERFORM public.undo_season_configuration_action(configuration_action_id);
    RAISE EXCEPTION 'season configuration action was undone twice';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  PERFORM public.set_tournament_result_archived('masters', false);

  IF NOT EXISTS (
    SELECT 1
    FROM public.authorize_tournament_result_edit('masters')
    WHERE event_key = 'masters'
      AND cardinality(editable_ranges) > 0
      AND jsonb_array_length(editor_tables) > 0
  ) THEN
    RAISE EXCEPTION 'authenticated admin could not authorize an active tournament edit';
  END IF;

  PERFORM public.set_tournament_result_archived('masters', true);

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('masters')
    WHERE archived
      AND archived_by_user_id = '11111111-1111-1111-1111-111111111111'
      AND updated_by_user_id = '11111111-1111-1111-1111-111111111111'
  ) THEN
    RAISE EXCEPTION 'authenticated archive RPC did not preserve server audit metadata';
  END IF;

  PERFORM public.set_tournament_result_archived('masters', false);

  BEGIN
    UPDATE public.tournament_admin_events
    SET archived = true
    WHERE event_key = 'masters';
    RAISE EXCEPTION 'authenticated admin bypassed the archive RPC';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.session_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
SELECT set_config(
  'request.headers',
  '{"x-nssgolf-actor-user-id":"11111111-1111-1111-1111-111111111111"}',
  true
);

DO $$
DECLARE
  context_count integer;
  masters_ranges text[];
  masters_editable_ranges text[];
  masters_formula_ranges text[];
  masters_editor_tables jsonb;
  proleague_tables jsonb;
  superleague_tables jsonb;
  edit_action_id uuid;
  undo_action_id uuid;
  undo_changes jsonb;
  failed_action_id uuid;
  visibility_action_id uuid;
  visibility_undo_id uuid;
  valid_point_settings jsonb := jsonb_build_object(
    'lightningCup2026', jsonb_build_object(
      'winner', 100, 'runnerUp', 60, 'semifinalist', 40,
      'quarterfinalist', 25, 'roundOf16', 15, 'roundOf32', 10, 'roundOf64', 5
    ),
    'worldCup2025', jsonb_build_object(
      'winner', 100, 'runnerUp', 60, 'thirdPlace', 50, 'fourthPlace', 40,
      'quarterfinalist', 25, 'roundOf16', 15, 'groupThird', 10, 'groupFourth', 5
    ),
    'worldOpen', jsonb_build_object(
      'secondRound', 5, 'roundOf32', 10, 'roundOf16', 20,
      'quarterfinalist', 30, 'semifinalist', 50, 'runnerUp', 70, 'winner', 101
    ),
    'noptational2026', jsonb_build_object(
      'placements', to_jsonb(array_fill(10, ARRAY[44]))
    ),
    'superLeagueS5', jsonb_build_object(
      'division1', to_jsonb(ARRAY[100,80,65,50,40,30,20,10]),
      'division2', to_jsonb(ARRAY[75,55,40,30,20,15,10,5]),
      'division3', to_jsonb(ARRAY[50,40,30,20,15,10,5,2])
    ),
    'superLeagueS6', jsonb_build_object(
      'division1', to_jsonb(ARRAY[100,80,65,50,40,30,20,10]),
      'division2', to_jsonb(ARRAY[75,55,40,30,20,15,10,5]),
      'division3', to_jsonb(ARRAY[50,40,30,20,15,10,5,2])
    )
  );
BEGIN
  IF NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Discord administrator was not authorized';
  END IF;

  UPDATE public.discord_guild_members
  SET is_current_member = false
  WHERE guild_id = '800000000000000001'
    AND discord_user_id = '900000000000000001';
  IF public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'a stale Discord member retained administrator access';
  END IF;
  UPDATE public.discord_guild_members
  SET is_current_member = true
  WHERE guild_id = '800000000000000001'
    AND discord_user_id = '900000000000000001';

  UPDATE public.discord_roles
  SET is_current_role = false
  WHERE guild_id = '800000000000000001'
    AND role_id = '1069007873985740890';
  IF public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'a stale Discord role retained administrator access';
  END IF;
  UPDATE public.discord_roles
  SET is_current_role = true
  WHERE guild_id = '800000000000000001'
    AND role_id = '1069007873985740890';

  UPDATE public.discord_member_roles
  SET scanned_at = transaction_timestamp() - interval '1 second'
  WHERE guild_id = '800000000000000001'
    AND discord_user_id = '900000000000000001'
    AND role_id = '1069007873985740890';
  IF public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'a stale Discord role assignment retained administrator access';
  END IF;
  UPDATE public.discord_member_roles
  SET scanned_at = transaction_timestamp()
  WHERE guild_id = '800000000000000001'
    AND discord_user_id = '900000000000000001'
    AND role_id = '1069007873985740890';

  SELECT count(*)
  INTO context_count
  FROM public.get_tournament_admin_edit_context();

  IF context_count <> 8 THEN
    RAISE EXCEPTION 'expected eight configured admin events, found %', context_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('worldopen')
    WHERE sheet_id = '1WcRVGmEpQkRDTwe8aDfQgxuDoapvLxAdSjnqg4PHgXM'
      AND editor_tables->0->>'kind' = 'iteration-template'
      AND jsonb_array_length(editor_tables->0->'tables') = 7
      AND editable_ranges @> ARRAY['''2026 Results''!C2:D33', '''2026 Results''!AU2:AV2']
      AND editor_tables->0->'tables'->0->'player_options'->>'column' = 'A'
      AND (editor_tables->0->'tables'->0->'players'->0->>'editable_name')::boolean
  ) THEN
    RAISE EXCEPTION 'World Open editor registry is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('lightningcup')
    WHERE sheet_id = '1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ'
      AND jsonb_array_length(editor_tables) = 5
      AND editable_ranges @> ARRAY['''Bracket''!O4:Q66', '''Bracket''!R4:T66']
  ) THEN
    RAISE EXCEPTION 'Lightning Cup editor registry is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('noptational')
    WHERE sheet_id = '1T7kmgUtimrOW3LaTw2hYLMFvO600SjmUDLTecL6gY00'
      AND editor_tables->0->>'kind' = 'iteration-template'
      AND jsonb_array_length(editor_tables->0->'tables') = 1
      AND jsonb_array_length(editor_tables->0->'tables'->0->'header_groups') = 4
      AND editable_ranges = ARRAY['''Round Scores (2026)''!B2:J72']
  ) THEN
    RAISE EXCEPTION 'Noptational editor registry is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('worldcup')
    WHERE sheet_id = '1hmxKPrk4LH7U0kK60N6yghYB898GyTG0Erg3NtsGWXk'
      AND editor_tables->0->>'sheet_pattern' = '^World Cup (20\d{2})$'
      AND jsonb_array_length(editor_tables->0->'tables') = 5
      AND editor_tables->0->'tables'->0->'context_block'->>'column' = 'E'
      AND editable_ranges @> ARRAY['''World Cup 2025''!V2:V120', '''World Cup 2024''!X2:X120']
  ) THEN
    RAISE EXCEPTION 'World Cup year-aware editor registry is incomplete';
  END IF;

  SELECT source_ranges, editable_ranges, formula_ranges, editor_tables
  INTO masters_ranges, masters_editable_ranges, masters_formula_ranges, masters_editor_tables
  FROM public.get_tournament_admin_edit_context('masters');

  IF masters_ranges <> ARRAY['''Qualifiers''!A:T', '''Bracket''!A1:R16', '''Discord IDs''!A:B'] THEN
    RAISE EXCEPTION 'Masters source ranges do not match the current page';
  END IF;

  IF masters_editable_ranges <> ARRAY[
    '''Qualifiers''!K2:N16',
    '''Qualifiers''!P2:S16',
    '''Bracket''!C2:I16',
    '''Bracket''!K2:Q16'
  ] THEN
    RAISE EXCEPTION 'Masters editable score ranges do not match the live sheet inventory';
  END IF;

  IF masters_formula_ranges <> ARRAY[
    '''Qualifiers''!J2:J16',
    '''Qualifiers''!O2:O16',
    '''Qualifiers''!T2:T16',
    '''Bracket''!B10:B16',
    '''Bracket''!J10:J16',
    '''Bracket''!R2:R16'
  ] THEN
    RAISE EXCEPTION 'Masters formula ranges do not match the live sheet inventory';
  END IF;

  IF jsonb_array_length(masters_editor_tables) <> 2
    OR masters_editor_tables->0->>'key' <> 'qualifier-bracket'
    OR masters_editor_tables->1->>'key' <> 'main-bracket'
    OR NOT masters_editor_tables @> '[{
      "key": "qualifier-bracket",
      "group_key": "qualifiers",
      "group_label": "Qualifiers",
      "context_columns": ["I"],
      "hide_seed": true
    }, {
      "key": "main-bracket",
      "group_key": "bracket",
      "group_label": "Bracket",
      "context_columns": ["A"],
      "hide_seed": true
    }]'::jsonb
  THEN
    RAISE EXCEPTION 'Masters editor table metadata is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('championship')
    WHERE editable_ranges = ARRAY['''Bracket''!E3:N66', '''Bracket''!Q3:Z66']
      AND formula_ranges = ARRAY[
        '''Bracket''!C3:D66',
        '''Bracket''!O3:P66',
        '''Bracket''!AA3:AB66'
      ]
      AND jsonb_array_length(editor_tables) = 1
  ) THEN
    RAISE EXCEPTION 'Championship edit or formula ranges do not match the live sheet inventory';
  END IF;

  SELECT editor_tables
  INTO proleague_tables
  FROM public.get_tournament_admin_edit_context('proleague');

  IF jsonb_array_length(proleague_tables) <> 18
    OR proleague_tables->0->>'group_key' <> '2026-all-stars'
    OR proleague_tables->1->>'group_key' <> 'season-7-stage-1'
    OR proleague_tables->3->>'group_key' <> 'season-7-stage-3'
    OR proleague_tables->4->>'group_key' <> 'season-7-championship'
    OR proleague_tables->7->>'group_key' <> 'season-6-stage-1'
    OR proleague_tables->13->>'group_key' <> 'season-5'
    OR proleague_tables->17->>'group_key' <> 'season-1'
  THEN
    RAISE EXCEPTION 'Pro League season and stage editor metadata are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('proleague')
    WHERE sheet_id = '1qIM0HKhx9Y-3eCJCFzBqrbATwiPrK3C1ynATwZzRC1o'
      AND NOT archived
      AND can_edit
      AND '''2026 All-Stars''!D4:G35' = ANY(editable_ranges)
      AND '''Season 7, Stage 3''!C66:C101' = ANY(editable_ranges)
      AND '''Season 7, Stage 3''!L66:S101' = ANY(editable_ranges)
      AND '''Season 7, Championship''!S8' = ANY(editable_ranges)
      AND '''Season 1''!C41:C101' = ANY(editable_ranges)
  ) THEN
    RAISE EXCEPTION 'Pro League was not enabled with its period score and player-slot ranges';
  END IF;

  SELECT editor_tables
  INTO superleague_tables
  FROM public.get_tournament_admin_edit_context('superleague');

  IF jsonb_array_length(superleague_tables) <> 9
    OR superleague_tables->0->>'group_key' <> 'season-7'
    OR superleague_tables->0->>'tab_key' <> 'season'
    OR superleague_tables->4->>'tab_key' <> 'promotions'
    OR superleague_tables->5->>'group_key' <> 'season-6'
    OR superleague_tables->8->>'tab_key' <> 'qualifier-losers'
    OR superleague_tables->0->'players'->0->'formula_columns' <> '[
      {"column":"P","label":"W"},
      {"column":"Q","label":"L"},
      {"column":"R","label":"Dif"},
      {"column":"S","label":"M"}
    ]'::jsonb
    OR superleague_tables->1->'players'->0->'formula_columns' <> '[
      {"column":"P","label":"W"},
      {"column":"Q","label":"L"},
      {"column":"S","label":"M"}
    ]'::jsonb
  THEN
    RAISE EXCEPTION 'Super League edit tabs or table metadata are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('superleague')
    WHERE sheet_id = '1BbT8t6erCVdx-Bdshv_hax9r9JSRzU1WygjWxW3vPkY'
      AND NOT archived
      AND can_edit
      AND '''Season 7''!M2:O136' = ANY(editable_ranges)
      AND '''Season 7 Promotions''!V2:X11' = ANY(editable_ranges)
      AND '''Season 6''!M2:O85' = ANY(editable_ranges)
      AND '''S6 Losers Bracket''!H4:H62' = ANY(editable_ranges)
  ) THEN
    RAISE EXCEPTION 'Super League was not enabled with its active score ranges';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('masters')
    WHERE NOT archived
      AND can_edit
      AND archived_at IS NULL
      AND archived_by_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Masters did not initialize editable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.authorize_tournament_result_edit('masters')
    WHERE sheet_id = '16r1G1StlWQflPjAqFbHip_Y3hRo85F6iS3jYyK25CwE'
      AND editable_ranges = masters_editable_ranges
  ) THEN
    RAISE EXCEPTION 'Masters edit authorization did not return canonical config';
  END IF;

  PERFORM public.set_tournament_result_archived('masters', true);

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('masters')
    WHERE archived
      AND NOT can_edit
      AND archived_at IS NOT NULL
      AND archived_by_user_id = '11111111-1111-1111-1111-111111111111'
  ) THEN
    RAISE EXCEPTION 'archive state or audit fields were not applied';
  END IF;

  BEGIN
    PERFORM public.authorize_tournament_result_edit('masters');
    RAISE EXCEPTION 'archived Masters event was authorized for editing';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  PERFORM public.set_tournament_result_archived('masters', false);

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('masters')
    WHERE NOT archived
      AND can_edit
      AND archived_at IS NULL
      AND archived_by_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'unarchive did not restore editing';
  END IF;

  PERFORM public.authorize_tournament_result_edit('masters');

  BEGIN
    PERFORM public.create_tournament_result_action_log(
      'masters',
      'edit',
      '[{"before":[],"after":[[1]]}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'an action log without a range was unexpectedly accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT action_id
  INTO edit_action_id
  FROM public.create_tournament_result_action_log(
    'masters',
    'edit',
    '[{"range":"''Bracket''!C2:D2","before":[],"after":[[-1,-2]]}]'::jsonb,
    NULL
  );

  BEGIN
    PERFORM public.create_tournament_result_action_log(
      'masters',
      'edit',
      '[{"range":"''Bracket''!C3","before":[],"after":[[1]]}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'a second pending Masters action was unexpectedly accepted';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  BEGIN
    PERFORM public.complete_tournament_result_action_log(edit_action_id, true, NULL);
    RAISE EXCEPTION 'a tournament edit with placeholder before-values was unexpectedly completed';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  PERFORM public.set_tournament_result_action_log_changes(
    edit_action_id,
    '[{"range":"''Bracket''!C2:D2","before":[[1,2]],"after":[[-1,-2]]}]'::jsonb
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_tournament_result_action_logs(10)
    WHERE action_id = edit_action_id
      AND action_type = 'edit'
      AND status = 'pending'
      AND event_key = 'masters'
      AND route_path = '/masters'
      AND actor_user_id = '11111111-1111-1111-1111-111111111111'
      AND actor_discord_user_id = '900000000000000001'
      AND actor_username = 'Admin'
      AND NOT can_undo
  ) THEN
    RAISE EXCEPTION 'pending tournament edit log did not capture canonical actor and event data';
  END IF;

  PERFORM public.complete_tournament_result_action_log(edit_action_id, true, NULL);

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_tournament_result_action_logs(10)
    WHERE action_id = edit_action_id
      AND status = 'succeeded'
      AND can_undo
      AND completed_at IS NOT NULL
      AND changes = '[{"range":"''Bracket''!C2:D2","before":[[1,2]],"after":[[-1,-2]]}]'::jsonb
  ) THEN
    RAISE EXCEPTION 'completed tournament edit log is not undoable or lost its values';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_result_action_for_undo(edit_action_id)
    WHERE event_key = 'masters'
      AND sheet_id = '16r1G1StlWQflPjAqFbHip_Y3hRo85F6iS3jYyK25CwE'
      AND changes = '[{"range":"''Bracket''!C2:D2","before":[[1,2]],"after":[[-1,-2]]}]'::jsonb
  ) THEN
    RAISE EXCEPTION 'undo authorization did not return the canonical edit action';
  END IF;

  SELECT action_id, changes
  INTO undo_action_id, undo_changes
  FROM public.create_tournament_result_action_log('masters', 'undo', NULL, edit_action_id);

  IF undo_changes <> '[{"range":"''Bracket''!C2:D2","before":[[-1,-2]],"after":[[1,2]]}]'::jsonb THEN
    RAISE EXCEPTION 'undo action did not derive the exact inverse values';
  END IF;

  PERFORM public.complete_tournament_result_action_log(undo_action_id, true, NULL);

  IF EXISTS (
    SELECT 1
    FROM public.list_tournament_result_action_logs(10)
    WHERE action_id = edit_action_id AND can_undo
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_tournament_result_action_logs(10)
    WHERE action_id = edit_action_id
      AND undone_by_action_id = undo_action_id
      AND undone_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'successful undo did not close the original edit action';
  END IF;

  BEGIN
    PERFORM public.get_tournament_result_action_for_undo(edit_action_id);
    RAISE EXCEPTION 'already undone edit was authorized again';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  SELECT action_id
  INTO failed_action_id
  FROM public.create_tournament_result_action_log(
    'masters',
    'edit',
    '[{"range":"''Bracket''!C3","before":[[0]],"after":[[1]]}]'::jsonb,
    NULL
  );
  PERFORM public.complete_tournament_result_action_log(failed_action_id, false, 'Google write failed.');

  IF NOT EXISTS (
    SELECT 1
    FROM public.list_tournament_result_action_logs(10)
    WHERE action_id = failed_action_id
      AND status = 'failed'
      AND error_message = 'Google write failed.'
      AND NOT can_undo
  ) THEN
    RAISE EXCEPTION 'failed tournament edit was not retained as a non-undoable audit record';
  END IF;

  SELECT action_id
  INTO visibility_action_id
  FROM public.set_admin_visibility('gpi', '900000000000000002', true);

  IF NOT EXISTS (
    SELECT 1
    FROM public.gpi_hidden_players
    WHERE discord_user_id = '900000000000000002'
      AND hidden_by_user_id = '11111111-1111-1111-1111-111111111111'
      AND hidden_by_username = 'Admin'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = visibility_action_id
      AND action_type = 'visibility'
      AND event_key = 'gpi'
      AND event_display_name = 'GPI'
      AND actor_discord_user_id = '900000000000000001'
      AND changes->0->>'playerName' = 'Player'
      AND changes->0->'before' = '[["Visible"]]'::jsonb
      AND changes->0->'after' = '[["Hidden"]]'::jsonb
      AND can_undo
  ) THEN
    RAISE EXCEPTION 'GPI visibility change was not authenticated and logged';
  END IF;

  SELECT action_id
  INTO visibility_undo_id
  FROM public.undo_admin_visibility_action(visibility_action_id);

  IF EXISTS (
    SELECT 1 FROM public.gpi_hidden_players WHERE discord_user_id = '900000000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.list_admin_action_logs(20)
    WHERE action_id = visibility_action_id AND can_undo
  ) OR NOT EXISTS (
    SELECT 1 FROM public.list_admin_action_logs(20)
    WHERE action_id = visibility_action_id
      AND undone_by_action_id = visibility_undo_id
      AND undone_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'GPI visibility undo did not restore and close the original action';
  END IF;

  SELECT action_id
  INTO visibility_action_id
  FROM public.set_admin_visibility(
    'global-ranks',
    '900000000000000002:current_global_rank',
    true
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.player_global_rank_moderation
    WHERE discord_user_id = '900000000000000002'
      AND rank_key = 'current_global_rank'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = visibility_action_id
      AND event_key = 'global-ranks'
      AND changes->0->'headers' = '["Current Rank visibility"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'global-rank visibility change was not applied and logged';
  END IF;

  SELECT action_id
  INTO visibility_action_id
  FROM public.set_admin_visibility(
    'championship-qualifiers',
    'id:900000000000000002',
    true
  );

  BEGIN
    PERFORM public.save_championship_point_values('{"worldOpen":{"winner":101}}'::jsonb);
    RAISE EXCEPTION 'an incomplete Championship point schema was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;

  PERFORM public.save_championship_point_values(valid_point_settings);

  IF NOT EXISTS (
    SELECT 1
    FROM public.championship_point_settings
    WHERE id = 'current'
      AND hidden_player_keys @> ARRAY['id:900000000000000002']
      AND settings = valid_point_settings
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.list_admin_action_logs(20)
    WHERE action_id = visibility_action_id
      AND event_key = 'championship-qualifiers'
      AND route_path = '/championship.html?view=leaderboard&qualifier=tournaments'
  ) THEN
    RAISE EXCEPTION 'Championship visibility or point-value isolation failed';
  END IF;

  BEGIN
    PERFORM public.get_tournament_admin_edit_context('missing-event');
    RAISE EXCEPTION 'unknown event was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
END;
$$;

RESET ROLE;
\echo ok 1 - tournament admin RPC security checks
ROLLBACK;
