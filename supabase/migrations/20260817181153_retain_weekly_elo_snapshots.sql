alter table public.internal_ranked_elo_ratings
add column peak_rating numeric(12, 4);

with peaks as (
  select
    results.run_id,
    results.discord_user_id,
    greatest(runs.base_rating, max(results.rating_after)) as peak_rating
  from public.internal_ranked_elo_match_results as results
  join public.internal_ranked_elo_runs as runs
    on runs.id = results.run_id
  group by results.run_id, results.discord_user_id, runs.base_rating
)
update public.internal_ranked_elo_ratings as ratings
set peak_rating = peaks.peak_rating
from peaks
where
  peaks.run_id = ratings.run_id
  and peaks.discord_user_id = ratings.discord_user_id;

alter table public.internal_ranked_elo_ratings
alter column peak_rating set not null;

drop table public.internal_ranked_elo_match_results;
