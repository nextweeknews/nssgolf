import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const projectId = "nssgolf";
const networkId = "nssgolf-local";
const appHost = "127.0.0.1";
const appPort = 8080;
const localPassword = "LocalNssgolf2026!";
const productionSupabaseHost = "kwaprkwemtxizorpnrzq.supabase.co";
const users = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    identityId: "20000000-0000-4000-8000-000000000001",
    discordId: "990000000000000001",
    email: "admin@nssgolf.test",
    name: "Avery Admin",
    role: "admin",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    identityId: "20000000-0000-4000-8000-000000000002",
    discordId: "990000000000000002",
    email: "player@nssgolf.test",
    name: "Parker Player",
    role: "player",
  },
];

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);
const privateSegments = new Set([
  ".agents",
  ".codex",
  ".git",
  ".github",
  "bot",
  "functions",
  "node_modules",
  "scripts",
  "supabase",
  "worker",
]);
const privateFiles = new Set([
  "agents.md",
  "dockerfile",
  "fly.toml",
  "package-lock.json",
  "package.json",
  "readme.md",
]);

function redact(message) {
  return String(message ?? "")
    .replace(/((?:ANON|SERVICE_ROLE|SECRET|PUBLISHABLE|JWT)_KEY)=\S+/g, "$1=<redacted>")
    .trim();
}

function run(command, args, { capture = false, input } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    input,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = redact(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout ?? "";
}

function runSupabase(args, options = {}) {
  return run("supabase", [...args, "--network-id", networkId], options);
}

function ensureLocalNetwork() {
  const inspection = spawnSync("docker", ["network", "inspect", networkId], { cwd: root, stdio: "ignore" });
  if (inspection.status === 0) return;
  run("docker", ["network", "create", "-o", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1", networkId], { capture: true });
}

function startStack() {
  ensureLocalNetwork();
  runSupabase(["start"], { capture: true });
  console.log("Local NSS Golf Supabase stack is running on the isolated 5452x ports.");
}

function parseStatus() {
  const values = {};
  for (const line of runSupabase(["status", "-o", "env"], { capture: true }).split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator);
    const raw = line.slice(separator + 1).trim();
    values[name] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
  values.PUBLISHABLE_KEY ||= values.ANON_KEY;
  values.SECRET_KEY ||= values.SERVICE_ROLE_KEY;
  for (const name of ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"]) {
    if (!values[name]) throw new Error(`Local Supabase status did not provide ${name}.`);
  }
  return values;
}

async function requestJson(url, { key, token = key, body, method = "POST" } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (!response.ok) {
    throw new Error(data?.message ?? data?.msg ?? data?.error_description ?? data?.error ?? `HTTP ${response.status}`);
  }
  return data;
}

async function waitForAuth(apiUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${apiUrl}/auth/v1/settings`)).ok) return;
    } catch {
      // Auth can briefly reconnect while the database reset finishes.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Local Supabase Auth did not become ready.");
}

function runSql(sql) {
  run(
    "docker",
    ["exec", "-i", `supabase_db_${projectId}`, "psql", "--username", "postgres", "--dbname", "postgres", "--set", "ON_ERROR_STOP=on"],
    { capture: true, input: sql },
  );
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function bootstrapIdentities(status) {
  for (const user of users) {
    const created = await requestJson(`${status.API_URL}/auth/v1/admin/users`, {
      key: status.SECRET_KEY,
      body: {
        id: user.id,
        email: user.email,
        password: localPassword,
        email_confirm: true,
        user_metadata: { full_name: user.name },
      },
    });
    if ((created?.id ?? created?.user?.id) !== user.id) throw new Error(`Auth returned an unexpected ID for ${user.email}.`);
  }

  const identityValues = users.map((user) => `(
    ${sqlLiteral(user.identityId)}::uuid,
    ${sqlLiteral(user.discordId)},
    ${sqlLiteral(user.id)}::uuid,
    jsonb_build_object('sub', ${sqlLiteral(user.discordId)}, 'name', ${sqlLiteral(user.name)}),
    'discord',
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp()
  )`).join(",\n");
  const profileValues = users.map((user) => `(
    ${sqlLiteral(user.id)}::uuid,
    ${sqlLiteral(user.discordId)},
    ${sqlLiteral(user.role === "admin" ? "US" : "CA")},
    'America/Chicago',
    ${sqlLiteral(user.role === "admin" ? "S4" : "A25")}
  )`).join(",\n");
  const profileUpdates = users.map((user) => `
    UPDATE public.profiles
    SET username = ${sqlLiteral(`local-${user.role}`)},
        discord_user_id = ${sqlLiteral(user.discordId)},
        full_name = ${sqlLiteral(user.name)}
    WHERE user_id = ${sqlLiteral(user.id)}::uuid;`).join("\n");

  runSql(`
    INSERT INTO auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES ${identityValues};
    ${profileUpdates}
    INSERT INTO public.player_settings (
      user_id, discord_user_id, country_1, time_zone, current_global_rank
    ) VALUES ${profileValues};
  `);
  console.log("Bootstrapped synthetic admin and player identities with canonical Discord links.");
}

function verify() {
  runSql(`
    DO $$
    BEGIN
      IF (SELECT count(*) FROM auth.users WHERE email LIKE '%@nssgolf.test') <> 2 THEN
        RAISE EXCEPTION 'expected two local Auth users';
      END IF;
      IF (SELECT count(*) FROM auth.identities WHERE provider = 'discord' AND provider_id LIKE '99000000000000000%') <> 2 THEN
        RAISE EXCEPTION 'expected two canonical local Discord identities';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.discord_member_roles AS assignment
        JOIN public.discord_guild_sync_state AS sync
          ON sync.guild_id = assignment.guild_id
         AND sync.completed_at = assignment.scanned_at
        WHERE assignment.discord_user_id = '990000000000000001'
          AND assignment.role_id = '1069007873985740890'
      ) THEN
        RAISE EXCEPTION 'local admin role generation is incomplete';
      END IF;
      IF (SELECT count(*) FROM public.internal_ranked_gpi_ratings WHERE run_id = 9001) <> 3 THEN
        RAISE EXCEPTION 'local GPI fixture is incomplete';
      END IF;
    END;
    $$;
  `);
  console.log("Verified local users, Discord authorization fixtures, and GPI data.");
}

async function reset() {
  startStack();
  const status = parseStatus();
  runSupabase(["db", "reset", "--local"]);
  await waitForAuth(status.API_URL);
  await bootstrapIdentities(status);
  verify();
  console.log(`Local data is ready. Run \`npm run dev\`, then open http://${appHost}:${appPort}/__local/login.`);
}

function check() {
  startStack();
  verify();
  runSupabase(["test", "db", "--local", "supabase/tests"]);
  runSupabase(["db", "lint", "--local", "--fail-on", "error"]);
  runSupabase(["db", "advisors", "--local", "--fail-on", "error"]);
  console.log("Local database tests, lint, and advisors passed.");
}

function canonicalPathname(pathname) {
  const decoded = decodeURIComponent(pathname).replaceAll("\\", "/");
  const segments = [];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function safeAssetPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => privateSegments.has(segment.toLowerCase()) || segment.startsWith("."))) return null;
  if (segments.length === 1 && privateFiles.has(segments[0].toLowerCase())) return null;
  let path = resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  if (!existsSync(path) && !extname(path)) path = `${path}.html`;
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path) || !statSync(path).isFile() || !mimeTypes.has(extname(path).toLowerCase())) return null;
  return path;
}

function browserConfig(status) {
  return `window.NSSGOLF_SUPABASE_CONFIG=${JSON.stringify({ url: status.API_URL, publishableKey: status.PUBLISHABLE_KEY })};`;
}

function injectLocalConfig(html, status) {
  const script = `<script>${browserConfig(status)}</script>`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${script}`)
    : `${script}\n${html}`;
}

function localLoginPage(status) {
  const accountButtons = users.map((user) => `<button data-email="${user.email}" data-target="${user.role === "admin" ? "/admin/" : "/player-settings.html"}">${user.name} <small>${user.role}</small></button>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NSS Golf local login</title><script>${browserConfig(status)}</script>
<style>body{font:16px system-ui;max-width:34rem;margin:10vh auto;padding:1.5rem;color:#172033}main{display:grid;gap:1rem}button{font:inherit;text-align:left;padding:1rem;border:1px solid #ccd3df;border-radius:.75rem;background:#fff;cursor:pointer}button:hover{background:#f4f7fb}small{display:block;color:#667085;margin-top:.25rem}#status{min-height:1.5rem}</style></head>
<body><main><h1>Local NSS Golf accounts</h1><p>These synthetic users and their Discord identities exist only in the local Supabase stack.</p>${accountButtons}<button id="signout">Sign out</button><p id="status" role="status"></p></main>
<script type="module">import { createBrowserSupabaseClient } from "/auth/supabase-auth.js";
const client=createBrowserSupabaseClient();const status=document.querySelector("#status");
document.querySelectorAll("[data-email]").forEach((button)=>button.addEventListener("click",async()=>{status.textContent="Signing in...";const {error}=await client.auth.signInWithPassword({email:button.dataset.email,password:${JSON.stringify(localPassword)}});if(error){status.textContent=error.message;return;}location.assign(button.dataset.target);}));
document.querySelector("#signout").addEventListener("click",async()=>{await client.auth.signOut();status.textContent="Signed out.";});</script></body></html>`;
}

function createAppServer(status) {
  return createServer((request, response) => {
    if (!request.url || !["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let pathname;
    try {
      pathname = canonicalPathname(new URL(`http://${appHost}:${appPort}${request.url}`).pathname);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found\n");
      return;
    }
    if (pathname.toLowerCase() === "/__local/login") {
      const body = localLoginPage(status);
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    if (pathname.toLowerCase().startsWith("/__local/")) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found\n");
      return;
    }
    const path = safeAssetPath(pathname);
    if (!path) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found\n");
      return;
    }
    const extension = extname(path).toLowerCase();
    const source = readFileSync(path);
    const body = extension === ".html" ? injectLocalConfig(source.toString("utf8"), status) : source;
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": mimeTypes.get(extension) });
    response.end(request.method === "HEAD" ? undefined : body);
  });
}

function startApp() {
  startStack();
  const server = createAppServer(parseStatus());
  server.listen(appPort, appHost, () => {
    console.log(`Local preview: http://${appHost}:${appPort}`);
    console.log(`Local accounts: http://${appHost}:${appPort}/__local/login`);
  });
}

async function signIn(status, email) {
  return requestJson(`${status.API_URL}/auth/v1/token?grant_type=password`, {
    key: status.PUBLISHABLE_KEY,
    body: { email, password: localPassword },
  });
}

async function smoke() {
  startStack();
  const status = parseStatus();
  const server = createAppServer(status);
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, appHost, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local smoke server did not start.");
  const previewUrl = `http://${appHost}:${address.port}`;
  try {
    const homepage = await (await fetch(`${previewUrl}/`)).text();
    if (!homepage.includes(status.API_URL) || homepage.includes(productionSupabaseHost)) {
      throw new Error("Local preview did not inject the isolated Supabase configuration.");
    }
    for (const path of ["/AGENTS.md", "/package.json", "/supabase/config.toml", "/scripts/local-development.mjs", "/%2e%2e/supabase/config.toml"]) {
      if ((await fetch(`${previewUrl}${path}`)).status !== 404) throw new Error(`${path} exposed a protected repository file.`);
    }
    const publicRows = await requestJson(`${status.API_URL}/rest/v1/internal_ranked_gpi_ratings?run_id=eq.9001&select=discord_user_id`, {
      key: status.PUBLISHABLE_KEY,
      method: "GET",
    });
    if (!Array.isArray(publicRows) || publicRows.length !== 3) throw new Error("Public local GPI fixture was unavailable.");

    const [adminSession, playerSession] = await Promise.all(users.map((user) => signIn(status, user.email)));
    const actor = async (session) => requestJson(`${status.API_URL}/rest/v1/rpc/get_my_discord_actor`, {
      key: status.PUBLISHABLE_KEY,
      token: session.access_token,
      body: {},
    });
    const [adminActor, playerActor] = await Promise.all([actor(adminSession), actor(playerSession)]);
    if (adminActor?.[0]?.is_admin !== true || playerActor?.[0]?.is_admin !== false) {
      throw new Error("Synthetic admin/player authorization boundaries were incorrect.");
    }
    const denied = await fetch(`${status.API_URL}/rest/v1/rpc/get_tournament_admin_edit_context`, {
      method: "POST",
      headers: {
        apikey: status.PUBLISHABLE_KEY,
        Authorization: `Bearer ${playerSession.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (denied.ok) throw new Error("Synthetic non-admin could access the tournament admin context.");
    const adminContext = await requestJson(`${status.API_URL}/rest/v1/rpc/get_tournament_admin_edit_context`, {
      key: status.PUBLISHABLE_KEY,
      token: adminSession.access_token,
      body: {},
    });
    if (!Array.isArray(adminContext) || adminContext.length < 1) throw new Error("Synthetic admin could not access the tournament admin context.");
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
  console.log("Verified local-only configuration, protected files, public fixtures, login, and admin isolation.");
}

async function main() {
  const command = process.argv[2];
  if (command === "app") return startApp();
  if (command === "check") return check();
  if (command === "reset") return reset();
  if (command === "smoke") return smoke();
  if (command === "start") return startStack();
  if (command === "verify") {
    startStack();
    return verify();
  }
  if (command === "stop") {
    runSupabase(["stop", "--project-id", projectId]);
    return console.log("Local NSS Golf stack stopped; its data volume was preserved.");
  }
  throw new Error("Usage: node scripts/local-development.mjs <app|check|reset|smoke|start|stop|verify>");
}

try {
  await main();
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
}
