# Tournament admin edit range inventory

Verified read-only against the live Google Sheets on 2026-08-17. The public page ranges remain the source of display data. Admin writes are separately limited to the explicit ranges below; player-advancement and winner cells remain read-only. Pro League also permits names only in its pre-existing individual-player slots.

## World Golf Masters

Spreadsheet: `16r1G1StlWQflPjAqFbHip_Y3hRo85F6iS3jYyK25CwE`

| Public source range | Admin table | Editable score ranges | Formula ranges | Notes |
| --- | --- | --- | --- | --- |
| `'Qualifiers'!A:T` | `'Qualifiers'!H1:T16` | `K2:N16`, `P2:S16` | `J2:J16`, `O2:O16`, `T2:T16` | J/O advance player names; T calculates the winner. K:M and P:R are round scores; N/S are match scores. |
| `'Bracket'!A1:R16` | `'Bracket'!A1:R16` | `C2:I16`, `K2:Q16` | `B10:B16`, `J10:J16`, `R2:R16` | C:G and K:O are round scores; H/P are sudden-death scores; I/Q are match scores. Later-round names and all winners are formulas. |
| `'Discord IDs'!A:B` | None | None | None | Read-only player identity lookup. |

## World Championship

Spreadsheet: `10nVyu3uM_PbK6fDgmomtjlHakNJ1oIM66MRXXHX3k_Q`

| Public source range | Admin table | Editable score ranges | Formula ranges | Notes |
| --- | --- | --- | --- | --- |
| `'Field'!B:C` | None | None | None | Read-only player identity lookup. |
| `'Bracket'!A:Z` | `'Bracket'!A2:Z66` | `E3:N66`, `Q3:Z66` | `C3:D66`, `O3:P66` | E/Q are match scores; F:N and R:Z are round scores. Seeds and player names are formulas. |

The Championship bracket also depends on hidden formula columns `AA3:AB66`. AA calculates each match winner from E/Q and AB mirrors AA for later-round player formulas. The public page does not request these columns, and the admin API does not expose them as writable cells.

## Shotgun Pro League

Spreadsheet: `1qIM0HKhx9Y-3eCJCFzBqrbATwiPrK3C1ynATwZzRC1o`

The editor mirrors the public season/stage selector: 2026 All-Stars, Seasons 1–5, and the Stage 1, Stage 2, Stage 3, and Championship views for Seasons 6–7. Only the selected period is read from Google when the editor loads.

| Edit view | Admin table | Editable ranges | Protected cells | Notes |
| --- | --- | --- | --- | --- |
| Seasons 6–7, Stage 1–3 | Each stage's `A3:S101` block | `L:S` on team player rows `5:8`, `10:13`, continuing through `60:63`; `C` and `L:S` on individual-player rows `66:101` | Team headers and `A:K` outside individual names | L:S are the eight raw round scores. Blank individual rows stay hidden until Add player reserves one. |
| Seasons 1–5 | Each season's `A3:S101` block | `L:S` on four-player team blocks; `C` and `L:S` on the individual-player area after that season's roster | Team headers and `A:K` outside individual names | The roster bounds match the per-season ranges used by the public page. |
| 2026 All-Stars | `'2026 All-Stars'!B3:G35` | `D4:G35` | Player names and formula total column C | The four round columns use the same `1-1` through `2-2` labels as the public view. |
| Championship | `B3:H23` | `E:H` on player rows `5:8`, `10:13`, `15:18`, and `20:23` | `B:D` | E:F are semifinal rounds and G:H are final rounds. |
| Championship | `O3:P9`, `R4:S8` | `P3`, `P5`, `P7`, `P9`, `S4`, and `S8` | Team-name and champion cells | These are the team scores displayed in the public semifinal and final bracket. |

The service account must be shared as an Editor on this workbook before the archived event is enabled for writes.

## Super League

Spreadsheet: `1BbT8t6erCVdx-Bdshv_hax9r9JSRzU1WygjWxW3vPkY`

The editor follows the active `SUPER_LEAGUE_SEASON` (`Season 6`) and separates the public score surfaces into Season and Qualifiers tabs. The public Format tab is static, and Promotions has no Season 6 data, so neither produces an edit tab.

| Edit tab | Admin table | Editable score ranges | Protected cells | Notes |
| --- | --- | --- | --- | --- |
| Season | `'Season 6'!I2:AB85` | `M:O`, `V:X` | `P:S`, `Y:AB` | Three raw round scores for each side of every regular-season matchup. |
| Season | `'Season 6'!I87:AB92` | `M:O`, `V:X` | `P:S`, `Y:AB` | Three raw round scores for each side of each playoff matchup. |
| Qualifiers | `'S6 Winners Bracket'!A3:H80` | `E5:E68`, `H5:H68` | Player, seed, match, and round formula columns | One bracket score for each side. The winner-bracket placement row is included. |
| Qualifiers | `'S6 Losers Bracket'!A4:H62` | `E4:E62`, `H4:H62` | Player, seed, match, and round formula columns | One bracket score for each side. The loser-bracket placement row is included. |

The service account must be shared as an Editor on this workbook before the archived event is enabled for writes.

Google Sheet protection settings are defense in depth only. The Worker must enforce the Supabase-provided editable ranges before every `values:batchUpdate` request, so even an Editor-capable service account cannot overwrite formulas through the admin API.

## Worker contract

Both operations require the signed-in user's Supabase access token as `Authorization: Bearer <token>` and return `Cache-Control: no-store`.

- `GET /admin/tournament-results?eventKey=masters` returns the canonical event metadata, editor table definitions (including optional edit-view grouping), and current Google `valueRanges`. Supplying a canonical `viewKey` restricts the Google read to that view's registered source ranges.
- `POST /admin/tournament-results` accepts `{ "eventKey": "masters", "updates": [{ "range": "'Bracket'!C2", "values": [[-14]] }] }`.

The Worker obtains the canonical spreadsheet ID and editable ranges from the authenticated Supabase RPC, ignores any client-supplied spreadsheet ID, writes with `valueInputOption: "RAW"`, and limits each request to 200 ranges, 2,000 cells, and a 1 MB body. Archived or disabled events remain readable but cannot be written.

## Required action log and undo flow

Every edit save is audit-gated. After validating the canonical event and editable ranges, the Worker reserves a pending action through `create_tournament_result_action_log()`, reads the current unformatted Google values, and fills that action with the exact before/after matrices through `set_tournament_result_action_log_changes()`. Google `values:batchUpdate` is not called unless both RPCs succeed. The Worker then marks the log succeeded or failed through `complete_tournament_result_action_log()`.

`/admin/action-logs.html` lists these records through the admin-only `list_tournament_result_action_logs()` RPC. A successful edit can be undone once while its event remains active. Before undoing, the Worker confirms that every current Google value still equals the logged after-value; if any value changed later, undo returns a conflict instead of overwriting newer work. The inverse before/after payload is derived inside `create_tournament_result_action_log()` and the undo itself creates a second audit record before Google is updated.
