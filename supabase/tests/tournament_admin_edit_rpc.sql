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

INSERT INTO public.discord_guild_members (guild_id, discord_user_id, username, display_name)
VALUES
  ('800000000000000001', '900000000000000001', 'admin', 'Admin'),
  ('800000000000000001', '900000000000000002', 'player', 'Player');

INSERT INTO public.discord_roles (guild_id, role_id, name)
VALUES ('800000000000000001', '1069007873985740890', 'Administrator');

INSERT INTO public.discord_member_roles (guild_id, discord_user_id, role_id)
VALUES ('800000000000000001', '900000000000000001', '1069007873985740890');

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
  ) THEN
    RAISE EXCEPTION 'anon unexpectedly has execute privilege on an admin mutation RPC';
  END IF;

  IF has_schema_privilege('authenticated', 'private', 'USAGE')
    OR has_table_privilege('authenticated', 'private.tournament_result_action_logs', 'SELECT')
  THEN
    RAISE EXCEPTION 'authenticated users can unexpectedly access the private action log table';
  END IF;

  IF has_table_privilege('anon', 'public.tournament_admin_events', 'SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has direct table access';
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
  ) THEN
    RAISE EXCEPTION 'authenticated users can unexpectedly change canonical edit configuration';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

DO $$
DECLARE
  affected_rows integer;
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
    PERFORM public.create_tournament_result_action_log(
      'masters',
      'edit',
      '[{"range":"''Bracket''!C2","before":[[1]],"after":[[2]]}]'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'non-admin unexpectedly created a tournament action log';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.tournament_admin_events
  SET archived = true
  WHERE event_key = 'masters';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'non-admin unexpectedly archived an event';
  END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

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
BEGIN
  IF NOT public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'Discord administrator was not authorized';
  END IF;

  SELECT count(*)
  INTO context_count
  FROM public.get_tournament_admin_edit_context();

  IF context_count <> 4 THEN
    RAISE EXCEPTION 'expected four initial admin events, found %', context_count;
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
      AND archived
      AND NOT can_edit
      AND '''2026 All-Stars''!D4:G35' = ANY(editable_ranges)
      AND '''Season 7, Stage 3''!C66:C101' = ANY(editable_ranges)
      AND '''Season 7, Stage 3''!L66:S101' = ANY(editable_ranges)
      AND '''Season 7, Championship''!S8' = ANY(editable_ranges)
      AND '''Season 1''!C41:C101' = ANY(editable_ranges)
  ) THEN
    RAISE EXCEPTION 'Pro League was not registered archived with its period score and player-slot ranges';
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
      AND archived
      AND NOT can_edit
      AND '''Season 7''!M2:O136' = ANY(editable_ranges)
      AND '''Season 7 Promotions''!V2:X11' = ANY(editable_ranges)
      AND '''Season 6''!M2:O85' = ANY(editable_ranges)
      AND '''S6 Losers Bracket''!H4:H62' = ANY(editable_ranges)
  ) THEN
    RAISE EXCEPTION 'Super League was not registered archived with its active score ranges';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_tournament_admin_edit_context('masters')
    WHERE archived
      AND NOT can_edit
      AND archived_at IS NOT NULL
      AND archived_by_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Masters did not initialize archived';
  END IF;

  BEGIN
    PERFORM public.authorize_tournament_result_edit('masters');
    RAISE EXCEPTION 'initially archived Masters event was authorized for editing';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN NULL;
  END;

  PERFORM public.set_tournament_result_archived('masters', false);

  IF NOT EXISTS (
    SELECT 1
    FROM public.authorize_tournament_result_edit('masters')
    WHERE sheet_id = '16r1G1StlWQflPjAqFbHip_Y3hRo85F6iS3jYyK25CwE'
      AND editable_ranges = masters_editable_ranges
  ) THEN
    RAISE EXCEPTION 'unarchived Masters edit authorization did not return canonical config';
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
