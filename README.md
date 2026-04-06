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

- Lightning Cup match popovers now load ranked head-to-head data from the same-origin endpoint `/api/teamup-head-to-head`.
- The server-side function lives at `functions/api/teamup-head-to-head.js` and reads the secret env var `NSSGOLF_TEAMUP_API_KEY`.
- Configure that secret only in your serverless host or local function runtime. Do not expose it via browser JavaScript or a public runtime config block.
