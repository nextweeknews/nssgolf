addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request, event));
});

const API_BASE = "https://api.teamupgg.com";

// KV keys
const KV_KEY_LEADERBOARD = "leaderboard_snapshot";
const KV_KEY_RECENT_CHANGES = "recent_changes";

// How many recent match-change events to keep
const MAX_RECENT_MATCHES = 10;

// Kill switch for live proxy routes only
const DISABLED = true;

// Defaults
const DEFAULT_LEADERBOARD = "season-14";
const DEFAULT_FORMAT = ""; // empty = global ratings
const SNAPSHOT_LIMIT = 500;

async function handleRequest(request, event) {
  const url = new URL(request.url);
  let path = url.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // ---------- Webhook ----------
  if (path === "/webhook" && request.method === "POST") {
    const rawBody = await request.text();

    const signature = request.headers.get("X-Signature");
    const timestampHeader = request.headers.get("X-Timestamp");
    const eventTypeHeader = request.headers.get("X-Event-Type");

    const valid = await verifyWebhookSignature(rawBody, signature);
    if (!valid) {
      console.log("Invalid webhook signature", {
        signature,
        timestamp: timestampHeader,
        eventType: eventTypeHeader
      });
      return new Response("Invalid signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const eventType = eventTypeHeader || payload?.event || "unknown";

    const ts =
      typeof timestampHeader === "string"
        ? Number(timestampHeader) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

    if (eventType === "leaderboard_ratings" || payload?.event === "leaderboard_ratings") {
      const existing = await TEAMUP_CACHE.get(KV_KEY_RECENT_CHANGES);
      let recent = [];

      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          if (Array.isArray(parsed)) recent = parsed;
        } catch {
          // ignore bad cache contents
        }
      }

      recent.unshift({
        timestamp: ts,
        eventType: "leaderboard_ratings",
        payload
      });

      if (recent.length > MAX_RECENT_MATCHES) {
        recent = recent.slice(0, MAX_RECENT_MATCHES);
      }

      await TEAMUP_CACHE.put(KV_KEY_RECENT_CHANGES, JSON.stringify(recent));

      // Always refresh one canonical cached leaderboard snapshot.
      // This intentionally ignores leaderboard ids from the webhook payload.
      event.waitUntil(
        refreshLeaderboardSnapshotInBackground({
          leaderboard: DEFAULT_LEADERBOARD,
          format: DEFAULT_FORMAT,
          triggeredByWebhookTimestamp: ts,
          webhookEventType: eventType
        })
      );

      console.log("Stored leaderboard_ratings event", {
        recentLength: recent.length,
        refreshLeaderboard: DEFAULT_LEADERBOARD
      });

      return new Response("OK", { status: 200 });
    }

    await TEAMUP_CACHE.put(
      "last_webhook",
      JSON.stringify({ eventType, payload, timestamp: ts })
    );
    console.log("Stored non-leaderboard webhook event", { eventType });

    return new Response("OK", { status: 200 });
  }

  // ---------- Cached recent changes ----------
  if (path === "/get_recent_changes" && request.method === "GET") {
    const recent = await TEAMUP_CACHE.get(KV_KEY_RECENT_CHANGES);
    return new Response(recent || "[]", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders()
      }
    });
  }

  // ---------- Cached leaderboard snapshot ----------
  if (path === "/get_leaderboard_snapshot" && request.method === "POST") {
    const snapshot = await TEAMUP_CACHE.get(KV_KEY_LEADERBOARD);
    if (!snapshot) {
      return errorResponse("Leaderboard snapshot not available yet", 503);
    }

    // Return the raw Team Up rankings payload for frontend compatibility.
    try {
      let parsed = JSON.parse(snapshot);
      if (parsed?.requested_leaderboard !== DEFAULT_LEADERBOARD) {
        await refreshLeaderboardSnapshotInBackground({
          leaderboard: DEFAULT_LEADERBOARD,
          format: DEFAULT_FORMAT
        });
        const refreshedSnapshot = await TEAMUP_CACHE.get(KV_KEY_LEADERBOARD);
        if (refreshedSnapshot) parsed = JSON.parse(refreshedSnapshot);
      }
      const payload = parsed?.data ?? parsed;

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders()
        }
      });
    } catch {
      return new Response(snapshot, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders()
        }
      });
    }
  }

  // ---------- Debug snapshot status ----------
  if (path === "/debug_snapshot_status" && request.method === "GET") {
    const snapshot = await TEAMUP_CACHE.get(KV_KEY_LEADERBOARD);
    return new Response(snapshot || "null", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders()
      }
    });
  }

  // ---------- Deprecated old route ----------
  if (path === "/get_leaderboard") {
    return errorResponse(
      "This route is deprecated. Use /get_leaderboard_snapshot instead.",
      410
    );
  }

  // ---------- Player history: cached until this player's match count changes ----------
  if (path === "/get_player_history" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (!body || typeof body.player_id !== "string" || !/^\d{1,20}$/.test(body.player_id)) {
      return errorResponse("A Discord player_id is required", 400);
    }
    if ((body.leaderboard && body.leaderboard !== DEFAULT_LEADERBOARD) ||
        (body.format && body.format !== "global")) {
      return errorResponse("Only the current season's global history is available", 400);
    }

    try {
      const rawSnapshot = await TEAMUP_CACHE.get(KV_KEY_LEADERBOARD);
      if (!rawSnapshot) return errorResponse("Leaderboard snapshot unavailable", 503);
      const snapshot = JSON.parse(rawSnapshot);
      if (snapshot.requested_leaderboard !== DEFAULT_LEADERBOARD) {
        return errorResponse("Waiting for current season snapshot", 503);
      }
      const entries = Array.isArray(snapshot.data?.leaderboard)
        ? snapshot.data.leaderboard : snapshot.data?.entries;
      const entry = entries?.find(item => String(item.team?.[0] ?? item.player_id) === body.player_id);
      if (!entry) return errorResponse("Player not in the current leaderboard", 404);
      const matchesCount = entry.matches;
      if (!Number.isInteger(matchesCount) || matchesCount < 0) {
        return errorResponse("Player match count unavailable", 503);
      }

      const key = `player_history:${DEFAULT_LEADERBOARD}:${body.player_id}`;
      const rawCached = await TEAMUP_CACHE.get(key);
      const cached = rawCached ? JSON.parse(rawCached) : null;
      if (cached?.history_version === 2 && cached.matches_count === matchesCount && Array.isArray(cached.matches)) {
        return playerHistoryResponse(cached);
      }

      // On an undo, rebuild from upstream so the removed game disappears.
      const previous = cached?.history_version === 2 && cached.matches_count < matchesCount && Array.isArray(cached.matches)
        ? cached.matches : [];
      const boundary = previous.length ? previous[0].timestamp : null;
      const newMatches = [];
      const cursors = new Set();
      let cursor = "";
      let complete = matchesCount === 0;
      // ponytail: bounded pagination; fail visibly beyond 10,000 games instead of truncating.
      for (let page = 0; !complete && page < 100; page++) {
        const query = buildQuery({ player: body.player_id, limit: 100, cursor });
        const data = await teamUpFetch(
          `${getClientBasePath()}/matches/${encodeURIComponent(DEFAULT_LEADERBOARD)}${query}`
        );
        if (!Array.isArray(data?.matches)) throw new Error("Invalid TeamUp match history");
        let reachedBoundary = false;
        for (const match of data.matches) {
          if (!Number.isFinite(match.timestamp)) throw new Error("Invalid match timestamp");
          if (boundary !== null && match.timestamp <= boundary) {
            reachedBoundary = true;
            break;
          }
          const result = (match.results || []).find(result =>
            (result.players || []).some(player => String(player.player_id) === body.player_id));
          const player = result?.players?.find(player => String(player.player_id) === body.player_id);
          if (!player || !Number.isFinite(player.new_elo)) {
            throw new Error("TeamUp did not return player-specific rating history");
          }
          const tied = (match.results || []).filter(team => team.place === result.place)
            .reduce((count, team) => count + (team.players || []).length, 0) > 1;
          newMatches.push({ timestamp: match.timestamp, results: [{ place: result.place, tied, players: [player] }] });
        }
        complete = reachedBoundary || !data.cursor;
        if (!complete) {
          if (typeof data.cursor !== "string" || cursors.has(data.cursor)) {
            throw new Error("Invalid TeamUp history cursor");
          }
          cursors.add(data.cursor);
          cursor = data.cursor;
        }
      }
      if (!complete) throw new Error("Season history exceeds the pagination limit");
      const matches = [...new Map([...newMatches, ...previous].map(match => [match.timestamp, match])).values()]
        .sort((a, b) => b.timestamp - a.timestamp);
      // Upstream and the webhook snapshot can arrive in either order. Do not cache a partial version.
      if (matchesCount > 0 && matches[0]?.results?.[0]?.players?.[0]?.matches !== matchesCount) {
        return errorResponse("Waiting for history and leaderboard to agree", 409);
      }
      const data = { history_version: 2, player_id: body.player_id, leaderboard: DEFAULT_LEADERBOARD, matches_count: matchesCount, matches };
      await TEAMUP_CACHE.put(key, JSON.stringify(data));
      return playerHistoryResponse(data);
    } catch (err) {
      return errorResponse(err?.message || "Player history unavailable", 502);
    }
  }

  // ---------- Live proxy off switch ----------
  if (DISABLED) {
    return new Response(
      JSON.stringify({
        error:
          "Automatic upstream API requests are no longer routed. Use GET /get_recent_changes and POST /get_leaderboard_snapshot."
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders()
        }
      }
    );
  }

  // ---------- Live proxy: get_player_rating ----------
  if (path === "/get_player_rating" && request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid or missing JSON body", 400);
    }

    if (!body.player_id) {
      return errorResponse("Missing required field: player_id", 400);
    }

    try {
      const data = await getPlayerRating({
        playerId: body.player_id,
        leaderboard: body.leaderboard || DEFAULT_LEADERBOARD,
        format: body.format || DEFAULT_FORMAT
      });

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders()
        }
      });
    } catch (err) {
      return upstreamErrorResponse(err);
    }
  }

  // ---------- Live proxy: match history ----------
  if (path === "/get_rating_history" && request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    try {
      const data = await getMatchHistory({
        leaderboard: body.leaderboard || DEFAULT_LEADERBOARD,
        format: body.format || DEFAULT_FORMAT,
        playerId: body.player_id || "",
        cursor: body.cursor || "",
        limit: body.limit || 10
      });

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders()
        }
      });
    } catch (err) {
      return upstreamErrorResponse(err);
    }
  }

  return errorResponse(`Unknown endpoint: ${path}`, 404);
}

function playerHistoryResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key"
  };
}

function errorResponse(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function upstreamErrorResponse(err) {
  const status = Number(err?.status) || 500;
  const message =
    err?.message || err?.data?.error || err?.data?.message || "Upstream API error";

  return new Response(
    JSON.stringify({
      error: message,
      upstream_status: status,
      upstream_data: err?.data || null
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders()
      }
    }
  );
}

function buildQuery(params) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function getClientBasePath() {
  if (!TEAMUP_CLIENT_ID) {
    throw new Error("Missing TEAMUP_CLIENT_ID binding");
  }
  return `/v1/client/${encodeURIComponent(TEAMUP_CLIENT_ID)}`;
}

async function teamUpFetch(path, { method = "GET", body } = {}) {
  if (!TEAMUP_API_KEY) {
    throw new Error("Missing TEAMUP_API_KEY binding");
  }

  const fullUrl = `${API_BASE}${path}`;
  console.log("Team Up request", { method, url: fullUrl });

  const res = await fetch(fullUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": TEAMUP_API_KEY
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      data?.error || data?.message || `Team Up API error (${res.status})`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function getPlayerRating({ playerId, leaderboard, format }) {
  const query = buildQuery({ leaderboard, format });
  const path =
    `${getClientBasePath()}/players/${encodeURIComponent(playerId)}/rating${query}`;

  return teamUpFetch(path, { method: "GET" });
}

async function fetchRankingsSnapshot({
  leaderboard,
  format,
  includeProfiles = false,
  limit = SNAPSHOT_LIMIT,
  cursor = ""
}) {
  const include = includeProfiles ? "profiles" : "";
  const query = buildQuery({
    leaderboard,
    format,
    include,
    limit,
    cursor
  });

  const path = `${getClientBasePath()}/rankings${query}`;
  return teamUpFetch(path, { method: "GET" });
}

async function getMatchHistory({
  leaderboard,
  format,
  playerId,
  cursor,
  limit
}) {
  const query = buildQuery({
    player_id: playerId,
    cursor,
    limit
  });

  let path = `${getClientBasePath()}/matches`;

  if (leaderboard && format) {
    path += `/${encodeURIComponent(leaderboard)}/${encodeURIComponent(format)}`;
  } else if (leaderboard) {
    path += `/${encodeURIComponent(leaderboard)}`;
  }

  path += query;

  return teamUpFetch(path, { method: "GET" });
}

async function refreshLeaderboardSnapshotInBackground({
  leaderboard,
  format,
  triggeredByWebhookTimestamp = null,
  webhookEventType = null
}) {
  const requestedLeaderboard = leaderboard || DEFAULT_LEADERBOARD;
  const requestedFormat = format || DEFAULT_FORMAT;

  try {
    const rankings = await fetchRankingsSnapshot({
      leaderboard: requestedLeaderboard,
      format: requestedFormat,
      includeProfiles: true,
      limit: SNAPSHOT_LIMIT
    });

    const entryCount = Array.isArray(rankings?.leaderboard)
      ? rankings.leaderboard.length
      : Array.isArray(rankings)
        ? rankings.length
        : 0;

    const cachePayload = {
      cached_at: new Date().toISOString(),
      requested_leaderboard: requestedLeaderboard,
      requested_format: requestedFormat,
      requested_limit: SNAPSHOT_LIMIT,
      source: "teamup_rankings_api",
      webhook_event_type: webhookEventType,
      webhook_timestamp: triggeredByWebhookTimestamp,
      entry_count: entryCount,
      data: rankings
    };

    await TEAMUP_CACHE.put(KV_KEY_LEADERBOARD, JSON.stringify(cachePayload));

    console.log("Stored refreshed leaderboard snapshot", {
      leaderboard: requestedLeaderboard,
      format: requestedFormat,
      limit: SNAPSHOT_LIMIT,
      entryCount
    });
  } catch (err) {
    console.log("Failed to refresh leaderboard snapshot", {
      error: String(err),
      leaderboard: requestedLeaderboard,
      format: requestedFormat,
      limit: SNAPSHOT_LIMIT
    });
  }
}

// ----- Webhook signature verification -----

async function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader || !WEBHOOK_SECRET) return false;

  const encoder = new TextEncoder();
  const keyData = encoder.encode(WEBHOOK_SECRET);
  const bodyData = encoder.encode(rawBody);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign("HMAC", key, bodyData);
  const hex = bufferToHex(signatureBytes);
  const expectedSignature = "sha256=" + hex;

  return timingSafeEqual(signatureHeader, expectedSignature);
}

function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
