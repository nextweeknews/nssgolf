# Tournament admin edit range inventory

Verified read-only against the live Google Sheets on 2026-08-16. The public page ranges remain the source of display data. Admin writes are separately limited to the score ranges below; identity, player-advancement, and winner cells are never writable through the Worker.

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

Google Sheet protection settings are defense in depth only. The Worker must enforce the Supabase-provided editable ranges before every `values:batchUpdate` request, so even an Editor-capable service account cannot overwrite formulas through the admin API.

## Worker contract

Both operations require the signed-in user's Supabase access token as `Authorization: Bearer <token>` and return `Cache-Control: no-store`.

- `GET /admin/tournament-results?eventKey=masters` returns the canonical event metadata, editor table definitions, and current Google `valueRanges`.
- `POST /admin/tournament-results` accepts `{ "eventKey": "masters", "updates": [{ "range": "'Bracket'!C2", "values": [[-14]] }] }`.

The Worker obtains the canonical spreadsheet ID and editable ranges from the authenticated Supabase RPC, ignores any client-supplied spreadsheet ID, writes with `valueInputOption: "RAW"`, and limits each request to 200 ranges, 2,000 cells, and a 1 MB body. Archived or disabled events remain readable but cannot be written.
