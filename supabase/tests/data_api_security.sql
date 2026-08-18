\set ON_ERROR_STOP on
\echo 1..1

BEGIN;

SET LOCAL ROLE postgres;
CREATE FUNCTION private.security_test_future_helper()
RETURNS boolean
LANGUAGE sql
AS $$ SELECT true $$;
RESET ROLE;

INSERT INTO auth.users (id)
VALUES
  ('31000000-0000-0000-0000-000000000001'),
  ('31000000-0000-0000-0000-000000000002'),
  ('31000000-0000-0000-0000-000000000003'),
  ('31000000-0000-0000-0000-000000000004');

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider)
VALUES
  (
    '32000000-0000-0000-0000-000000000001',
    '930000000000000001',
    '31000000-0000-0000-0000-000000000001',
    '{"sub":"930000000000000001","name":"Player One"}',
    'discord'
  ),
  (
    '32000000-0000-0000-0000-000000000002',
    '930000000000000002',
    '31000000-0000-0000-0000-000000000002',
    '{"sub":"930000000000000002","name":"Player Two"}',
    'discord'
  ),
  (
    '32000000-0000-0000-0000-000000000003',
    '930000000000000003',
    '31000000-0000-0000-0000-000000000003',
    '{"sub":"930000000000000003","name":"Administrator"}',
    'discord'
  ),
  (
    '32000000-0000-0000-0000-000000000004',
    'email-only@example.test',
    '31000000-0000-0000-0000-000000000004',
    '{"sub":"31000000-0000-0000-0000-000000000004","email":"email-only@example.test"}',
    'email'
  );

INSERT INTO auth.sessions (id, user_id)
VALUES
  ('33000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001'),
  ('33000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002'),
  ('33000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000003'),
  ('33000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000004');

INSERT INTO public.discord_guild_members (guild_id, discord_user_id, username, display_name)
VALUES
  ('940000000000000001', '930000000000000001', 'player-one', 'Player One'),
  ('940000000000000001', '930000000000000002', 'player-two', 'Player Two'),
  ('940000000000000001', '930000000000000003', 'administrator', 'Administrator');

INSERT INTO public.discord_roles (guild_id, role_id, name)
VALUES
  ('940000000000000001', '1069007873985740890', 'Administrator'),
  ('940000000000000001', '940000000000000099', 'Event Competitor');

INSERT INTO public.discord_member_roles (guild_id, discord_user_id, role_id)
VALUES
  ('940000000000000001', '930000000000000003', '1069007873985740890'),
  ('940000000000000001', '930000000000000001', '940000000000000099');

INSERT INTO public.discord_guild_sync_state (guild_id, completed_at)
VALUES ('940000000000000001', transaction_timestamp());

INSERT INTO public.events (id, guild_id, name, required_role_id, deadline_at)
VALUES (
  '95000000-0000-0000-0000-000000000001',
  '940000000000000001',
  'Security Test Event',
  '940000000000000099',
  '2099-05-01 17:00:00+00'
);

INSERT INTO public.bracket_event_settings (
  year,
  event_key,
  display_name,
  edit_deadline_at,
  picks_public_at
)
VALUES (
  '2099',
  'security-test-cup',
  'Security Test Cup',
  '2099-04-10 17:00:00+00',
  '2099-04-10 17:00:00+00'
);

CREATE TEMP TABLE security_test_ids (bracket_id uuid);
GRANT SELECT, INSERT ON security_test_ids TO authenticated;

DO $$
DECLARE
  unprotected_tables text[];
BEGIN
  SELECT array_agg(format('%I.%I', namespace.nspname, relation.relname) ORDER BY relation.relname)
  INTO unprotected_tables
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relname NOT LIKE 'spatial_ref_sys'
    AND NOT relation.relrowsecurity;

  IF unprotected_tables IS NOT NULL THEN
    RAISE EXCEPTION 'public tables without RLS: %', unprotected_tables;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS view_relation
    WHERE view_relation.oid = 'public.bracket_leaderboard'::regclass
      AND 'security_invoker=true' = ANY(COALESCE(view_relation.reloptions, '{}'::text[]))
  ) THEN
    RAISE EXCEPTION 'bracket_leaderboard is not a security-invoker view';
  END IF;

  IF has_table_privilege('anon', 'public.ranked', 'INSERT')
    OR has_table_privilege('authenticated', 'public.ranked', 'UPDATE')
    OR has_table_privilege('anon', 'public.discord_guild_members', 'DELETE')
    OR has_table_privilege('authenticated', 'public.internal_tournament_matches', 'INSERT')
    OR has_table_privilege('authenticated', 'public.match_states', 'UPDATE')
    OR has_table_privilege('anon', 'public.season_configuration', 'INSERT')
    OR has_table_privilege('authenticated', 'public.season_configuration', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.season_configuration', 'DELETE')
  THEN
    RAISE EXCEPTION 'browser roles retain a process-table write grant';
  END IF;

  IF has_column_privilege('anon', 'public.internal_tournament_matches', 'raw_match', 'SELECT')
    OR has_column_privilege('authenticated', 'public.internal_tournament_matches', 'raw_source', 'SELECT')
    OR has_column_privilege('anon', 'public.internal_tournament_gpi_runs', 'config', 'SELECT')
    OR has_column_privilege('authenticated', 'public.internal_ranked_elo_runs', 'config', 'SELECT')
    OR has_column_privilege('anon', 'public.profiles', 'created_at', 'SELECT')
    OR has_column_privilege('anon', 'public.player_settings', 'updated_at', 'SELECT')
    OR has_column_privilege('anon', 'public.player_custom_urls', 'approved_by_user_id', 'SELECT')
    OR has_column_privilege('authenticated', 'public.player_custom_urls', 'approved_by_user_id', 'SELECT')
    OR has_column_privilege('anon', 'public.match_states', 'updated_by', 'SELECT')
    OR has_column_privilege('anon', 'public.match_states', 'created_at', 'SELECT')
    OR has_column_privilege('anon', 'public.discord_member_roles', 'scanned_at', 'SELECT')
    OR has_column_privilege('anon', 'public.discord_roles', 'last_scanned_at', 'SELECT')
    OR has_column_privilege('anon', 'public.bracket_event_settings', 'created_at', 'SELECT')
    OR has_column_privilege('anon', 'public.brackets', 'created_at', 'SELECT')
    OR has_column_privilege('authenticated', 'public.brackets', 'updated_at', 'SELECT')
    OR has_column_privilege('anon', 'public.bracket_picks', 'created_at', 'SELECT')
    OR has_column_privilege('anon', 'public.player_league_aliases', 'source', 'SELECT')
    OR has_column_privilege('authenticated', 'public.events', 'created_by_discord_user_id', 'SELECT')
    OR has_column_privilege('authenticated', 'public.tournament_admin_events', 'updated_by_user_id', 'SELECT')
    OR has_column_privilege('anon', 'public.season_configuration', 'updated_at', 'SELECT')
    OR has_column_privilege('authenticated', 'public.season_configuration', 'updated_by_user_id', 'SELECT')
  THEN
    RAISE EXCEPTION 'browser roles can read an unused raw/internal column';
  END IF;

  IF has_table_privilege('authenticated', 'public.event_required_roles', 'SELECT')
    OR has_table_privilege('authenticated', 'public.event_blocked_roles', 'SELECT')
    OR has_table_privilege('authenticated', 'private.season_configuration_action_logs', 'SELECT')
  THEN
    RAISE EXCEPTION 'browser roles can read service-only event eligibility configuration';
  END IF;

  IF has_column_privilege('authenticated', 'public.profiles', 'discord_user_id', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.brackets', 'submitted_at', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.bracket_picks', 'is_correct', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.bracket_picks', 'points_awarded', 'UPDATE')
  THEN
    RAISE EXCEPTION 'authenticated users can alter canonical identity or calculated bracket fields';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'private.security_test_future_helper()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'a future private helper inherited browser execution privileges';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.create_tournament_result_action_log(text,text,jsonb,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.upsert_lightning_cup_match_state(uuid,bigint,jsonb,text[])',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.approve_player_custom_url_claim(uuid,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.update_season_configuration(integer,integer,integer,integer,jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.undo_season_configuration_action(uuid)',
    'EXECUTE'
  ) OR has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a Worker-only or trigger function remains browser-callable';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.list_player_custom_url_claims()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.approve_player_custom_url_claim(uuid,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.revoke_player_custom_url_claim(uuid,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.update_season_configuration(integer,integer,integer,integer,jsonb)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.undo_season_configuration_action(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated Discord admins cannot call a custom URL moderation RPC';
  END IF;

  IF NOT has_column_privilege('anon', 'public.season_configuration', 'ranked_league_season', 'SELECT')
    OR NOT has_column_privilege('authenticated', 'public.season_configuration', 'shotgun_pro_league_stage', 'SELECT')
  THEN
    RAISE EXCEPTION 'public season configuration values are not readable';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.session_id', '33000000-0000-0000-0000-000000000001', true);

DO $$
DECLARE
  synced_discord_id text;
  new_bracket_id uuid;
BEGIN
  SELECT discord_user_id
  INTO synced_discord_id
  FROM public.sync_my_profile();

  IF synced_discord_id <> '930000000000000001' THEN
    RAISE EXCEPTION 'profile sync did not use the canonical Discord identity';
  END IF;

  INSERT INTO public.brackets (user_id, bracket_name, year)
  VALUES ('31000000-0000-0000-0000-000000000001', 'Player One', '2099')
  RETURNING id INTO new_bracket_id;

  INSERT INTO public.bracket_picks (
    bracket_id,
    match_id,
    round_code,
    round_number,
    selected_winner_name,
    selected_winner_seed,
    year
  )
  VALUES (new_bracket_id, 1, 'R64', 1, 'Player One', 1, '2099');

  INSERT INTO security_test_ids VALUES (new_bracket_id);

  INSERT INTO public.player_custom_urls (
    user_id,
    discord_user_id,
    slug,
    status
  ) VALUES (
    '31000000-0000-0000-0000-000000000001',
    '930000000000000001',
    'first-slug',
    'pending'
  );

  INSERT INTO public.event_signups (
    event_id,
    event_name,
    guild_id,
    discord_user_id,
    username,
    display_name
  ) VALUES (
    '95000000-0000-0000-0000-000000000001',
    'Security Test Event',
    '940000000000000001',
    '930000000000000001',
    'player-one',
    'Player One'
  );

  DELETE FROM public.event_signups
  WHERE event_id = '95000000-0000-0000-0000-000000000001'
    AND discord_user_id = '930000000000000001';

  BEGIN
    INSERT INTO public.brackets (user_id, bracket_name, year)
    VALUES ('31000000-0000-0000-0000-000000000001', 'Late entry', '2026');
    RAISE EXCEPTION 'the 2026 bracket cutoff was not enforced';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bracket_picks WHERE year = '2099') THEN
    RAISE EXCEPTION 'anonymous users can read picks before their public time';
  END IF;

  PERFORM
    run_id,
    discord_user_id,
    display_name,
    rating,
    raw_rating,
    weighted_matches,
    matches_played,
    rank
  FROM public.internal_tournament_gpi_ratings
  LIMIT 1;

  PERFORM
    id,
    calculation_version,
    model,
    base_rating,
    rating_scale,
    event_start,
    event_end,
    match_count,
    player_count,
    latest_match_at,
    created_at
  FROM public.internal_tournament_gpi_runs
  LIMIT 1;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.session_id', '33000000-0000-0000-0000-000000000003', true);
SELECT public.approve_player_custom_url_claim(
  '31000000-0000-0000-0000-000000000001',
  'first-slug'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_custom_urls
    WHERE user_id = '31000000-0000-0000-0000-000000000001'
      AND status = 'approved'
      AND approved_by_user_id = '31000000-0000-0000-0000-000000000003'
      AND approved_by_username = 'Administrator'
      AND approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'custom URL approval audit metadata was not generated from the admin actor';
  END IF;
END;
$$;

UPDATE public.discord_member_roles
SET scanned_at = transaction_timestamp() - interval '1 second'
WHERE guild_id = '940000000000000001'
  AND discord_user_id = '930000000000000001'
  AND role_id = '940000000000000099';

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.session_id', '33000000-0000-0000-0000-000000000001', true);

UPDATE public.player_custom_urls
SET
  slug = 'changed-slug',
  status = 'pending',
  approved_at = NULL,
  approved_by_user_id = NULL,
  approved_by_username = NULL
WHERE user_id = '31000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.player_custom_urls
    WHERE user_id = '31000000-0000-0000-0000-000000000001'
      AND slug = 'changed-slug'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'an owner could not reset an approved custom URL after changing its slug';
  END IF;

  BEGIN
    INSERT INTO public.event_signups (
      event_id,
      event_name,
      guild_id,
      discord_user_id,
      username,
      display_name
    ) VALUES (
      '95000000-0000-0000-0000-000000000001',
      'Security Test Event',
      '940000000000000001',
      '930000000000000001',
      'player-one',
      'Player One'
    );
    RAISE EXCEPTION 'a stale role assignment generation authorized an event signup';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.session_id', '33000000-0000-0000-0000-000000000002', true);

DO $$
DECLARE
  target_bracket_id uuid;
  affected_rows integer;
BEGIN
  SELECT bracket_id INTO target_bracket_id FROM security_test_ids;

  IF EXISTS (
    SELECT 1 FROM public.bracket_picks WHERE bracket_id = target_bracket_id
  ) THEN
    RAISE EXCEPTION 'another user can read pre-deadline picks';
  END IF;

  UPDATE public.bracket_picks
  SET selected_winner_name = 'Tampered'
  WHERE bracket_id = target_bracket_id;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 0 THEN
    RAISE EXCEPTION 'another user updated an owner bracket pick';
  END IF;

  BEGIN
    PERFORM public.approve_player_custom_url_claim(
      '31000000-0000-0000-0000-000000000001',
      'changed-slug'
    );
    RAISE EXCEPTION 'a non-admin approved a custom URL claim';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claim.session_id', '33000000-0000-0000-0000-000000000004', true);

DO $$
BEGIN
  IF public.is_tournament_result_admin() THEN
    RAISE EXCEPTION 'an email-only identity was treated as a Discord administrator';
  END IF;

  BEGIN
    PERFORM public.sync_my_profile();
    RAISE EXCEPTION 'an email-only identity used a Discord-only profile pathway';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.brackets (user_id, bracket_name, year)
    VALUES ('31000000-0000-0000-0000-000000000004', 'Email identity', '2099');
    RAISE EXCEPTION 'an email-only identity created a bracket';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
DELETE FROM auth.sessions WHERE id = '33000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.session_id', '33000000-0000-0000-0000-000000000001', true);

DO $$
BEGIN
  BEGIN
    PERFORM public.sync_my_profile();
    RAISE EXCEPTION 'a revoked session remained usable';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.session_id', '33000000-0000-0000-0000-000000000003', true);
SELECT public.revoke_player_custom_url_claim(
  '31000000-0000-0000-0000-000000000001',
  'changed-slug'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.player_custom_urls
    WHERE user_id = '31000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'custom URL revocation RPC did not delete the targeted claim';
  END IF;
END;
$$;

SELECT set_config(
  'request.headers',
  '{"x-nssgolf-actor-user-id":"31000000-0000-0000-0000-000000000001"}',
  true
);

DO $$
DECLARE
  valid_state jsonb := '{"version":1,"sets":[{},{},{}],"history":[],"undoStack":[]}'::jsonb;
BEGIN
  PERFORM public.upsert_lightning_cup_match_state(
    '31000000-0000-0000-0000-000000000001',
    1,
    valid_state,
    ARRAY['930000000000000001', '930000000000000003']
  );

  PERFORM set_config(
    'request.headers',
    '{"x-nssgolf-actor-user-id":"31000000-0000-0000-0000-000000000002"}',
    true
  );
  BEGIN
    PERFORM public.upsert_lightning_cup_match_state(
      '31000000-0000-0000-0000-000000000002',
      1,
      valid_state,
      ARRAY['930000000000000001', '930000000000000003']
    );
    RAISE EXCEPTION 'a non-competitor changed a Lightning Cup match state';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config(
    'request.headers',
    '{"x-nssgolf-actor-user-id":"31000000-0000-0000-0000-000000000003"}',
    true
  );
  PERFORM public.upsert_lightning_cup_match_state(
    '31000000-0000-0000-0000-000000000003',
    2,
    valid_state,
    '{}'::text[]
  );
END;
$$;

RESET ROLE;
\echo ok 1 - Data API RLS grants cutoff identity and Worker pathways
ROLLBACK;
