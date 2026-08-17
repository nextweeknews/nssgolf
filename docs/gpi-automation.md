# GPI weekly automation

The `Internal Ranked League` GitHub Actions workflow publishes a complete Golf Power Index snapshot every Monday at 00:00 UTC. It can also be run manually with the `weekly-gpi` workflow option.

## Weekly sequence

1. Read `CURRENT_RANKED_LEAGUE_SEASON` from `config.js`.
2. Read the newest stored match for the configured current season and create its TeamUp timestamp cursor.
3. Fetch only newer matches from that current season and upsert them into `internal_ranked_matches`. Older seasons are static replay inputs and are never fetched by the scheduled run.
4. Replay the complete stored ranked history into a new immutable PL/GPI run.
5. Fetch every tournament in `bot/tournament-gpi.js` whose status is `active` or `historical`. Events or rounds containing `qualifier` or `qualifiers` are excluded.
6. Replay the complete eligible tournament history into a new immutable tournament PL run.
7. Replay the complete stored ranked Elo history last.
8. Combine the newest ranked and tournament runs, save every display-ready GPI row, and atomically publish that run with `model = 'combined'`.

The combined run is the public snapshot. It remains marked `combined_building` while its rating rows are inserted and changes to `combined` only after every row succeeds. If a workflow fails before that change, visitors continue to see the preceding complete snapshot rather than a mixture of old and new results.

The Elo replay keeps match-by-match transitions in memory only. Each completed weekly run stores one current and peak Elo snapshot per player in `internal_ranked_elo_ratings`; `internal_ranked_matches` remains the canonical history for exact replays after corrected matches or calculation changes.

The date shown by the site comes from `config.ranking_at`, falling back to the run's `created_at` for older records. This keeps the public ranking date independent from workflow runtime while preserving the immutable run chronology.

The previous combined run identifies the comparison snapshot. The homepage and all GPI tables calculate rank movement as `previous rank - current rank`; positive movement uses the green Lucide up arrow, negative movement uses the red Lucide down arrow, and unchanged or new players show a gray dash.

The GPI page queries only the selected combined run and requests one 100-row range at a time. It fetches previous ranks only for those 100 player IDs. Loaded snapshot/page combinations are cached in memory for immediate back-navigation; the cache disappears with the browser page session, so a new visit always checks Supabase. The homepage reads the latest two combined runs and at most 100 rows from each to render its top-25 preview and deltas.

## First run and manual recovery

Before the first automated refresh, run `snapshot-current` once. It replays Elo without fetching data and publishes a baseline combined snapshot around the GPI runs already in Supabase. Then run `weekly-gpi` to fetch and publish the new snapshot. Those two snapshots allow the site to show the first rank deltas.

For existing Elo markers that predate combined snapshot storage, run the `snapshot-combined` workflow option. It publishes display-ready combined snapshots for the two newest markers without fetching or replaying any matches.

If a weekly run fails, fix the source or credential issue and rerun `weekly-gpi`. Failed partial replays are harmless because the site does not adopt them until the final Elo marker exists.

## Tournament configuration

Tournament eligibility is configured in `eventOrder` in `bot/tournament-gpi.js`:

```js
{ key: "world_championship_2026", name: "World Championship", status: "active" }
```

Use `active` for an event that should continue to refresh, `historical` for a completed event that should remain in the replay, and any other status to omit it. Qualifier events should additionally use a name, key, or phase containing `qualifier`; qualifier rows already stored in Supabase are also filtered by event and round labels during replay.

## Secrets and verification

The `github-pages` Actions environment must provide:

- `NSSGOLF_SUPABASE_URL`
- `NSSGOLF_SUPABASE_SERVICE_ROLE_KEY`

The service-role key is used only by the server-side workflow. The static site continues to use the public Supabase client and read-only policies.

For local verification, run:

```sh
npm run test:internal-ranked
npm run test:tournament-gpi
```

To inspect a production run, open the `Internal Ranked League` workflow and confirm that the final `Replay Elo history and publish the complete GPI snapshot` step succeeded.
