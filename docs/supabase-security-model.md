# Supabase Data API security model

This document records the intended access model implemented by
`20260818010134_harden_data_api_access.sql`. Supabase grants decide which
operations a browser role may attempt; RLS then decides which rows it may use.
Bot and import processes use a server-side Supabase secret/service-role key.

## Table and view access

| Relation | Website/process use | Browser access | Write authority and security implication |
| --- | --- | --- | --- |
| `bracket_event_settings` | Lightning Cup deadline/countdown | Public read | Service only. The `2026` cutoff and pick-public time are `2026-04-10T17:00:00Z`. |
| `brackets` | Bracket owner and leaderboard metadata | Public read of the website fields | A live Discord user may insert their own row and update only its name before the configured deadline. Submission time remains server-controlled. |
| `bracket_picks` | Saved picks and leaderboard scoring | Owner read before `picks_public_at`; public read afterward | Owners may insert/update/delete only input fields before the deadline. API users cannot write calculated correctness or points. |
| `bracket_leaderboard` | Legacy/optional aggregate view | Public read through a security-invoker view | No direct write path; underlying RLS remains effective. |
| `championship_point_settings` | Public Championship scoring configuration | Only `id`, settings, and hidden-player keys are public | Direct browser writes are revoked. Discord admins use `save_championship_point_values`, which validates the exact supported event/key/array schema and bounded integer values. |
| `discord_guild_members` | Names, avatars, membership state | Public read of website display fields; scan generations and creation audit are hidden | Service-only Discord scan writes. |
| `discord_guild_sync_state` | Completed Discord role-assignment generation used by authorization | No browser access | Written only by the service-role scanner after all member-role rows are replaced. A partial scan leaves the prior marker in place, so mismatched new/old rows fail closed. |
| `discord_member_roles` | Public role-based display and server authorization source | Public guild/user/role IDs only; scan generation is hidden | Service-only Discord scan writes. Authorization functions use canonical `auth.identities`, never mutable profile data, and accept only a fully completed guild scan generation. |
| `discord_roles` | Role names and display metadata | Public guild/role ID, name, and position only | Service-only Discord scan writes. Current-role and scan/audit state remain private authorization inputs. |
| `discord_global_rank_display_messages` | Bot message/webhook state, including a webhook token | No browser access; intentional deny-all RLS | Service only. Exposing this row would disclose a write credential. |
| `events` | Event signup configuration and deadline | Live Discord sessions only | Service-only event creation/update. |
| `event_required_roles` | Signup eligibility | No direct browser access | Service-only event configuration, evaluated by a private fail-closed eligibility helper. |
| `event_blocked_roles` | Signup exclusion rules | No direct browser access | Service-only event configuration, evaluated by a private fail-closed eligibility helper. |
| `event_signups` | Signup roster | Live Discord sessions see roster fields only | A current guild member may insert/delete only their own Discord ID before the event deadline, and insert only when required/blocked roles belong to the completed Discord scan generation. Signup timestamps are server-generated. |
| `event_signup_display_messages` | Bot-managed Discord display messages | No browser access; intentional deny-all RLS | Service only. |
| `gpi_hidden_players` | Public GPI moderation state | Only hidden Discord IDs are public | Direct browser writes are revoked; audited Discord-admin visibility RPC only. |
| `internal_ranked_elo_ratings` | Public ranked ratings | Public read under RLS | Service-only calculation/import writes. |
| `internal_ranked_elo_runs` | Public ranked run metadata | Selected public columns only; calculation `config` is hidden | Service-only calculation writes. |
| `internal_ranked_gpi_match_results` | Public derived per-match GPI results | Public read under RLS | Service-only calculation writes. |
| `internal_ranked_gpi_ratings` | Public ranked GPI ratings | Public read under RLS | Service-only calculation writes. |
| `internal_ranked_gpi_runs` | Public ranked GPI snapshots/config needed by historical views | Public read under RLS | Service-only calculation writes. Historical pages retain exact run linkage. |
| `internal_ranked_matches` | Raw imported ranked match JSON | No direct browser access; intentional deny-all RLS | Service-only imports. Public compare pages use the validated, read-only head-to-head RPC. |
| `internal_tournament_gpi_ratings` | Public tournament ratings | Public read under RLS | Service-only calculation writes. |
| `internal_tournament_gpi_runs` | Tournament rating snapshots | Selected public metadata only; calculation `config` is hidden | Service-only calculation writes. |
| `internal_tournament_matches` | Public tournament history | Derived match columns only | `raw_match`, `raw_source`, and import/audit timestamps are not browser-readable. Service-only imports. |
| `match_states` | Public Lightning Cup live scoreboard and Realtime feed | Public match ID, state, and update time only; creator/audit identity is hidden from REST and selected out of Realtime payloads | No direct browser writes. The Worker resolves the two competitors from canonical Lightning Cup sheets, validates a live Discord session, and invokes a service-only RPC that also permits Discord admins. |
| `player_custom_urls` | Approved public player URLs and owner claim status | Anonymous users see only slug, Discord ID, and status on approved rows; owners see only their claim identity/status fields | Owners may submit/reset/delete only pending claims tied to their canonical Discord identity. Admin list/approve/revoke operations use narrow RPCs that validate a live Discord administrator and generate approval audit metadata server-side. |
| `player_global_rank_moderation` | Public hidden-rank state | Only Discord ID and rank key are public | Direct writes revoked; audited Discord-admin visibility RPC only. |
| `player_league_aliases` | Public active league/player mappings | Active mapping fields and notes are public; source and audit timestamps are hidden | Service-only alias automation writes. Notes and mapping metadata remain readable because the local alias-suggestion process intentionally supports a publishable-key read path. |
| `player_settings` | Public country/time-zone/rank display | Only Discord ID and displayed settings/ranks are public; row ownership and audit timestamps are hidden | A live Discord user may insert/update their canonical row and the user-editable settings columns. Service bots may update ranks. |
| `profiles` | Public username/Discord identity mapping | Only user ID, username, Discord ID, and provider name are public; audit timestamps are hidden | Users may update only a nonblank username of at most 32 characters. `discord_user_id` and provider name are synchronized from `auth.identities` by `sync_my_profile`. |
| `ranked` | Public ranked payloads | Public read | Service-only publication writes. |
| `tournament_admin_events` | Public safe editor layout plus private admin context | Safe editor configuration columns are public; audit identities/timestamps remain private | No direct browser writes. Archive changes and edit authorization use narrow live-Discord-admin RPCs; canonical sheet IDs/ranges/layout remain service-controlled. |
| `private.admin_visibility_action_logs` | Visibility audit trail | No browser table access; intentional deny-all RLS | Written/read only through narrowly scoped audited functions. |
| `private.tournament_result_action_logs` | Tournament edit/undo audit trail | No browser table access; intentional deny-all RLS | Lifecycle mutations are service-only and require the Worker-supplied actor header derived from a separately validated live admin session. |

## Authentication and RPC rules

- Authentication is Discord-only. The website exposes only Discord sign-in,
  email signup is disabled in `supabase/config.toml`, and every protected
  policy/RPC rejects an authenticated session without a canonical Discord
  identity. During release verification, also confirm that the hosted Auth
  `external_email_enabled` setting remains disabled; the local
  `auth.email.enable_signup` setting specifically controls new signups and is
  not a substitute for checking the hosted provider toggle.
- Sensitive user/admin functions require a JWT `session_id` that still exists
  in `auth.sessions`, a canonical Discord identity in `auth.identities`, and,
  where applicable, Discord administrator role `1069007873985740890` attached
  to a current guild member and current role in the same fully completed scan
  generation.
- Trigger/helper functions have no anonymous or authenticated API execution
  grant and fixed search paths.
- Tournament action-log lifecycle functions and Lightning Cup match-state
  mutation are granted only to `service_role`. The Worker uses the
  `SUPABASE_SECRET_KEY` secret binding on the internal request and never sends
  it to the browser.
- The anonymous head-to-head RPC is intentionally `SECURITY DEFINER` because
  raw ranked matches are private. It validates numeric, distinct player IDs and
  returns only the six derived fields used by the compare page.

## Release and residual controls

- Before migration, preflight `brackets.year` and `bracket_picks.year` for null
  or non-2026 values. The 2026-08-18 read-only production preflight found none.
- Provision `SUPABASE_SECRET_KEY` first. Apply the migration, run the updated
  Discord member scan to record a completed generation, and deploy the Worker
  back-to-back, then deploy static pages; either server half alone is
  intentionally incompatible with the retired direct-write paths. The
  2026-08-18 read-only preflight found one current member row outside the
  otherwise consistent role/assignment generation; that actor remains
  fail-closed until this scan repairs the snapshot.
- Verify hosted Auth has `external_email_enabled=false` and audit/revoke any
  legacy email/password sessions. The local signup flag cannot perform this
  hosted operational check.
- Match-state authorization is enforced for a live Discord competitor/admin,
  but request throttling is an operational Worker control. Add a Cloudflare
  rate-limiting rule if traffic or abuse makes it necessary.
- The two private audit tables and the three public service-only tables
  `discord_global_rank_display_messages`, `event_signup_display_messages`, and
  `internal_ranked_matches` deliberately have no browser policy or table grant,
  providing two deny-by-default boundaries.
- Versioned migrations are the production schema source of truth. Legacy
  standalone schema files that once created broader browser policies abort when
  the hardening marker table exists, so rerunning an old bot setup script cannot
  silently restore retired grants.
