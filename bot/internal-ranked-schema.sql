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

create table if not exists public.internal_ranked_elo_match_results (
  run_id bigint not null references public.internal_ranked_elo_runs(id) on delete cascade,
  match_hash text not null references public.internal_ranked_matches(match_hash) on delete cascade,
  season integer not null,
  timestamp_ms bigint not null,
  played_at timestamptz not null,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]+$'),
  display_name text,
  place integer not null,
  rating_before numeric(12, 4) not null,
  rating_delta numeric(12, 4) not null,
  rating_after numeric(12, 4) not null,
  pairwise_wins integer not null default 0,
  pairwise_losses integer not null default 0,
  pairwise_ties integer not null default 0,
  primary key (run_id, match_hash, discord_user_id)
);

create index if not exists internal_ranked_elo_match_results_player_idx
on public.internal_ranked_elo_match_results (run_id, discord_user_id, played_at);

create index if not exists internal_ranked_elo_match_results_match_idx
on public.internal_ranked_elo_match_results (run_id, played_at, match_hash);

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
revoke all on public.internal_ranked_elo_match_results from anon, authenticated;
revoke all on public.internal_ranked_gpi_runs from anon, authenticated;
revoke all on public.internal_ranked_gpi_ratings from anon, authenticated;

grant select, insert, update, delete on public.internal_ranked_matches to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_runs to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_ratings to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_match_results to service_role;
grant select, insert, update, delete on public.internal_ranked_gpi_runs to service_role;
grant select, insert, update, delete on public.internal_ranked_gpi_ratings to service_role;

grant usage, select on sequence public.internal_ranked_elo_runs_id_seq to service_role;
grant usage, select on sequence public.internal_ranked_gpi_runs_id_seq to service_role;

drop policy if exists "rank admins can read internal ranked elo runs"
on public.internal_ranked_elo_runs;
drop policy if exists "rank admins can read internal ranked elo ratings"
on public.internal_ranked_elo_ratings;

alter table public.internal_ranked_elo_runs disable row level security;
alter table public.internal_ranked_elo_ratings disable row level security;
alter table public.internal_ranked_elo_match_results disable row level security;
alter table public.internal_ranked_gpi_runs disable row level security;
alter table public.internal_ranked_gpi_ratings disable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.internal_ranked_elo_runs to anon, authenticated;
grant select on public.internal_ranked_elo_ratings to anon, authenticated;
grant select on public.internal_ranked_elo_match_results to anon, authenticated;
grant select on public.internal_ranked_gpi_runs to anon, authenticated;
grant select on public.internal_ranked_gpi_ratings to anon, authenticated;

notify pgrst, 'reload schema';
