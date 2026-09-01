-- Synthetic local-only fixtures. Never promote this data to the linked project.

BEGIN;

INSERT INTO public.discord_guild_members (
  guild_id,
  discord_user_id,
  username,
  global_name,
  display_name,
  is_current_member,
  last_scanned_at
)
VALUES
  ('980000000000000001', '990000000000000001', 'local-admin', 'Avery Admin', 'Avery Admin', true, '2026-08-24T00:00:00Z'),
  ('980000000000000001', '990000000000000002', 'local-player', 'Parker Player', 'Parker Player', true, '2026-08-24T00:00:00Z'),
  ('980000000000000001', '990000000000000003', 'local-rival', 'Riley Rival', 'Riley Rival', true, '2026-08-24T00:00:00Z');

INSERT INTO public.discord_roles (
  guild_id,
  role_id,
  name,
  "position",
  is_current_role,
  last_scanned_at
)
VALUES (
  '980000000000000001',
  '1069007873985740890',
  'Local Administrator',
  100,
  true,
  '2026-08-24T00:00:00Z'
);

INSERT INTO public.discord_member_roles (guild_id, discord_user_id, role_id, scanned_at)
VALUES (
  '980000000000000001',
  '990000000000000001',
  '1069007873985740890',
  '2026-08-24T00:00:00Z'
);

INSERT INTO public.discord_guild_sync_state (guild_id, completed_at)
VALUES ('980000000000000001', '2026-08-24T00:00:00Z');

INSERT INTO public.internal_ranked_gpi_runs (
  id,
  calculation_version,
  model,
  base_rating,
  season_start,
  season_end,
  match_count,
  player_count,
  latest_match_at,
  config,
  created_at
)
VALUES
  (9001, 'local-fixture', 'combined', 1500, 7, 13, 24, 3, '2026-08-23T00:00:00Z', '{"ranking_at":"2026-08-24T00:00:00Z"}', '2026-08-24T00:00:00Z'),
  (9002, 'local-fixture', 'combined', 1500, 7, 13, 21, 3, '2026-08-16T00:00:00Z', '{"ranking_at":"2026-08-17T00:00:00Z"}', '2026-08-17T00:00:00Z');

INSERT INTO public.internal_ranked_gpi_ratings (
  run_id,
  discord_user_id,
  display_name,
  rating,
  raw_rating,
  ability,
  skill_log,
  reliability,
  matches_played,
  weighted_matches,
  rank
)
VALUES
  (9001, '990000000000000001', 'Avery Admin', 1612, 1605, 1, 1, 0.92, 9, 8.5, 1),
  (9001, '990000000000000002', 'Parker Player', 1568, 1560, 1, 1, 0.88, 8, 7.5, 2),
  (9001, '990000000000000003', 'Riley Rival', 1519, 1514, 1, 1, 0.81, 7, 6.5, 3),
  (9002, '990000000000000002', 'Parker Player', 1580, 1574, 1, 1, 0.86, 7, 6.5, 1),
  (9002, '990000000000000001', 'Avery Admin', 1566, 1560, 1, 1, 0.84, 7, 6.5, 2),
  (9002, '990000000000000003', 'Riley Rival', 1510, 1506, 1, 1, 0.78, 7, 6, 3);

INSERT INTO public.ranked (season, payload)
VALUES (
  13,
  '{"players":[{"player_id":"990000000000000001","rank":1,"elo":1612},{"player_id":"990000000000000002","rank":2,"elo":1568},{"player_id":"990000000000000003","rank":3,"elo":1519}]}'
);

INSERT INTO public.events (id, guild_id, name, deadline_at, created_by_discord_user_id)
VALUES (
  '97000000-0000-4000-8000-000000000001',
  '980000000000000001',
  'Local Match Night',
  '2099-01-01T00:00:00Z',
  '990000000000000001'
);

COMMIT;
