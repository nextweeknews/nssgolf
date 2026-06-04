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

This repo includes a small `discord.js` script for scanning all members in the NSS Golf Discord server.

### Discord setup

1. Open the bot application in the Discord Developer Portal.
2. Go to **Bot**.
3. Enable **Server Members Intent** under **Privileged Gateway Intents**.
4. Invite the bot to the server with the `bot` and `applications.commands` OAuth scopes.
5. Give the bot access to any private admin channel where scan reports should be posted.

The bot does not need the Message Content intent for this scan.

### Local setup

Create a local `.env` file using `.env.example` as the template:

```sh
DISCORD_BOT_TOKEN=your_real_bot_token
DISCORD_GUILD_ID=your_server_id
DISCORD_SCAN_REPORT_CHANNEL_ID=optional_private_channel_id
```

Then run:

```sh
npm install
npm run discord:scan-members
```

The scan writes member data to `bot/output/members.json`, which is ignored by git. If `DISCORD_SCAN_REPORT_CHANNEL_ID` is set, the bot also posts a summary message with the JSON export attached.

### Secrets

Use GitHub Secrets only if a GitHub Actions workflow will run the bot. For local development, use an untracked `.env` file. For production hosting, store `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and any channel IDs in the host's secret manager or environment variable settings.
