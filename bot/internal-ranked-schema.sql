-- Internal Ranked League match history and Elo replay tables.
--
-- These tables are for service-role scripts only. They intentionally do not
-- power the public Ranked League display on nssgolf.com.

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
  first_played_at timestamptz,
  last_played_at timestamptz,
  rank integer,
  primary key (run_id, discord_user_id)
);

create index if not exists internal_ranked_elo_ratings_run_rating_idx
on public.internal_ranked_elo_ratings (run_id, rating desc, discord_user_id);

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
alter table public.internal_ranked_elo_runs enable row level security;
alter table public.internal_ranked_elo_ratings enable row level security;
alter table public.internal_ranked_elo_match_results enable row level security;

revoke all on public.internal_ranked_matches from anon, authenticated;
revoke all on public.internal_ranked_elo_runs from anon, authenticated;
revoke all on public.internal_ranked_elo_ratings from anon, authenticated;
revoke all on public.internal_ranked_elo_match_results from anon, authenticated;

grant select, insert, update, delete on public.internal_ranked_matches to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_runs to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_ratings to service_role;
grant select, insert, update, delete on public.internal_ranked_elo_match_results to service_role;

grant usage, select on sequence public.internal_ranked_elo_runs_id_seq to service_role;

notify pgrst, 'reload schema';
