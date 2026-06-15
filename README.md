# NSS Golf

## Supabase Auth

- Primary sign-in method: Discord OAuth via Supabase Auth (`signInWithOAuth` with provider `discord`)
- Canonical callback route: `/auth/callback`
- Current visible login UI: `/lightningcup/index.html`
- For local callback testing, run the site on localhost and add a redirect URL like `http://localhost:8080/auth/callback` in Supabase Auth settings.
- Optional runtime override for static deployments:

```html
<script>
  window.NSSGOLF_SUPABASE_CONFIG = {
    url: "https://YOUR-PROJECT.supabase.co",
    publishableKey: "sb_publishable_REPLACE_ME"
  };
</script>
```

## Team Up H2H Proxy

- Lightning Cup match popovers now load ranked head-to-head data from the external Cloudflare Worker at `https://empty-poetry-4be0.nextweekmedia.workers.dev/`.
- This repo remains GitHub Pages compatible because the Team Up proxy is no longer hosted from repo-local functions.
- Store the Team Up secret only in the Cloudflare Worker secret named `NSSGOLF_TEAMUP_API_KEY`. Do not expose it via browser JavaScript or a public runtime config block.

## Discord Member Scan Bot

This repo includes a small `discord.js` script for scanning all members in the NSS Golf Discord server and storing them in Supabase.

### Data model

Discord roles are stored as a many-to-many relationship:

- `discord_guild_members`: one row per Discord user in the server
- `discord_roles`: one row per Discord role in the server
- `discord_member_roles`: one row per member-role assignment

This supports an indeterminate number of roles per player.

### Supabase setup

Run the SQL in `bot/discord-member-schema.sql` in the Supabase SQL editor before running the bot. The tables have RLS enabled and are intended for server-side bot access through the service-role key.

Do not expose the service-role key in browser JavaScript.

Use a Supabase secret key (`sb_secret_...`) or legacy `service_role` JWT key for `NSSGOLF_SUPABASE_SERVICE_ROLE_KEY`. Do not use the publishable key or legacy anon key; those run as low-privilege roles and will fail RLS when the bot writes scan rows.

### Discord setup

1. Open the bot application in the Discord Developer Portal.
2. Go to **Bot**.
3. Enable **Server Members Intent** under **Privileged Gateway Intents**.
4. Invite the bot to the server with the `bot` and `applications.commands` OAuth scopes.

Do not grant the bot `Administrator` or `Manage Roles`. The scheduled scanner refuses to run with either permission because it only needs to read members and roles, not create or assign roles.

The bot does not need the Message Content intent for this scan.

## Discord Global Rank Bot

The global rank bot adds admin slash commands and player chat commands for the unofficial global rank fields stored in `public.player_settings`.

### Commands

Admin slash commands:

- `/display_global_ranks`
- `/display_global_max_nocs`
- `/display_global_max_cs`
- `/set_rank_nocs player rank`
- `/set_rank_cs player rank`
- `/set_max_nocs player rank`
- `/set_max_cs player rank`

Player message commands:

- `!ranknocs [rank]`
- `!rankcs [rank]`
- `!maxnocs`
- `!maxcs`

Rank text accepts the stored infinity symbol, like `∞3`, and easier Discord input like `inf3`. Use `remove` with any rank-setting command to clear that field. `!maxnocs` and `!maxcs` use the player's current rank when no rank argument is supplied; they also accept an explicit rank as a convenience.

`!ranknocs`, `!rankcs`, `/set_rank_nocs`, and `/set_rank_cs` update the player's current rank and bump the corresponding max rank when the new current rank is higher. Current rank updates are rejected if the resulting current rank would be above both max rank values.

### Supabase setup

Run these SQL files in the Supabase SQL editor:

```sh
bot/discord-member-schema.sql
bot/player-settings-schema.sql
bot/global-rank-displays-schema.sql
bot/championship-settings-schema.sql
```

The display-message table stores Discord webhook tokens and is intentionally service-role only. Do not grant browser clients access to it.

The bot can create a missing `player_settings` row for a Discord-only player. If that player later logs into nssgolf.com with Discord, the settings page updates the same row by `discord_user_id` and attaches the Supabase `user_id`.

Run `bot/enable-global-rank-moderation-realtime.sql` if the bot should live-refresh Discord leaderboard displays when a website admin hides or restores a rank.

### Discord setup

For the rank bot, the Discord application needs:

- OAuth scopes: `bot` and `applications.commands`
- Bot/channel permissions: `View Channel`, `Send Messages`, `Read Message History`, `Use Application Commands`, `Embed Links`, and `Manage Webhooks`
- Privileged Gateway Intents: **Server Members Intent** and **Message Content Intent**

Slash commands are registered as Administrator-only by default. At runtime, the bot also accepts the role in `DISCORD_ADMIN_ROLE_ID` as an admin role. If that role does not have Discord's Administrator permission, enable access to the slash commands for that role in the server's **Integrations** settings.

### Running

Set the same Discord and Supabase secrets used by the member scan:

```sh
DISCORD_BOT_TOKEN=your_real_bot_token
DISCORD_GUILD_ID=your_server_id
DISCORD_ADMIN_ROLE_ID=your_admin_role_id
NSSGOLF_GLOBAL_RANKS_AVATAR_URL=https://www.nssgolf.com/logos/golf.png
NSSGOLF_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NSSGOLF_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Then start the long-running bot:

```sh
npm run discord:global-ranks
```

### Local setup

If you want to run the scanner locally, create a local `.env` file using `.env.example` as the template:

```sh
DISCORD_BOT_TOKEN=your_real_bot_token
DISCORD_GUILD_ID=your_server_id
NSSGOLF_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NSSGOLF_SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Then run:

```sh
npm install
npm run discord:scan-members
```

The scan stores member data in Supabase and also writes a local audit export to `bot/output/members.json`, which is ignored by git.

If the values are stored only as GitHub Secrets, run the existing **Discord member scan** workflow from GitHub Actions instead. The workflow is also scheduled nightly and injects `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `NSSGOLF_SUPABASE_URL`, and `NSSGOLF_SUPABASE_SERVICE_ROLE_KEY` from repository/environment secrets.

### Shotgun Pro League player aliases

The Shotgun Pro League Google Sheet uses stable player aliases that do not always match current Discord display names. Use a Supabase alias table to map those sheet names to Discord user IDs without rewriting historical sheet data.

1. Run `bot/proleague-player-alias-schema.sql` in the Supabase SQL editor after `bot/discord-member-schema.sql`.
2. Refresh Discord member data. Locally, run `npm run discord:scan-members` with a local `.env`; if your credentials only live in GitHub Secrets, run the **Discord member scan** workflow in GitHub Actions.
3. Generate a review CSV:

```sh
npm run proleague:aliases:suggest
```

This writes `bot/output/proleague-alias-review.csv`. High-confidence matches are prefilled with `approval=approve`; ambiguous rows are left blank and include alternatives in `candidates_json`.

4. Review the CSV. For every accepted row, set `approval` to `approve`. If the suggested user is wrong, put the correct Discord user ID in `approved_discord_user_id`.
5. If you do not have a local Supabase service-role key, export approved rows to SQL and run the generated file in the Supabase SQL editor:

```sh
npm run proleague:aliases:export-sql
```

This writes `bot/output/proleague-alias-import.sql`. Approved rows are upserted as active mappings; rows with blank approval are deactivated so older all-approved imports stop linking those aliases to player pages.

6. Or, if you do have a local Supabase service-role key, import approved rows directly:

```sh
npm run proleague:aliases:import
```

Both import paths upsert approved mappings into `public.player_league_aliases`.

### Secrets

Use GitHub Secrets only if a GitHub Actions workflow will run the bot. For local development, use an untracked `.env` file. For production hosting, store `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and `NSSGOLF_SUPABASE_SERVICE_ROLE_KEY` in the host's secret manager or environment variable settings.
