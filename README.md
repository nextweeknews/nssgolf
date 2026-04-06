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
