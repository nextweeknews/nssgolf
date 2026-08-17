import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import worker from "./src/worker.mjs";

const originalFetch = globalThis.fetch;

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

test("returns the deployed CORS headers for an allowed preflight", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/", {
      method: "OPTIONS",
      headers: { Origin: "https://nssgolf.com" },
    }),
    makeEnv().env,
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://nssgolf.com");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assert.equal(response.headers.get("Vary"), "Origin");
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
  globalThis.fetch = async (input) => {
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

test("requires a Supabase user token for the tournament results route", async () => {
  const { env } = makeEnv();
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    throw new Error("Unexpected upstream request");
  };

  const response = await worker.fetch(
    new Request("https://worker.example/admin/tournament-results?eventKey=masters"),
    env,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
  assert.equal(upstreamCalled, false);
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
      assert.equal(init.headers.Authorization, "Bearer user-token");
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
    new Request("https://worker.example/admin/tournament-results?eventKey=masters", {
      headers: { Authorization: "Bearer user-token" },
    }),
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
      editEnabled: true,
      archived: false,
      canEdit: true,
      archivedAt: null,
    },
    valueRanges: [{ range: "'Bracket'!A1:R16", values: [["Round 1"]] }],
  });
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
  globalThis.fetch = async () => {
    upstreamCalls += 1;
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
  assert.match((await response.json()).error, /outside this event's editable score cells/);
  assert.equal(upstreamCalls, 1);
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

  globalThis.fetch = async (input, init = {}) => {
    const upstreamUrl = new URL(String(input));
    upstreamUrls.push(upstreamUrl);

    if (upstreamUrl.hostname === "project.supabase.co") {
      assert.equal(upstreamUrl.pathname, "/rest/v1/rpc/authorize_tournament_result_edit");
      return Response.json([{
        event_key: "masters",
        sheet_id: "canonical-masters-sheet",
        source_ranges: ["'Bracket'!A1:R16"],
        editable_ranges: ["'Bracket'!C2:I16", "'Bracket'!K2:Q16"],
      }]);
    }

    if (upstreamUrl.href === "https://oauth2.googleapis.com/token") {
      const tokenBody = new URLSearchParams(init.body);
      assert.equal(tokenBody.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(tokenBody.get("assertion").split(".").length, 3);
      return Response.json({ access_token: "google-access-token", expires_in: 3600 });
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
        updates: [{ range: "'Bracket'!D4:E4", values: [["1", null]] }],
      }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(upstreamUrls.length, 3);
  assert.deepEqual(googleWriteBody, {
    valueInputOption: "RAW",
    data: [{ range: "'Bracket'!D4:E4", majorDimension: "ROWS", values: [["1", ""]] }],
  });
  assert.deepEqual(await response.json(), {
    eventKey: "masters",
    updatedRanges: ["'Bracket'!D4:E4"],
    totalUpdatedCells: 2,
    totalUpdatedRows: 1,
    totalUpdatedColumns: 2,
    totalUpdatedSheets: 1,
  });
});
