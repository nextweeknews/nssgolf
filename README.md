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

### Discord setup

1. Open the bot application in the Discord Developer Portal.
2. Go to **Bot**.
3. Enable **Server Members Intent** under **Privileged Gateway Intents**.
4. Invite the bot to the server with the `bot` and `applications.commands` OAuth scopes.

Do not grant the bot `Administrator` or `Manage Roles`. The scheduled scanner refuses to run with either permission because it only needs to read members and roles, not create or assign roles.

The bot does not need the Message Content intent for this scan.

### Local setup

Create a local `.env` file using `.env.example` as the template:

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

### Secrets

Use GitHub Secrets only if a GitHub Actions workflow will run the bot. For local development, use an untracked `.env` file. For production hosting, store `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and `NSSGOLF_SUPABASE_SERVICE_ROLE_KEY` in the host's secret manager or environment variable settings.
