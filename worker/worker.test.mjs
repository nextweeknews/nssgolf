import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import worker, { expandTournamentIterations, selectedTournamentEditorConfig, validateAdminUpdates } from "./src/worker.mjs";

const originalFetch = globalThis.fetch;
const TEST_ADMIN_ACTOR = {
  actor_user_id: "11111111-1111-4111-8111-111111111111",
  actor_discord_user_id: "900000000000000001",
  actor_username: "Admin",
  is_admin: true,
};

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeEnv({ cachedChannelId = null, bindings = {} } = {}) {
  const writes = [];
  return {
    env: {
      GOOGLE_API_KEY: "test-google-key",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SECRET_KEY: "test-secret-key",
      YOUTUBE_API_KEY: "test-youtube-key",
      UC_IDs: {
        get: async () => cachedChannelId,
        put: async (...args) => writes.push(args),
      },
      ...bindings,
    },
    writes,
  };
}

let testPrivateKeyPemPromise;

function makeTestPrivateKeyPem() {
  if (!testPrivateKeyPemPromise) {
    testPrivateKeyPemPromise = webcrypto.subtle
      .generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      )
      .then(async ({ privateKey }) => {
        const pkcs8 = await webcrypto.subtle.exportKey("pkcs8", privateKey);
        const base64 = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g).join("\n");
        return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
      });
  }
  return testPrivateKeyPemPromise;
}

test("returns the deployed CORS headers for allowed production preflights", async () => {
  for(const origin of ["https://nssgolf.com", "https://www.nssgolf.com"]){
    const response = await worker.fetch(
      new Request("https://worker.example/", {
        method: "OPTIONS",
        headers: { Origin: origin },
      }),
      makeEnv().env,
    );

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
    assert.equal(response.headers.get("Vary"), "Origin");
  }
});

test("rejects a browser origin outside the deployed allowlist", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/?sheetId=test&range=A1", {
      headers: { Origin: "https://example.com" },
    }),
    makeEnv().env,
  );

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Forbidden");
});

test("resolves a cached YouTube channel without an upstream request", async () => {
  const channelId = "UC1234567890123456789012";
  const { env } = makeEnv({ cachedChannelId: channelId });
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    throw new Error("Unexpected upstream request");
  };

  const response = await worker.fetch(
    new Request("https://worker.example/yt/resolve?input=%40nssgolf"),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { channelId, source: "kv" });
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(upstreamCalled, false);
});

test("stores a direct YouTube channel ID in KV", async () => {
  const channelId = "UC1234567890123456789012";
  const { env, writes } = makeEnv();

  const response = await worker.fetch(
    new Request(`https://worker.example/yt/resolve?input=${channelId}`),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { channelId, source: "direct" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], channelId);
  assert.deepEqual(writes[0][2], { expirationTtl: 60 * 60 * 24 * 14 });
});

test("forwards a Sheets GET with the deployed cache behavior", async () => {
  const { env } = makeEnv();
  let upstreamUrl = "";
  globalThis.fetch = async (input, init = {}) => {
    upstreamUrl = String(input);
    return new Response(JSON.stringify({ range: "Bracket!A1:P16", values: [["Round 1"]] }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await worker.fetch(
    new Request("https://worker.example/?sheetId=masters-sheet&range=Bracket!A1%3AP16"),
    env,
  );

  assert.equal(response.status, 200);
  assert.match(upstreamUrl, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/masters-sheet\/values\/Bracket!A1%3AP16\?key=/);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
  assert.deepEqual(await response.json(), { range: "Bracket!A1:P16", values: [["Round 1"]] });
});

test("keeps the existing JSON POST compatibility for Sheets reads", async () => {
  const { env } = makeEnv();
  let upstreamUrl = "";
  globalThis.fetch = async (input) => {
    upstreamUrl = String(input);
    return new Response(JSON.stringify({ values: [[1, 2, 3]] }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await worker.fetch(
    new Request("https://worker.example/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://nssgolf.com",
      },
      body: JSON.stringify({ sheetId: "championship-sheet", range: "Scores!B2:D2" }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.match(upstreamUrl, /\/championship-sheet\/values\/Scores!B2%3AD2\?key=/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://nssgolf.com");
  assert.deepEqual(await response.json(), { values: [[1, 2, 3]] });
});

test("requires a Supabase user token for tournament result writes", async () => {
  const { env } = makeEnv();
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    throw new Error("Unexpected upstream request");
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ eventKey:"masters", updates:[] }),
    }),
    env,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
  assert.equal(upstreamCalled, false);
});

test("writes Lightning Cup match state only through the verified Worker path", async () => {
  const { env } = makeEnv();
  const savedAt = "2026-08-17T12:00:00.000Z";
  const matchState = { version:1, sets:[{}, {}, {}], history:[], undoStack:[] };

  globalThis.fetch = async (input, init = {}) => {
    const upstreamUrl = new URL(String(input));
    if (upstreamUrl.pathname.endsWith("/get_my_discord_actor")) {
      assert.equal(init.headers.Authorization, "Bearer user-token");
      return Response.json([TEST_ADMIN_ACTOR]);
    }
    if (upstreamUrl.hostname === "sheets.googleapis.com") {
      const range = decodeURIComponent(upstreamUrl.pathname.split("/values/").at(-1));
      if (range === "Bracket!A:T") {
        return Response.json({ values: [
          ["Match ID"],
          ["1", "R64", "1", "1", "Player One", "", "2", "Administrator"],
        ] });
      }
      if (range === "Seeds!C:E") {
        return Response.json({ values: [
          ["Player One", "", "930000000000000001"],
          ["Administrator", "", "930000000000000003"],
        ] });
      }
    }
    if (upstreamUrl.pathname.endsWith("/upsert_lightning_cup_match_state")) {
      assert.equal(init.headers.apikey, "test-secret-key");
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.headers["X-NSSGolf-Actor-User-Id"], TEST_ADMIN_ACTOR.actor_user_id);
      assert.deepEqual(JSON.parse(init.body), {
        p_actor_user_id: TEST_ADMIN_ACTOR.actor_user_id,
        p_match_id: 1,
        p_state: matchState,
        p_competitor_discord_user_ids: ["930000000000000001", "930000000000000003"],
      });
      return Response.json([{ match_id:1, state:matchState, updated_at:savedAt }]);
    }
    throw new Error(`Unexpected upstream request: ${upstreamUrl}`);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/lightningcup/match-state", {
      method:"POST",
      headers:{ Authorization:"Bearer user-token", "Content-Type":"application/json" },
      body:JSON.stringify({ matchId:1, state:matchState }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { match_id:1, state:matchState, updated_at:savedAt });
});

test("rejects ambiguous Lightning Cup competitor names before the secret RPC", async () => {
  const { env } = makeEnv();
  const matchState = { version:1, sets:[{}, {}, {}], history:[], undoStack:[] };
  let secretRpcCalled = false;

  globalThis.fetch = async (input) => {
    const upstreamUrl = new URL(String(input));
    if (upstreamUrl.pathname.endsWith("/get_my_discord_actor")) {
      return Response.json([TEST_ADMIN_ACTOR]);
    }
    if (upstreamUrl.hostname === "sheets.googleapis.com") {
      const range = decodeURIComponent(upstreamUrl.pathname.split("/values/").at(-1));
      if (range === "Bracket!A:T") {
        return Response.json({ values: [
          ["Match ID"],
          ["1", "R64", "1", "1", "Same Name", "", "2", "Administrator"],
        ] });
      }
      if (range === "Seeds!C:E") {
        return Response.json({ values: [
          ["Same Name", "", "930000000000000001"],
          ["same name", "", "930000000000000002"],
          ["Administrator", "", "930000000000000003"],
        ] });
      }
    }
    if (upstreamUrl.pathname.endsWith("/upsert_lightning_cup_match_state")) {
      secretRpcCalled = true;
    }
    throw new Error(`Unexpected upstream request: ${upstreamUrl}`);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/lightningcup/match-state", {
      method:"POST",
      headers:{ Authorization:"Bearer user-token", "Content-Type":"application/json" },
      body:JSON.stringify({ matchId:1, state:matchState }),
    }),
    env,
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error:"The Lightning Cup sheet has an ambiguous competitor name.",
  });
  assert.equal(secretRpcCalled, false);
});

test("discovers year-named editor tabs and selects the latest iteration", () => {
  const context = {
    source_ranges:["'World Cup 2025'!A1:X120"],
    editable_ranges:["'World Cup 2025'!V2:V120"],
    formula_ranges:[],
    editor_tables:[{
      kind:"iteration-template",
      sheet_pattern:"^World Cup (20\\d{2})$",
      iteration_group:1,
      source_ranges:["'{sheet}'!A1:X120"],
      editable_ranges:["'{sheet}'!V2:V120"],
      formula_ranges:["'{sheet}'!U2:U120"],
      tables:[{
        key:"bracket",
        group_key:"worldcup-{iteration}",
        group_label:"{iteration}",
        season_value:"{iteration}",
        season_label:"{iteration}",
        source_range:"'{sheet}'!A1:X120",
      }],
    }],
  };

  const expanded = expandTournamentIterations(context, ["World Cup 2025", "Notes", "World Cup 2026"]);
  const selected = selectedTournamentEditorConfig(expanded, "latest");

  assert.equal(selected.activeViewKey, "worldcup-2026");
  assert.deepEqual(selected.sourceRanges, ["'World Cup 2026'!A1:X120"]);
  assert.ok(expanded.editable_ranges.includes("'World Cup 2026'!V2:V120"));
  assert.ok(expanded.formula_ranges.includes("'World Cup 2026'!U2:U120"));
  assert.deepEqual(
    validateAdminUpdates([{ range:"'World Cup 2026'!V2", values:[[2]] }], expanded.editable_ranges)[0].values,
    [[2]],
  );
  assert.throws(
    () => validateAdminUpdates([{ range:"'World Cup 2027'!V2", values:[[2]] }], expanded.editable_ranges),
    /outside this event's editable cells/,
  );
});

test("discovers convention-named Pro League stages from season 8 onward", () => {
  const context = {
    source_ranges: ["'Season 7, Stage 1'!A3:S101"],
    editable_ranges: ["'Season 7, Stage 1'!L5:S8"],
    formula_ranges: ["'Season 7, Stage 1'!A4:K101"],
    editor_tables: [{
      key: "season-7-stage-1-scores",
      group_key: "season-7-stage-1",
      group_label: "Season 7, Stage 1",
      season_value: 7,
      season_label: "Season 7",
      stage_value: 1,
      source_range: "'Season 7, Stage 1'!A3:S101",
    }, {
      kind: "iteration-template",
      sheet_pattern: "^Season ([0-9]+), Stage 1$",
      iteration_group: 1,
      min_iteration: 8,
      source_ranges: ["'{sheet}'!A3:S101"],
      editable_ranges: ["'{sheet}'!L5:S8", "'{sheet}'!C66:C101", "'{sheet}'!L66:S101"],
      formula_ranges: ["'{sheet}'!A4:B101", "'{sheet}'!C4:C65", "'{sheet}'!D4:K101"],
      tables: [{
        key: "season-{iteration}-stage-1-scores",
        group_key: "season-{iteration}-stage-1",
        group_label: "Season {iteration}, Stage 1",
        season_value: "{iteration}",
        season_label: "Season {iteration}",
        stage_value: 1,
        source_range: "'{sheet}'!A3:S101",
      }],
    }],
  };

  const expanded = expandTournamentIterations(context, [
    "Season 7, Stage 1",
    "Season 8, Stage 1",
    "Season 8, Stage 2",
  ]);
  const selected = selectedTournamentEditorConfig(expanded, "season-8-stage-1");

  assert.equal(selected.activeViewKey, "season-8-stage-1");
  assert.deepEqual(selected.sourceRanges, ["'Season 8, Stage 1'!A3:S101"]);
  assert.ok(expanded.editable_ranges.includes("'Season 8, Stage 1'!C66:C101"));
  assert.ok(expanded.formula_ranges.includes("'Season 8, Stage 1'!D4:K101"));
  assert.equal(expanded.editor_tables.filter((table) => table.group_key === "season-7-stage-1").length, 1);
});

test("loads a newly discovered tournament year through Google metadata", async () => {
  const privateKey = await makeTestPrivateKeyPem();
  const { env } = makeEnv({ bindings: {
    GOOGLE_SERVICE_ACCOUNT_EMAIL:"iteration-reader@example.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:privateKey,
  } });
  globalThis.fetch = async (input) => {
    const upstreamUrl = new URL(String(input));
    if(upstreamUrl.hostname === "project.supabase.co"){
      return Response.json([{
        event_key:"worldcup",
        display_name:"World Cup",
        route_path:"/worldcup",
        sheet_id:"worldcup-sheet",
        source_ranges:["'World Cup 2025'!A1:X120"],
        editable_ranges:["'World Cup 2025'!V2:V120"],
        formula_ranges:[],
        editor_tables:[{
          kind:"iteration-template",
          sheet_pattern:"^World Cup (20\\d{2})$",
          iteration_group:1,
          source_ranges:["'{sheet}'!A1:X120"],
          editable_ranges:["'{sheet}'!V2:V120"],
          formula_ranges:[],
          tables:[{
            key:"bracket", group_key:"worldcup-{iteration}", group_label:"{iteration}",
            season_value:"{iteration}", season_label:"{iteration}", source_range:"'{sheet}'!A1:X120",
          }],
        }],
        edit_enabled:true,
        archived:false,
        can_edit:true,
        archived_at:null,
      }]);
    }
    if(upstreamUrl.href === "https://oauth2.googleapis.com/token"){
      return Response.json({ access_token:"iteration-read-token", expires_in:3600 });
    }
    if(upstreamUrl.pathname === "/v4/spreadsheets/worldcup-sheet"){
      assert.equal(upstreamUrl.searchParams.get("fields"), "sheets.properties.title");
      return Response.json({ sheets:[
        { properties:{ title:"World Cup 2025" } },
        { properties:{ title:"World Cup 2026" } },
      ] });
    }
    assert.equal(upstreamUrl.pathname, "/v4/spreadsheets/worldcup-sheet/values:batchGet");
    assert.deepEqual(upstreamUrl.searchParams.getAll("ranges"), ["'World Cup 2026'!A1:X120"]);
    return Response.json({ valueRanges:[{ range:"'World Cup 2026'!A1:X120", values:[] }] });
  };

  const response = await worker.fetch(new Request(
    "https://worker.example/admin/tournament-results?eventKey=worldcup&viewKey=latest",
  ), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.event.activeViewKey, "worldcup-2026");
  assert.ok(payload.event.editableRanges.includes("'World Cup 2026'!V2:V120"));
});

test("loads combined admin action logs through the authenticated admin RPC", async () => {
  const { env } = makeEnv();
  const actionId = "55555555-5555-4555-8555-555555555555";
  globalThis.fetch = async (input, init = {}) => {
    const upstreamUrl = new URL(String(input));
    assert.equal(upstreamUrl.pathname, "/rest/v1/rpc/list_admin_action_logs");
    assert.equal(init.headers.Authorization, "Bearer user-token");
    assert.deepEqual(JSON.parse(init.body), { p_limit: 25 });
    return Response.json([{
      action_id: actionId,
      action_type: "edit",
      status: "succeeded",
      event_key: "masters",
      actor_username: "Admin",
      changes: [{ range: "'Bracket'!C2", before: [[1]], after: [[2]] }],
      can_undo: true,
    }]);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-action-logs?limit=25", {
      headers: { Authorization: "Bearer user-token" },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { logs: [{
    action_id: actionId,
    action_type: "edit",
    status: "succeeded",
    event_key: "masters",
    actor_username: "Admin",
    changes: [{ range: "'Bracket'!C2", before: [[1]], after: [[2]] }],
    can_undo: true,
  }] });
});

test("undoes an audited visibility action without contacting Google", async () => {
  const { env } = makeEnv();
  const actionId = "77777777-7777-4777-8777-777777777777";
  const undoActionId = "88888888-8888-4888-8888-888888888888";
  let upstreamCalls = 0;

  globalThis.fetch = async (input, init = {}) => {
    upstreamCalls += 1;
    const upstreamUrl = new URL(String(input));
    assert.equal(upstreamUrl.pathname, "/rest/v1/rpc/undo_admin_visibility_action");
    assert.deepEqual(JSON.parse(init.body), { p_action_id:actionId });
    return Response.json([{ action_id:undoActionId, hidden:false }]);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-action-logs", {
      method:"POST",
      headers:{ Authorization:"Bearer user-token", "Content-Type":"application/json" },
      body:JSON.stringify({ actionId, actionType:"visibility" }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamCalls, 1);
  assert.deepEqual(await response.json(), {
    actionId:undoActionId,
    undoneActionId:actionId,
    hidden:false,
  });
});

test("undoes an audited season configuration action without contacting Google", async () => {
  const { env } = makeEnv();
  const actionId = "99999999-9999-4999-8999-999999999999";
  const undoActionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let upstreamCalls = 0;

  globalThis.fetch = async (input, init = {}) => {
    upstreamCalls += 1;
    const upstreamUrl = new URL(String(input));
    assert.equal(upstreamUrl.pathname, "/rest/v1/rpc/undo_season_configuration_action");
    assert.equal(init.headers.Authorization, "Bearer user-token");
    assert.deepEqual(JSON.parse(init.body), { p_action_id:actionId });
    return Response.json([{
      action_id:undoActionId,
      ranked_league_season:13,
      shotgun_pro_league_season:7,
      shotgun_pro_league_stage:3,
      super_league_season:6,
    }]);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-action-logs", {
      method:"POST",
      headers:{ Authorization:"Bearer user-token", "Content-Type":"application/json" },
      body:JSON.stringify({ actionId, actionType:"configuration" }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamCalls, 1);
  assert.deepEqual(await response.json(), {
    actionId:undoActionId,
    undoneActionId:actionId,
    configuration:{
      action_id:undoActionId,
      ranked_league_season:13,
      shotgun_pro_league_season:7,
      shotgun_pro_league_stage:3,
      super_league_season:6,
    },
  });
});

test("rejects an oversized tournament results body without relying on Content-Length", async () => {
  const { env } = makeEnv();
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    throw new Error("Unexpected upstream request");
  };

  const request = new Request("https://worker.example/admin/tournament-results", {
    method: "POST",
    headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({ padding: "x".repeat(1_000_000) }),
  });
  assert.equal(request.headers.get("Content-Length"), null);

  const response = await worker.fetch(request, env);

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
  assert.equal(upstreamCalled, false);
});

test("loads canonical admin event ranges without caching", async () => {
  const privateKey = await makeTestPrivateKeyPem();
  const { env } = makeEnv({
    bindings: {
      GOOGLE_API_KEY: undefined,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "reader-test@example.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    },
  });
  const upstreamUrls = [];
  globalThis.fetch = async (input, init = {}) => {
    const upstreamUrl = new URL(String(input));
    upstreamUrls.push(upstreamUrl);

    if (upstreamUrl.hostname === "project.supabase.co") {
      assert.equal(upstreamUrl.pathname, "/rest/v1/rpc/get_tournament_editor_read_context");
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.headers.apikey, "test-publishable-key");
      assert.deepEqual(JSON.parse(init.body), { p_event_key: "masters" });
      return Response.json([{
        event_key: "masters",
        display_name: "World Golf Masters",
        route_path: "/masters",
        sheet_id: "masters-sheet",
        source_ranges: ["'Qualifiers'!A:T", "'Bracket'!A1:R16"],
        editable_ranges: ["'Qualifiers'!K2:N16", "'Bracket'!C2:I16"],
        formula_ranges: ["'Qualifiers'!T2:T16", "'Bracket'!R2:R16"],
        editor_tables: [{ key: "main-bracket", source_range: "'Bracket'!A1:R16" }],
        edit_enabled: true,
        archived: false,
        can_edit: true,
        archived_at: null,
      }]);
    }

    if (upstreamUrl.href === "https://oauth2.googleapis.com/token") {
      const tokenBody = new URLSearchParams(init.body);
      assert.equal(tokenBody.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(tokenBody.get("assertion").split(".").length, 3);
      return Response.json({ access_token: "google-read-token", expires_in: 3600 });
    }

    assert.equal(upstreamUrl.pathname, "/v4/spreadsheets/masters-sheet/values:batchGet");
    assert.deepEqual(upstreamUrl.searchParams.getAll("ranges"), ["'Qualifiers'!A:T", "'Bracket'!A1:R16"]);
    assert.equal(upstreamUrl.searchParams.has("key"), false);
    assert.equal(init.headers.Authorization, "Bearer google-read-token");
    return Response.json({
      valueRanges: [{ range: "'Bracket'!A1:R16", values: [["Round 1"]] }],
    });
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results?eventKey=masters"),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(upstreamUrls.length, 3);
  assert.deepEqual(await response.json(), {
    event: {
      eventKey: "masters",
      displayName: "World Golf Masters",
      routePath: "/masters",
      sourceRanges: ["'Qualifiers'!A:T", "'Bracket'!A1:R16"],
      editableRanges: ["'Qualifiers'!K2:N16", "'Bracket'!C2:I16"],
      formulaRanges: ["'Qualifiers'!T2:T16", "'Bracket'!R2:R16"],
      tables: [{ key: "main-bracket", source_range: "'Bracket'!A1:R16" }],
      views: [],
      activeViewKey: "",
      editEnabled: true,
      archived: false,
      canEdit: true,
      archivedAt: null,
    },
    valueRanges: [{ range: "'Bracket'!A1:R16", values: [["Round 1"]] }],
  });
});

test("loads only the selected Pro League season and stage ranges", async () => {
  const privateKey = await makeTestPrivateKeyPem();
  const { env } = makeEnv({
    bindings: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "period-reader@example.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    },
  });
  const tables = [
    {
      key: "stage-2-scores",
      group_key: "season-7-stage-2",
      group_label: "Season 7, Stage 2",
      season_value: 7,
      season_label: "Season 7",
      stage_value: 2,
      source_range: "'Season 7, Stage 2'!A3:S101",
    },
    {
      key: "stage-3-scores",
      group_key: "season-7-stage-3",
      group_label: "Season 7, Stage 3",
      season_value: 7,
      season_label: "Season 7",
      stage_value: 3,
      source_range: "'Season 7, Stage 3'!A3:S101",
    },
  ];

  globalThis.fetch = async (input) => {
    const upstreamUrl = new URL(String(input));
    if (upstreamUrl.hostname === "project.supabase.co") {
      return Response.json([{
        event_key: "proleague",
        display_name: "Shotgun Pro League",
        route_path: "/proleague",
        sheet_id: "proleague-sheet",
        source_ranges: tables.map((table) => table.source_range),
        editable_ranges: ["'Season 7, Stage 3'!L5:S8"],
        formula_ranges: ["'Season 7, Stage 3'!A4:K101"],
        editor_tables: tables,
        edit_enabled: true,
        archived: false,
        can_edit: true,
        archived_at: null,
      }]);
    }
    if (upstreamUrl.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "period-read-token", expires_in: 3600 });
    }
    assert.deepEqual(upstreamUrl.searchParams.getAll("ranges"), ["'Season 7, Stage 3'!A3:S101"]);
    return Response.json({ valueRanges: [{ range: "'Season 7, Stage 3'!A3:S101", values: [] }] });
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results?eventKey=proleague&viewKey=season-7-stage-3", {
      headers: { Authorization: "Bearer user-token" },
    }),
    env,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.event.activeViewKey, "season-7-stage-3");
  assert.deepEqual(payload.event.tables, [tables[1]]);
  assert.deepEqual(payload.event.sourceRanges, [tables[1].source_range]);
  assert.deepEqual(payload.event.views, [
    { key: "season-7-stage-2", label: "Season 7, Stage 2", seasonValue: 7, seasonLabel: "Season 7", stageValue: 2 },
    { key: "season-7-stage-3", label: "Season 7, Stage 3", seasonValue: 7, seasonLabel: "Season 7", stageValue: 3 },
  ]);
});

test("rejects an unknown Pro League editor view before contacting Google", async () => {
  const { env } = makeEnv();
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    upstreamCalls += 1;
    const upstreamUrl = new URL(String(input));
    assert.equal(upstreamUrl.hostname, "project.supabase.co");
    return Response.json([{
      event_key: "proleague",
      display_name: "Shotgun Pro League",
      route_path: "/proleague",
      sheet_id: "proleague-sheet",
      source_ranges: ["'Season 7, Stage 3'!A3:S101"],
      editable_ranges: ["'Season 7, Stage 3'!L5:S8"],
      formula_ranges: ["'Season 7, Stage 3'!A4:K101"],
      editor_tables: [{
        key: "stage-3-scores",
        group_key: "season-7-stage-3",
        group_label: "Season 7, Stage 3",
        season_value: 7,
        season_label: "Season 7",
        stage_value: 3,
        source_range: "'Season 7, Stage 3'!A3:S101",
      }],
      edit_enabled: true,
      archived: false,
      can_edit: true,
      archived_at: null,
    }]);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results?eventKey=proleague&viewKey=season-7-stage-99", {
      headers: { Authorization: "Bearer user-token" },
    }),
    env,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Unknown tournament editor view." });
  assert.equal(upstreamCalls, 1);
});

test("maps an archived event authorization failure without calling Google", async () => {
  const { env } = makeEnv();
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json(
      { code: "55000", message: "Tournament result editing is archived for masters." },
      { status: 400 },
    );
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results", {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        eventKey: "masters",
        updates: [{ range: "'Bracket'!D4", values: [[1]] }],
      }),
    }),
    env,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Tournament result editing is archived for masters.",
  });
  assert.equal(upstreamCalls, 1);
});

test("rejects writes to formula cells outside the RPC-provided editable score ranges", async () => {
  const { env } = makeEnv();
  let upstreamCalls = 0;
  globalThis.fetch = async (input) => {
    upstreamCalls += 1;
    if (new URL(String(input)).pathname.endsWith("/get_my_discord_actor")) {
      return Response.json([TEST_ADMIN_ACTOR]);
    }
    return Response.json([{
      event_key: "masters",
      sheet_id: "masters-sheet",
      source_ranges: ["'Bracket'!A1:R16"],
      editable_ranges: ["'Bracket'!C2:I16", "'Bracket'!K2:Q16"],
    }]);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results", {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        eventKey: "masters",
        updates: [{ range: "'Bracket'!R4", values: [["winner override"]] }],
      }),
    }),
    env,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /outside this event's editable cells/);
  assert.equal(upstreamCalls, 2);
});

test("writes validated cells to the canonical sheet with RAW input", async () => {
  const privateKey = await makeTestPrivateKeyPem();
  const { env } = makeEnv({
    bindings: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "worker-test@example.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    },
  });
  const upstreamUrls = [];
  let googleWriteBody;
  const actionId = "11111111-1111-4111-8111-111111111111";

  globalThis.fetch = async (input, init = {}) => {
    const upstreamUrl = new URL(String(input));
    upstreamUrls.push(upstreamUrl);

    if (upstreamUrl.hostname === "project.supabase.co") {
      const rpc = upstreamUrl.pathname.split("/").at(-1);
      if (rpc === "get_my_discord_actor") {
        return Response.json([TEST_ADMIN_ACTOR]);
      }
      if (rpc === "authorize_tournament_result_edit") {
        return Response.json([{
          event_key: "masters",
          sheet_id: "canonical-masters-sheet",
          source_ranges: ["'Bracket'!A1:R16"],
          editable_ranges: ["'Bracket'!C2:I16", "'Bracket'!K2:Q16"],
        }]);
      }
      if (rpc === "create_tournament_result_action_log") {
        assert.equal(init.headers.apikey, "test-secret-key");
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.headers["X-NSSGolf-Actor-User-Id"], TEST_ADMIN_ACTOR.actor_user_id);
        assert.deepEqual(JSON.parse(init.body), {
          p_event_key: "masters",
          p_action_type: "edit",
          p_changes: [{
            range: "'Bracket'!D4:E4",
            before: [],
            after: [["1", ""]],
            playerName: "Aidan",
            headers: ["R1", "R2"],
          }],
          p_target_action_id: null,
        });
        return Response.json([{ action_id: actionId, changes: [] }]);
      }
      if (rpc === "set_tournament_result_action_log_changes") {
        assert.deepEqual(JSON.parse(init.body), {
          p_action_id: actionId,
          p_changes: [{
            range: "'Bracket'!D4:E4",
            before: [[3, ""]],
            after: [["1", ""]],
            playerName: "Aidan",
            headers: ["R1", "R2"],
          }],
        });
        return Response.json([{ action_id: actionId, changes: [] }]);
      }
      if (rpc === "complete_tournament_result_action_log") {
        assert.deepEqual(JSON.parse(init.body), {
          p_action_id: actionId,
          p_succeeded: true,
          p_error_message: null,
        });
        return Response.json([{ action_id: actionId, status: "succeeded" }]);
      }
      throw new Error(`Unexpected Supabase RPC: ${rpc}`);
    }

    if (upstreamUrl.href === "https://oauth2.googleapis.com/token") {
      const tokenBody = new URLSearchParams(init.body);
      assert.equal(tokenBody.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(tokenBody.get("assertion").split(".").length, 3);
      return Response.json({ access_token: "google-access-token", expires_in: 3600 });
    }

    if (upstreamUrl.pathname.endsWith("/values:batchGet")) {
      assert.deepEqual(upstreamUrl.searchParams.getAll("ranges"), ["'Bracket'!D4:E4"]);
      assert.equal(upstreamUrl.searchParams.get("valueRenderOption"), "UNFORMATTED_VALUE");
      return Response.json({ valueRanges: [{ range: "'Bracket'!D4:E4", values: [[3]] }] });
    }

    assert.equal(upstreamUrl.pathname, "/v4/spreadsheets/canonical-masters-sheet/values:batchUpdate");
    assert.equal(init.headers.Authorization, "Bearer google-access-token");
    googleWriteBody = JSON.parse(init.body);
    return Response.json({
      totalUpdatedCells: 2,
      totalUpdatedRows: 1,
      totalUpdatedColumns: 2,
      totalUpdatedSheets: 1,
    });
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results", {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        eventKey: "masters",
        sheetId: "attacker-controlled-sheet",
        updates: [{
          range: "'Bracket'!D4:E4",
          values: [["1", null]],
          playerName: "Aidan",
          headers: ["R1", "R2"],
        }],
      }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(upstreamUrls.length, 8);
  assert.deepEqual(googleWriteBody, {
    valueInputOption: "RAW",
    data: [{ range: "'Bracket'!D4:E4", majorDimension: "ROWS", values: [["1", ""]] }],
  });
  assert.deepEqual(await response.json(), {
    eventKey: "masters",
    actionId,
    updatedRanges: ["'Bracket'!D4:E4"],
    totalUpdatedCells: 2,
    totalUpdatedRows: 1,
    totalUpdatedColumns: 2,
    totalUpdatedSheets: 1,
  });
});

test("does not write to Google when the required audit log cannot be created", async () => {
  const privateKey = await makeTestPrivateKeyPem();
  const { env } = makeEnv({
    bindings: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "audit-gate-test@example.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    },
  });
  let googleWriteCalled = false;

  globalThis.fetch = async (input) => {
    const upstreamUrl = new URL(String(input));
    if (upstreamUrl.pathname.endsWith("/get_my_discord_actor")) {
      return Response.json([TEST_ADMIN_ACTOR]);
    }
    if (upstreamUrl.pathname.endsWith("/authorize_tournament_result_edit")) {
      return Response.json([{
        event_key: "masters",
        sheet_id: "masters-sheet",
        editable_ranges: ["'Bracket'!C2:I16"],
      }]);
    }
    if (upstreamUrl.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "audit-google-token", expires_in: 3600 });
    }
    if (upstreamUrl.pathname.endsWith("/values:batchGet")) {
      return Response.json({ valueRanges: [{ values: [[1]] }] });
    }
    if (upstreamUrl.pathname.endsWith("/create_tournament_result_action_log")) {
      return Response.json(
        { code: "55000", message: "Unable to create the required audit log." },
        { status: 400 },
      );
    }
    if (upstreamUrl.pathname.endsWith("/values:batchUpdate")) googleWriteCalled = true;
    throw new Error(`Unexpected upstream request: ${upstreamUrl}`);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results", {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        eventKey: "masters",
        updates: [{ range: "'Bracket'!C2", values: [[-1]] }],
      }),
    }),
    env,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Unable to create the required audit log." });
  assert.equal(googleWriteCalled, false);
});

test("undo logs a failed attempt instead of overwriting cells changed after the edit", async () => {
  const privateKey = await makeTestPrivateKeyPem();
  const { env } = makeEnv({
    bindings: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "undo-conflict-test@example.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    },
  });
  const actionId = "22222222-2222-4222-8222-222222222222";
  const undoActionId = "66666666-6666-4666-8666-666666666666";
  let undoLogCreated = false;
  let googleWriteCalled = false;

  globalThis.fetch = async (input, init = {}) => {
    const upstreamUrl = new URL(String(input));
    if (upstreamUrl.pathname.endsWith("/get_my_discord_actor")) {
      return Response.json([TEST_ADMIN_ACTOR]);
    }
    if (upstreamUrl.pathname.endsWith("/get_tournament_result_action_for_undo")) {
      return Response.json([{
        action_id: actionId,
        event_key: "masters",
        sheet_id: "masters-sheet",
        editable_ranges: ["'Bracket'!C2:I16"],
        changes: [{ range: "'Bracket'!C2", before: [[1]], after: [[2]] }],
      }]);
    }
    if (upstreamUrl.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "undo-conflict-token", expires_in: 3600 });
    }
    if (upstreamUrl.pathname.endsWith("/create_tournament_result_action_log")) {
      undoLogCreated = true;
      return Response.json([{
        action_id: undoActionId,
        changes: [{ range: "'Bracket'!C2", before: [[2]], after: [[1]] }],
      }]);
    }
    if (upstreamUrl.pathname.endsWith("/values:batchGet")) {
      return Response.json({ valueRanges: [{ values: [[3]] }] });
    }
    if (upstreamUrl.pathname.endsWith("/complete_tournament_result_action_log")) {
      const body = JSON.parse(init.body || "{}");
      assert.equal(body.p_succeeded, false);
      return Response.json([{ action_id: undoActionId, status: "failed" }]);
    }
    if (upstreamUrl.pathname.endsWith("/values:batchUpdate")) googleWriteCalled = true;
    throw new Error(`Unexpected upstream request: ${upstreamUrl}`);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-action-logs", {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({ actionId }),
    }),
    env,
  );

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /cells have changed/);
  assert.equal(undoLogCreated, true);
  assert.equal(googleWriteCalled, false);
});

test("undo creates an inverse audit entry before restoring prior values", async () => {
  const privateKey = await makeTestPrivateKeyPem();
  const { env } = makeEnv({
    bindings: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "undo-success-test@example.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
    },
  });
  const actionId = "33333333-3333-4333-8333-333333333333";
  const undoActionId = "44444444-4444-4444-8444-444444444444";
  const calls = [];

  globalThis.fetch = async (input, init = {}) => {
    const upstreamUrl = new URL(String(input));
    calls.push(upstreamUrl.pathname);
    if (upstreamUrl.pathname.endsWith("/get_my_discord_actor")) {
      return Response.json([TEST_ADMIN_ACTOR]);
    }
    if (upstreamUrl.pathname.endsWith("/get_tournament_result_action_for_undo")) {
      return Response.json([{
        action_id: actionId,
        event_key: "masters",
        sheet_id: "masters-sheet",
        editable_ranges: ["'Bracket'!C2:I16"],
        changes: [{ range: "'Bracket'!C2:D2", before: [[1, ""]], after: [[2, -1]] }],
      }]);
    }
    if (upstreamUrl.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "undo-success-token", expires_in: 3600 });
    }
    if (upstreamUrl.pathname.endsWith("/values:batchGet")) {
      return Response.json({ valueRanges: [{ values: [[2, -1]] }] });
    }
    if (upstreamUrl.pathname.endsWith("/create_tournament_result_action_log")) {
      assert.deepEqual(JSON.parse(init.body), {
        p_event_key: "masters",
        p_action_type: "undo",
        p_changes: null,
        p_target_action_id: actionId,
      });
      return Response.json([{
        action_id: undoActionId,
        changes: [{ range: "'Bracket'!C2:D2", before: [[2, -1]], after: [[1, ""]] }],
      }]);
    }
    if (upstreamUrl.pathname.endsWith("/values:batchUpdate")) {
      assert.deepEqual(JSON.parse(init.body), {
        valueInputOption: "RAW",
        data: [{ range: "'Bracket'!C2:D2", majorDimension: "ROWS", values: [[1, ""]] }],
      });
      return Response.json({ totalUpdatedCells: 2 });
    }
    if (upstreamUrl.pathname.endsWith("/complete_tournament_result_action_log")) {
      assert.equal(JSON.parse(init.body).p_succeeded, true);
      return Response.json([{ action_id: undoActionId, status: "succeeded" }]);
    }
    throw new Error(`Unexpected upstream request: ${upstreamUrl}`);
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-action-logs", {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({ actionId }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    actionId: undoActionId,
    undoneActionId: actionId,
    updatedRanges: ["'Bracket'!C2:D2"],
    totalUpdatedCells: 2,
  });
  assert.ok(calls.indexOf("/rest/v1/rpc/create_tournament_result_action_log")
    < calls.indexOf("/v4/spreadsheets/masters-sheet/values:batchUpdate"));
});
