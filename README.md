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
