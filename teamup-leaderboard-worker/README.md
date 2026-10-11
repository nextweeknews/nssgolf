# TeamUp OBS cache Worker

This is the source for `rapid-haze-012c`, used by the NSS Golf OBS graphics.
The baseline was recovered from the existing local Worker source and verified
byte-for-byte against production before adding the player-history route.

- `POST /get_leaderboard_snapshot` reads the canonical Season 14 KV snapshot.
- `GET /get_recent_changes` reads the recent match webhook cache.
- `POST /get_player_history` validates a player against the snapshot, reads the
  season's player-filtered TeamUp history, and caches it until the match count
  changes. New games fetch incrementally; an undo rebuilds the history.
- Other live proxy routes remain disabled.

Run `npm run test:teamup-leaderboard-worker` before deployment. Release the
reviewed source with:

```sh
npx wrangler deploy --config teamup-leaderboard-worker/wrangler.jsonc --keep-vars
```

`--keep-vars` preserves the existing dashboard-managed TeamUp and webhook
bindings. Their values must never be copied into source, command arguments,
or logs. This configuration contains only the public client/guild IDs and
the existing KV namespace. The separate, unfinished matchmaking callback
is not included in this source or deployment.
