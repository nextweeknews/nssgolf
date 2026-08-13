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

The final Elo run is the atomic completion marker for the snapshot. The static site finds the latest Elo marker, then selects the newest ranked and tournament runs created at or before that marker. If a workflow fails before the final step, visitors continue to see the preceding complete snapshot rather than a mixture of old and new results.

The previous Elo marker identifies the comparison snapshot. The homepage and all GPI tables calculate rank movement as `previous rank - current rank`; positive movement uses the green Lucide up arrow and negative movement uses the red Lucide down arrow. New and unchanged players have no movement indicator.

## First run and manual recovery

Before the first automated refresh, run `snapshot-current` once. It replays Elo without fetching data, creating a baseline marker around the GPI runs already in Supabase. Then run `weekly-gpi` to fetch and publish the new snapshot. Those two markers allow the site to show the first rank deltas.

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

To inspect a production run, open the `Internal Ranked League` workflow and confirm that the final `Replay Elo history and publish the complete snapshot marker` step succeeded.
