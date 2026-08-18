begin;

-- Legacy bootstrap only. Once the canonical hardening migration exists, this
-- file must not be able to restore its retired grants or policies.
do $legacy_schema_guard$
begin
  if to_regclass('public.discord_guild_sync_state') is not null then
    raise exception 'This legacy schema file is retired for migrated projects. Apply Supabase migrations instead.';
  end if;
end;
$legacy_schema_guard$;

-- Internal Ranked League match history and Elo replay tables.
--
-- These tables are private internal data for writes. Service-role scripts write
-- them, and the lightweight NSS GPI page reads Elo run/rating summaries.
-- They intentionally do not power the public Ranked League display on nssgolf.com.

create table if not exists public.internal_ranked_matches (
  match_hash text primary key,
  season integer not null check (season >= 1),
  leaderboard text not null,
  timestamp_ms bigint not null check (timestamp_ms > 0),
  played_at timestamptz not null,
  versus text not null,
  team_sizes integer[] not null default '{}',
  result_signature text not null,
  raw_match jsonb not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_ranked_matches_season_played_at_idx
on public.internal_ranked_matches (season, played_at);

create index if not exists internal_ranked_matches_played_at_idx
on public.internal_ranked_matches (played_at, match_hash);

create index if not exists internal_ranked_matches_result_signature_idx
on public.internal_ranked_matches (season, result_signature);

create or replace function public.get_internal_ranked_head_to_head_matches(
  player_a_id text,
  player_b_id text
)
returns table (
  match_hash text,
  season integer,
  timestamp_ms bigint,
  played_at timestamptz,
  player_a_place integer,
  player_b_place integer
)
language sql
stable
security definer
set search_path = public
as $$
  with match_players as (
    select
      matches.match_hash,
      matches.season,
      matches.timestamp_ms,
      matches.played_at,
      player.value ->> 'player_id' as discord_user_id,
      (result.value ->> 'place')::integer as place
    from public.internal_ranked_matches as matches
    cross join lateral jsonb_array_elements(matches.raw_match -> 'results') as result(value)
    cross join lateral jsonb_array_elements(result.value -> 'players') as player(value)
    where
      player_a_id ~ '^[0-9]+$'
      and player_b_id ~ '^[0-9]+$'
      and player_a_id <> player_b_id
      and player.value ->> 'player_id' in (player_a_id, player_b_id)
      and result.value ->> 'place' ~ '^[0-9]+$'
  )
  select
    player_a.match_hash,
    player_a.season,
    player_a.timestamp_ms,
    player_a.played_at,
    player_a.place as player_a_place,
    player_b.place as player_b_place
  from match_players as player_a
  join match_players as player_b
    on player_b.match_hash = player_a.match_hash
  where
    player_a.discord_user_id = player_a_id
    and player_b.discord_user_id = player_b_id
  order by player_a.timestamp_ms, player_a.match_hash;
$$;

create table if not exists public.internal_ranked_elo_runs (
  id bigserial primary key,
  calculation_version text not null,
  base_rating numeric(12, 4) not null,
  k_factor numeric(12, 4) not null,
  season_start integer not null,
  season_end integer not null,
  match_count integer not null default 0,
  player_count integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists internal_ranked_elo_runs_created_at_idx
on public.internal_ranked_elo_runs (created_at desc);

create table if not exists public.internal_ranked_elo_ratings (
  run_id bigint not null references public.internal_ranked_elo_runs(id) on delete cascade,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  display_name text,
  rating numeric(12, 4) not null,
  peak_rating numeric(12, 4) not null,
  matches_played integer not null default 0,
  pairwise_wins integer not null default 0,
  pairwise_losses integer not null default 0,
  pairwise_ties integer not null default 0,
  pairwise_games integer not null default 0,
  first_place_finishes integer not null default 0,
  outcome_win_percentage numeric(10, 6) not null default 0,
  match_win_percentage numeric(10, 6) not null default 0,
  first_played_at timestamptz,
  last_played_at timestamptz,
  rank integer,
  primary key (run_id, discord_user_id)
);

alter table public.internal_ranked_elo_ratings
add column if not exists first_place_finishes integer not null default 0;

alter table public.internal_ranked_elo_ratings
add column if not exists outcome_win_percentage numeric(10, 6) not null default 0;

alter table public.internal_ranked_elo_ratings
add column if not exists match_win_percentage numeric(10, 6) not null default 0;

create index if not exists internal_ranked_elo_ratings_run_rating_idx
on public.internal_ranked_elo_ratings (run_id, rating desc, discord_user_id);

create index if not exists internal_ranked_elo_ratings_run_rank_idx
on public.internal_ranked_elo_ratings (run_id, rank, discord_user_id);

create index if not exists internal_ranked_elo_ratings_run_matches_idx
on public.internal_ranked_elo_ratings (run_id, matches_played desc, rank, discord_user_id);

create index if not exists internal_ranked_elo_ratings_run_wins_idx
on public.internal_ranked_elo_ratings (run_id, pairwise_wins desc, rank, discord_user_id);

create index if not exists internal_ranked_elo_ratings_run_outcome_win_pct_idx
on public.internal_ranked_elo_ratings (run_id, outcome_win_percentage desc, rank, discord_user_id);

create index if not exists internal_ranked_elo_ratings_run_match_win_pct_idx
on public.internal_ranked_elo_ratings (run_id, match_win_percentage desc, rank, discord_user_id);

create table if not exists public.internal_ranked_gpi_runs (
  id bigserial primary key,
  calculation_version text not null,
  model text not null,
  base_rating numeric(12, 4) not null,
  rating_scale numeric(12, 6),
  k_factor numeric(12, 4),
  season_start integer not null,
  season_end integer not null,
  match_count integer not null default 0,
  player_count integer not null default 0,
  latest_match_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists internal_ranked_gpi_runs_created_at_idx
on public.internal_ranked_gpi_runs (created_at desc);

alter table public.internal_ranked_gpi_runs
alter column rating_scale drop not null;

alter table public.internal_ranked_gpi_runs
add column if not exists k_factor numeric(12, 4);

create table if not exists public.internal_ranked_gpi_ratings (
  run_id bigint not null references public.internal_ranked_gpi_runs(id) on delete cascade,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  display_name text,
  rating numeric(12, 4) not null,
  raw_rating numeric(12, 4) not null,
  full_history_rating numeric(12, 4),
  potential_rating numeric(12, 4),
  recent_form_rating numeric(12, 4),
  ability numeric(18, 8) not null,
  skill_log numeric(18, 8) not null,
  reliability numeric(10, 6) not null default 0,
  matches_played integer not null default 0,
  weighted_matches numeric(14, 8) not null default 0,
  average_match_weight numeric(10, 6) not null default 0,
  pairwise_wins integer not null default 0,
  pairwise_losses integer not null default 0,
  pairwise_ties integer not null default 0,
  pairwise_games integer not null default 0,
  first_place_finishes integer not null default 0,
  outcome_win_percentage numeric(10, 6) not null default 0,
  match_win_percentage numeric(10, 6) not null default 0,
  placement_score_average numeric(10, 6) not null default 0,
  weighted_placement_score numeric(10, 6) not null default 0,
  first_played_at timestamptz,
  last_played_at timestamptz,
  rank integer,
  primary key (run_id, discord_user_id)
);

alter table public.internal_ranked_gpi_ratings
add column if not exists full_history_rating numeric(12, 4);

alter table public.internal_ranked_gpi_ratings
add column if not exists potential_rating numeric(12, 4);

alter table public.internal_ranked_gpi_ratings
add column if not exists recent_form_rating numeric(12, 4);

create index if not exists internal_ranked_gpi_ratings_run_rating_idx
on public.internal_ranked_gpi_ratings (run_id, rating desc, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_rank_idx
on public.internal_ranked_gpi_ratings (run_id, rank, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_matches_idx
on public.internal_ranked_gpi_ratings (run_id, matches_played desc, rank, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_wins_idx
on public.internal_ranked_gpi_ratings (run_id, pairwise_wins desc, rank, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_outcome_win_pct_idx
on public.internal_ranked_gpi_ratings (run_id, outcome_win_percentage desc, rank, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_match_win_pct_idx
on public.internal_ranked_gpi_ratings (run_id, match_win_percentage desc, rank, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_weighted_matches_idx
on public.internal_ranked_gpi_ratings (run_id, weighted_matches desc, rank, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_reliability_idx
on public.internal_ranked_gpi_ratings (run_id, reliability desc, rank, discord_user_id);

create index if not exists internal_ranked_gpi_ratings_run_weighted_placement_idx
on public.internal_ranked_gpi_ratings (run_id, weighted_placement_score desc, rank, discord_user_id);

create table if not exists public.internal_ranked_gpi_match_results (
  run_id bigint not null references public.internal_ranked_gpi_runs(id) on delete cascade,
  match_hash text not null references public.internal_ranked_matches(match_hash) on delete cascade,
  season integer not null,
  timestamp_ms bigint not null,
  played_at timestamptz not null,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  display_name text,
  place integer not null,
  player_count integer not null,
  participant_weight numeric(10, 6) not null default 1,
  normalized_score numeric(10, 6) not null,
  expected_score numeric(10, 6) not null,
  rating_before numeric(12, 4) not null,
  rating_delta numeric(12, 4) not null,
  rating_after numeric(12, 4) not null,
  pairwise_wins integer not null default 0,
  pairwise_losses integer not null default 0,
  pairwise_ties integer not null default 0,
  primary key (run_id, match_hash, discord_user_id)
);

create index if not exists internal_ranked_gpi_match_results_player_idx
on public.internal_ranked_gpi_match_results (run_id, discord_user_id, played_at);

create index if not exists internal_ranked_gpi_match_results_match_idx
on public.internal_ranked_gpi_match_results (run_id, played_at, match_hash);

create or replace function public.set_internal_ranked_matches_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_internal_ranked_matches_updated_at
on public.internal_ranked_matches;

create trigger set_internal_ranked_matches_updated_at
before update on public.internal_ranked_matches
for each row
execute function public.set_internal_ranked_matches_updated_at();

alter table public.internal_ranked_matches enable row level security;

revoke all on public.internal_ranked_matches from anon, authenticated;
revoke all on public.internal_ranked_elo_runs from anon, authenticated;
revoke all on public.internal_ranked_elo_ratings from anon, authenticated;
revoke all on public.internal_ranked_gpi_runs from anon, authenticated;
revoke all on public.internal_ranked_gpi_ratings from anon, authenticated;
revoke all on public.internal_ranked_gpi_match_results from anon, authenticated;

grant select, insert, update, delete on public.internal_ranked_matches to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_runs to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_ratings to service_role;
grant select, insert, update, delete on public.internal_ranked_gpi_runs to service_role;
grant select, insert, update, delete on public.internal_ranked_gpi_ratings to service_role;
grant select, insert, update, delete on public.internal_ranked_gpi_match_results to service_role;

revoke all on function public.get_internal_ranked_head_to_head_matches(text, text) from public;
grant execute on function public.get_internal_ranked_head_to_head_matches(text, text) to anon, authenticated;
grant execute on function public.get_internal_ranked_head_to_head_matches(text, text) to service_role;

grant usage, select on sequence public.internal_ranked_elo_runs_id_seq to service_role;
grant usage, select on sequence public.internal_ranked_gpi_runs_id_seq to service_role;

drop policy if exists "rank admins can read internal ranked elo runs"
on public.internal_ranked_elo_runs;
drop policy if exists "rank admins can read internal ranked elo ratings"
on public.internal_ranked_elo_ratings;

alter table public.internal_ranked_elo_runs disable row level security;
alter table public.internal_ranked_elo_ratings disable row level security;
alter table public.internal_ranked_gpi_runs disable row level security;
alter table public.internal_ranked_gpi_ratings disable row level security;
alter table public.internal_ranked_gpi_match_results disable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.internal_ranked_elo_runs to anon, authenticated;
grant select on public.internal_ranked_elo_ratings to anon, authenticated;
grant select on public.internal_ranked_gpi_runs to anon, authenticated;
grant select on public.internal_ranked_gpi_ratings to anon, authenticated;
grant select on public.internal_ranked_gpi_match_results to anon, authenticated;

create table if not exists public.internal_tournament_matches (
  match_hash text primary key,
  event_key text not null check (length(trim(event_key)) > 0),
  event_name text not null check (length(trim(event_name)) > 0),
  event_order integer not null check (event_order > 0),
  match_order integer not null check (match_order > 0),
  source_match_id text not null,
  round_label text,
  timestamp_ms bigint not null check (timestamp_ms > 0),
  played_at timestamptz not null,
  player_a_discord_user_id text not null check (player_a_discord_user_id ~ '^[0-9]+$'),
  player_a_name text not null,
  player_a_score text,
  player_b_discord_user_id text not null check (player_b_discord_user_id ~ '^[0-9]+$'),
  player_b_name text not null,
  player_b_score text,
  winner_discord_user_id text not null check (winner_discord_user_id ~ '^[0-9]+$'),
  raw_match jsonb not null,
  raw_source jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_key, source_match_id)
);

create index if not exists internal_tournament_matches_order_idx
on public.internal_tournament_matches (event_order, match_order, match_hash);

create index if not exists internal_tournament_matches_player_a_idx
on public.internal_tournament_matches (player_a_discord_user_id, event_order, match_order);

create index if not exists internal_tournament_matches_player_b_idx
on public.internal_tournament_matches (player_b_discord_user_id, event_order, match_order);

create table if not exists public.internal_tournament_gpi_runs (
  id bigserial primary key,
  calculation_version text not null,
  model text not null,
  base_rating numeric(12, 4) not null,
  rating_scale numeric(12, 6),
  event_start text not null,
  event_end text not null,
  match_count integer not null default 0,
  player_count integer not null default 0,
  latest_match_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists internal_tournament_gpi_runs_created_at_idx
on public.internal_tournament_gpi_runs (created_at desc);

create table if not exists public.internal_tournament_gpi_ratings (
  run_id bigint not null references public.internal_tournament_gpi_runs(id) on delete cascade,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  display_name text,
  rating numeric(12, 4) not null,
  raw_rating numeric(12, 4) not null,
  ability numeric(18, 8) not null,
  skill_log numeric(18, 8) not null,
  reliability numeric(10, 6) not null default 0,
  matches_played integer not null default 0,
  weighted_matches numeric(14, 8) not null default 0,
  average_match_weight numeric(10, 6) not null default 0,
  pairwise_wins integer not null default 0,
  pairwise_losses integer not null default 0,
  pairwise_ties integer not null default 0,
  pairwise_games integer not null default 0,
  first_place_finishes integer not null default 0,
  outcome_win_percentage numeric(10, 6) not null default 0,
  match_win_percentage numeric(10, 6) not null default 0,
  placement_score_average numeric(10, 6) not null default 0,
  weighted_placement_score numeric(10, 6) not null default 0,
  first_played_at timestamptz,
  last_played_at timestamptz,
  rank integer,
  primary key (run_id, discord_user_id)
);

create index if not exists internal_tournament_gpi_ratings_run_rating_idx
on public.internal_tournament_gpi_ratings (run_id, rating desc, discord_user_id);

create index if not exists internal_tournament_gpi_ratings_run_rank_idx
on public.internal_tournament_gpi_ratings (run_id, rank, discord_user_id);

create index if not exists internal_tournament_gpi_ratings_run_matches_idx
on public.internal_tournament_gpi_ratings (run_id, matches_played desc, rank, discord_user_id);

grant select, insert, update, delete on public.internal_tournament_matches to service_role;
grant select, insert, update, delete on public.internal_tournament_gpi_runs to service_role;
grant select, insert, update, delete on public.internal_tournament_gpi_ratings to service_role;
grant usage, select on sequence public.internal_tournament_gpi_runs_id_seq to service_role;

alter table public.internal_tournament_matches disable row level security;
alter table public.internal_tournament_gpi_runs disable row level security;
alter table public.internal_tournament_gpi_ratings disable row level security;

grant select on public.internal_tournament_matches to anon, authenticated;
grant select on public.internal_tournament_gpi_runs to anon, authenticated;
grant select on public.internal_tournament_gpi_ratings to anon, authenticated;

notify pgrst, 'reload schema';

commit;
