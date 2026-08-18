const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_ADMIN_UPDATES = 200;
const MAX_ADMIN_CELLS = 2000;
const MAX_ADMIN_BODY_BYTES = 1_000_000;
const LIGHTNING_CUP_SHEET_ID = "1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ";

let googleAccessTokenCache = null;

class AdminEditError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function columnNumber(letters) {
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

function parseA1Range(value, requireRows = false) {
  const match = String(value || "").trim().match(
    /^(?:'((?:[^']|'')+)'|([^'!]+))!([A-Za-z]+)(\d+)?(?::([A-Za-z]+)(\d+)?)?$/,
  );
  if (!match) throw new AdminEditError("Invalid A1 range.");

  const sheetName = match[1] ? match[1].replace(/''/g, "'") : match[2].trim();
  const startColumn = columnNumber(match[3]);
  const startRow = match[4] ? Number(match[4]) : null;
  const endColumn = columnNumber(match[5] || match[3]);
  const endRow = match[6] ? Number(match[6]) : match[5] ? null : startRow;

  if (!sheetName || startColumn < 1 || endColumn < startColumn) {
    throw new AdminEditError("Invalid A1 range.");
  }
  if ((startRow === null) !== (endRow === null) && endRow !== null) {
    throw new AdminEditError("Invalid A1 row bounds.");
  }
  if (startRow !== null && (startRow < 1 || endRow < startRow)) {
    throw new AdminEditError("Invalid A1 row bounds.");
  }
  if (requireRows && (startRow === null || endRow === null)) {
    throw new AdminEditError("Writes must use explicit cell rows.");
  }

  return { sheetName, startColumn, endColumn, startRow, endRow };
}

function rangeContains(source, target) {
  const sourceStartRow = source.startRow ?? 1;
  const sourceEndRow = source.endRow ?? Number.POSITIVE_INFINITY;
  return source.sheetName === target.sheetName
    && target.startColumn >= source.startColumn
    && target.endColumn <= source.endColumn
    && target.startRow >= sourceStartRow
    && target.endRow <= sourceEndRow;
}

function validateAdminUpdates(updates, editableRanges) {
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > MAX_ADMIN_UPDATES) {
    throw new AdminEditError(`Provide between 1 and ${MAX_ADMIN_UPDATES} updates.`);
  }

  const allowedRanges = editableRanges.map((range) => parseA1Range(range));
  const seenRanges = new Set();
  let totalCells = 0;

  return updates.map((update) => {
    const range = String(update?.range || "").trim();
    const parsedRange = parseA1Range(range, true);
    if (seenRanges.has(range)) throw new AdminEditError(`Duplicate update range: ${range}`);
    seenRanges.add(range);

    if (!allowedRanges.some((allowedRange) => rangeContains(allowedRange, parsedRange))) {
      throw new AdminEditError(`Range is outside this event's editable cells: ${range}`);
    }

    const rowCount = parsedRange.endRow - parsedRange.startRow + 1;
    const columnCount = parsedRange.endColumn - parsedRange.startColumn + 1;
    if (!Array.isArray(update?.values) || update.values.length !== rowCount) {
      throw new AdminEditError(`Values do not match range height: ${range}`);
    }

    const values = update.values.map((row) => {
      if (!Array.isArray(row) || row.length !== columnCount) {
        throw new AdminEditError(`Values do not match range width: ${range}`);
      }
      return row.map((value) => {
        if (value === null) return "";
        if (["string", "number", "boolean"].includes(typeof value)) return value;
        throw new AdminEditError(`Unsupported cell value in range: ${range}`);
      });
    });

    const playerName = String(update?.playerName || "").trim();
    const headers = Array.isArray(update?.headers) ? update.headers.map((header) => String(header || "").trim()) : [];
    if (playerName.length > 100 || headers.length > columnCount || headers.some((header) => !header || header.length > 100)) {
      throw new AdminEditError(`Invalid action-log labels for range: ${range}`);
    }

    totalCells += rowCount * columnCount;
    if (totalCells > MAX_ADMIN_CELLS) {
      throw new AdminEditError(`A request may update at most ${MAX_ADMIN_CELLS} cells.`);
    }

    return { range, majorDimension: "ROWS", values, playerName, headers };
  });
}

async function readAdminJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_ADMIN_BODY_BYTES) {
    throw new AdminEditError("Request body is too large.", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new AdminEditError("Invalid JSON body.");

  const decoder = new TextDecoder();
  let body = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ADMIN_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new AdminEditError("Request body is too large.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new AdminEditError("Invalid JSON body.");
  }
}

function requireJsonContentType(request) {
  const contentType = String(request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new AdminEditError("Content-Type must be application/json.", 415);
  }
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeJwtPart(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodePrivateKey(pem) {
  const body = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!body) throw new AdminEditError("Google Sheets credentials are not configured.", 500);
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getGoogleAccessToken(env) {
  const serviceAccountEmail = String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const privateKeyPem = String(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").trim();
  if (!serviceAccountEmail || !privateKeyPem) {
    throw new AdminEditError("Google Sheets credentials are not configured.", 500);
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    googleAccessTokenCache?.serviceAccountEmail === serviceAccountEmail
    && googleAccessTokenCache.expiresAt > now + 60
  ) {
    return googleAccessTokenCache.token;
  }

  let privateKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "pkcs8",
      decodePrivateKey(privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new AdminEditError("Google Sheets credentials are invalid.", 500);
  }

  const header = encodeJwtPart({ alg: "RS256", typ: "JWT" });
  const claims = encodeJwtPart({
    iss: serviceAccountEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });
  const unsignedJwt = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedJwt),
  );

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedJwt}.${base64Url(new Uint8Array(signature))}`,
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || !tokenData?.access_token) {
    throw new AdminEditError("Unable to authorize Google Sheets access.", 502);
  }

  googleAccessTokenCache = {
    serviceAccountEmail,
    token: tokenData.access_token,
    expiresAt: now + Math.max(60, Number(tokenData.expires_in) || 3600),
  };
  return googleAccessTokenCache.token;
}

function supabaseRpcStatus(data, fallbackStatus) {
  if (data?.code === "42501") return 403;
  if (data?.code === "22023") return 400;
  if (data?.code === "55000") return 409;
  if (fallbackStatus === 401) return 401;
  return 502;
}

async function callAdminRpc(env, authorization, functionName, body) {
  const data = await callAdminRpcRows(env, authorization, functionName, body);
  if (!data[0]) {
    throw new AdminEditError("Tournament authorization returned no result.", 502);
  }
  return data[0];
}

async function callAdminRpcRows(env, authorization, functionName, body) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!supabaseUrl || !publishableKey) {
    throw new AdminEditError("Supabase authorization is not configured.", 500);
  }

  const headers = {
    apikey: publishableKey,
    "Content-Type": "application/json",
  };
  if (authorization) headers.Authorization = authorization;

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AdminEditError(
      typeof data?.message === "string" ? data.message : "Unable to process tournament administration.",
      supabaseRpcStatus(data, response.status),
    );
  }
  if (!Array.isArray(data)) {
    throw new AdminEditError("Tournament administration returned an invalid response.", 502);
  }
  return data;
}

async function callWorkerRpc(env, actorUserId, functionName, body) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const secretKey = String(env.SUPABASE_SECRET_KEY || "").trim();
  const actorId = String(actorUserId || "").trim();
  if (!supabaseUrl || !secretKey || !actorId) {
    throw new AdminEditError("Worker-only Supabase authorization is not configured.", 500);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      "Content-Type": "application/json",
      "X-NSSGolf-Actor-User-Id": actorId,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AdminEditError(
      typeof data?.message === "string" ? data.message : "Unable to process the protected Worker action.",
      supabaseRpcStatus(data, response.status),
    );
  }
  if (!Array.isArray(data) || !data[0]) {
    throw new AdminEditError("Protected Worker action returned an invalid response.", 502);
  }
  return data[0];
}

async function getPublicGoogleRange(env, sheetId, range) {
  if (!env.GOOGLE_API_KEY) {
    throw new AdminEditError("Google Sheets access is not configured.", 500);
  }
  const googleUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`
    + `?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`;
  const response = await fetch(googleUrl);
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.values)) {
    throw new AdminEditError("Unable to verify the Lightning Cup competitors.", 502);
  }
  return data.values;
}

function normalizeDiscordId(value) {
  const normalized = String(value || "").trim();
  const mention = normalized.match(/^<@!?(\d+)>$/);
  return mention ? mention[1] : (/^\d+$/.test(normalized) ? normalized : "");
}

async function getLightningCupCompetitorIds(env, matchId) {
  const [bracketRows, seedRows] = await Promise.all([
    getPublicGoogleRange(env, LIGHTNING_CUP_SHEET_ID, "Bracket!A:T"),
    getPublicGoogleRange(env, LIGHTNING_CUP_SHEET_ID, "Seeds!C:E"),
  ]);
  const matchRows = bracketRows.slice(1).filter((row) => Number(row?.[0]) === matchId);
  if (!matchRows.length) throw new AdminEditError("That Lightning Cup match does not exist.", 404);
  if (matchRows.length !== 1) {
    throw new AdminEditError("The Lightning Cup sheet has an ambiguous match ID.", 502);
  }
  const [matchRow] = matchRows;

  const discordIdsByName = new Map();
  for (const row of seedRows) {
    const name = String(row?.[0] || "").trim().toLowerCase();
    const discordId = normalizeDiscordId(row?.[2]);
    if (!name || !discordId) continue;
    const ids = discordIdsByName.get(name) || new Set();
    ids.add(discordId);
    discordIdsByName.set(name, ids);
  }

  const competitorIds = [];
  for (const rawName of [matchRow?.[4], matchRow?.[7]]) {
    const name = String(rawName || "").trim().toLowerCase();
    if (!name) continue;
    const ids = discordIdsByName.get(name) || new Set();
    if (ids.size > 1) {
      throw new AdminEditError("The Lightning Cup sheet has an ambiguous competitor name.", 502);
    }
    if (ids.size === 1) competitorIds.push([...ids][0]);
  }
  return [...new Set(competitorIds)];
}

function normalizeRangeValues(valueRange, range) {
  const parsedRange = parseA1Range(range, true);
  const rowCount = parsedRange.endRow - parsedRange.startRow + 1;
  const columnCount = parsedRange.endColumn - parsedRange.startColumn + 1;
  return Array.from({ length: rowCount }, (_, rowIndex) => (
    Array.from({ length: columnCount }, (_, columnIndex) => (
      valueRange?.values?.[rowIndex]?.[columnIndex] ?? ""
    ))
  ));
}

async function getGoogleRangeValues(accessToken, sheetId, ranges) {
  const googleUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet`,
  );
  for (const range of ranges) googleUrl.searchParams.append("ranges", range);
  googleUrl.searchParams.set("majorDimension", "ROWS");
  googleUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  googleUrl.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER");

  const response = await fetch(googleUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if ([401, 403].includes(response.status)) googleAccessTokenCache = null;
    throw new AdminEditError("Unable to read current tournament sheet values.", 502);
  }

  const valueRanges = Array.isArray(data?.valueRanges) ? data.valueRanges : [];
  return ranges.map((range, index) => normalizeRangeValues(valueRanges[index], range));
}

function auditChanges(updates, beforeValues) {
  return updates.map((update, index) => ({
    range: update.range,
    before: beforeValues[index],
    after: update.values,
    playerName: update.playerName,
    headers: update.headers,
  }));
}

function updatesFromAuditChanges(changes, editableRanges) {
  if (!Array.isArray(changes)) throw new AdminEditError("Tournament action log is invalid.", 502);
  return validateAdminUpdates(
    changes.map((change) => ({ range: change?.range, values: change?.after })),
    editableRanges,
  );
}

function rangeValuesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeGoogleUpdates(accessToken, sheetId, updates) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: updates.map(({ range, majorDimension, values }) => ({ range, majorDimension, values })),
      }),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if ([401, 403].includes(response.status)) googleAccessTokenCache = null;
    throw new AdminEditError("Unable to update tournament sheet values.", 502);
  }
  return data;
}

async function completeActionLog(env, actorUserId, actionId, succeeded, errorMessage = null) {
  return callWorkerRpc(
    env,
    actorUserId,
    "complete_tournament_result_action_log",
    {
      p_action_id: actionId,
      p_succeeded: succeeded,
      p_error_message: errorMessage,
    },
  );
}

function tournamentEditorViews(tables) {
  const views = [];
  const seen = new Set();
  for (const table of tables) {
    const key = String(table?.group_key || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    views.push({
      key,
      label: String(table?.group_label || key),
      seasonValue: table?.season_value ?? null,
      seasonLabel: String(table?.season_label || ""),
      stageValue: table?.stage_value ?? null,
    });
  }
  return views;
}

function hasIterationTemplates(tables) {
  return Array.isArray(tables) && tables.some((table) => table?.kind === "iteration-template");
}

function replaceIterationTokens(value, replacements) {
  if (typeof value === "string") {
    return Object.entries(replacements).reduce(
      (result, [key, replacement]) => result.replaceAll(`{${key}}`, String(replacement)),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => replaceIterationTokens(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => (
      [key, replaceIterationTokens(item, replacements)]
    )));
  }
  return value;
}

function expandTournamentIterations(context, sheetTitles) {
  const staticTables = context.editor_tables.filter((table) => table?.kind !== "iteration-template");
  const generatedTables = [];
  const sourceRanges = [...(context.source_ranges || [])];
  const editableRanges = [...(context.editable_ranges || [])];
  const formulaRanges = [...(context.formula_ranges || [])];

  for (const template of context.editor_tables.filter((table) => table?.kind === "iteration-template")) {
    let pattern;
    try {
      pattern = new RegExp(template.sheet_pattern);
    } catch {
      throw new AdminEditError("Tournament iteration template is invalid.", 502);
    }
    for (const sheetTitle of sheetTitles) {
      const match = String(sheetTitle).match(pattern);
      if (!match) continue;
      const iteration = match[Number(template.iteration_group || 1)];
      const iterationNumber = Number(iteration);
      if (!iteration || !Number.isInteger(iterationNumber)) continue;
      if (Number.isFinite(Number(template.min_iteration)) && iterationNumber < Number(template.min_iteration)) continue;
      if (Number.isFinite(Number(template.max_iteration)) && iterationNumber > Number(template.max_iteration)) continue;
      if ((template.exclude_iterations || []).map(Number).includes(iterationNumber)) continue;

      const replacements = { sheet: String(sheetTitle).replaceAll("'", "''"), iteration };
      generatedTables.push(...replaceIterationTokens(template.tables || [], replacements));
      sourceRanges.push(...replaceIterationTokens(template.source_ranges || [], replacements));
      editableRanges.push(...replaceIterationTokens(template.editable_ranges || [], replacements));
      formulaRanges.push(...replaceIterationTokens(template.formula_ranges || [], replacements));
    }
  }

  return {
    ...context,
    editor_tables: [...staticTables, ...generatedTables],
    source_ranges: [...new Set(sourceRanges)],
    editable_ranges: [...new Set(editableRanges)],
    formula_ranges: [...new Set(formulaRanges)],
  };
}

async function getGoogleSheetTitles(accessToken, sheetId) {
  const metadataUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`,
  );
  metadataUrl.searchParams.set("fields", "sheets.properties.title");
  const response = await fetch(metadataUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if ([401, 403].includes(response.status)) googleAccessTokenCache = null;
    throw new AdminEditError("Unable to discover tournament sheet years.", 502);
  }
  return (data?.sheets || []).map((sheet) => sheet?.properties?.title).filter(Boolean);
}

function selectedTournamentEditorConfig(context, requestedViewKey) {
  const tables = context.editor_tables;
  const views = tournamentEditorViews(tables);
  if (!requestedViewKey) {
    return { views, activeViewKey: "", tables, sourceRanges: context.source_ranges };
  }

  const resolvedViewKey = requestedViewKey === "latest"
    ? [...views].sort((left, right) => Number(right.seasonValue || 0) - Number(left.seasonValue || 0))[0]?.key || ""
    : requestedViewKey;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resolvedViewKey) || !views.some((view) => view.key === resolvedViewKey)) {
    throw new AdminEditError("Unknown tournament editor view.");
  }
  const selectedTables = tables.filter((table) => table?.group_key === resolvedViewKey);
  const allowedSourceRanges = new Set(context.source_ranges);
  const sourceRanges = [...new Set(selectedTables.map((table) => String(table?.source_range || "").trim()))];
  if (!sourceRanges.length || sourceRanges.some((range) => !allowedSourceRanges.has(range))) {
    throw new AdminEditError("Tournament editor view configuration is incomplete.", 502);
  }
  return { views, activeViewKey: resolvedViewKey, tables: selectedTables, sourceRanges };
}

export { expandTournamentIterations, selectedTournamentEditorConfig, validateAdminUpdates };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // =========================
    // CORS
    // =========================
    const allowedOrigins = [
      "https://nextweeknews.github.io",
      "https://nssgolf.com",
      "https://www.nssgolf.com",
    ];

    if (origin && !allowedOrigins.includes(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    const corsOrigin = origin && allowedOrigins.includes(origin) ? origin : "*";

    const baseCorsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: baseCorsHeaders });
    }

    const json = (obj, status = 200, extraHeaders = {}) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: {
          ...baseCorsHeaders,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
      });

    // =========================
    // Helpers
    // =========================
    const isUc = (s) => /^UC[a-zA-Z0-9_-]{20,}$/.test(String(s || "").trim());
    const ytHostOk = (h) => {
      const host = String(h || "").toLowerCase().replace(/^www\./, "");
      return host === "youtube.com" || host === "m.youtube.com";
    };

    function extractChannelIdFromHtml(html) {
      return (
        html.match(/"channelId":"(UC[^"]+)"/)?.[1] ||
        html.match(/"externalId":"(UC[^"]+)"/)?.[1] ||
        html.match(/"browseId":"(UC[^"]+)"/)?.[1] ||
        // sometimes appears JSON-escaped
        html.match(/\\u0022channelId\\u0022\\s*:\\s*\\u0022(UC[^\\u0022]+)\\u0022/)?.[1] ||
        html.match(/\\u0022externalId\\u0022\\s*:\\s*\\u0022(UC[^\\u0022]+)\\u0022/)?.[1] ||
        html.match(/\\u0022browseId\\u0022\\s*:\\s*\\u0022(UC[^\\u0022]+)\\u0022/)?.[1] ||
        null
      );
    }

    function normalizeResolveKey(inputRaw) {
      const s = String(inputRaw || "").trim();
      if (!s) return "";
      // canonicalize handle case and common URL variants
      if (s.startsWith("@")) return `handle:${s.toLowerCase()}`;
      try {
        const u = new URL(/^https?:\/\//i.test(s) ? s : `https://www.youtube.com/${s}`);
        const host = u.hostname.toLowerCase().replace(/^www\./, "");
        const path = u.pathname.replace(/\/+$/, ""); // strip trailing slash
        // keep only youtube hosts in the cache key
        if (host.endsWith("youtube.com")) return `url:https://youtube.com${path}`;
        return `raw:${s.toLowerCase()}`;
      } catch {
        return `raw:${s.toLowerCase()}`;
      }
    }

    async function kvGetResolved(key) {
      try {
        if (!env.UC_IDs) return null;
        const v = await env.UC_IDs.get(key);
        return v && isUc(v) ? v : null;
      } catch {
        return null;
      }
    }

    async function kvPutResolved(key, channelId, ttlSeconds = 60 * 60 * 24 * 14) {
      try {
        if (!env.UC_IDs) return;
        if (!key || !isUc(channelId)) return;
        await env.UC_IDs.put(key, channelId, { expirationTtl: ttlSeconds });
      } catch {
        // ignore
      }
    }

    function isQuotaExceededError(data) {
      const reason = data?.error?.errors?.[0]?.reason;
      return reason === "quotaExceeded" || reason === "dailyLimitExceeded";
    }

    // =========================
    // Lightning Cup live match state
    // POST /lightningcup/match-state { matchId, state }
    // =========================
    if (url.pathname === "/lightningcup/match-state") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405, { Allow: "POST, OPTIONS" });
      }

      const authorization = request.headers.get("Authorization") || "";
      if (!/^Bearer\s+\S+$/i.test(authorization)) {
        return json({ error: "Authentication required." }, 401, { "Cache-Control": "no-store" });
      }

      try {
        requireJsonContentType(request);
        const body = await readAdminJson(request);
        const matchId = Number(body?.matchId);
        if (!Number.isInteger(matchId) || matchId < 1 || matchId > 63) {
          throw new AdminEditError("Invalid Lightning Cup match ID.");
        }
        if (!body?.state || typeof body.state !== "object" || Array.isArray(body.state)) {
          throw new AdminEditError("Invalid Lightning Cup match state.");
        }

        const actor = await callAdminRpc(env, authorization, "get_my_discord_actor", {});
        const competitorIds = await getLightningCupCompetitorIds(env, matchId);
        const saved = await callWorkerRpc(
          env,
          actor.actor_user_id,
          "upsert_lightning_cup_match_state",
          {
            p_actor_user_id: actor.actor_user_id,
            p_match_id: matchId,
            p_state: body.state,
            p_competitor_discord_user_ids: competitorIds,
          },
        );
        return json(saved, 200, { "Cache-Control": "no-store" });
      } catch (error) {
        if (error instanceof AdminEditError) {
          return json({ error: error.message }, error.status, { "Cache-Control": "no-store" });
        }
        return json({ error: "Lightning Cup match state request failed." }, 502, { "Cache-Control": "no-store" });
      }
    }

    // =========================
    // Authenticated tournament editor
    // GET  /admin/tournament-results?eventKey=<event>
    // POST /admin/tournament-results { eventKey, updates: [{ range, values }] }
    // =========================
    if (url.pathname === "/admin/tournament-results") {
      if (!["GET", "POST"].includes(request.method)) {
        return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST, OPTIONS" });
      }

      const authorization = request.headers.get("Authorization") || "";
      if (request.method === "POST" && !/^Bearer\s+\S+$/i.test(authorization)) {
        return json({ error: "Authentication required." }, 401, { "Cache-Control": "no-store" });
      }

      try {
        if (request.method === "GET") {
          const eventKey = String(url.searchParams.get("eventKey") || "").trim();
          const requestedViewKey = String(url.searchParams.get("viewKey") || "").trim();
          if (!eventKey) throw new AdminEditError("Missing eventKey.");

          const context = await callAdminRpc(
            env,
            "",
            "get_tournament_editor_read_context",
            { p_event_key: eventKey },
          );
          if (
            !Array.isArray(context.source_ranges)
            || !Array.isArray(context.editable_ranges)
            || !Array.isArray(context.formula_ranges)
            || !Array.isArray(context.editor_tables)
            || !context.sheet_id
          ) {
            throw new AdminEditError("Tournament configuration is incomplete.", 502);
          }
          let accessToken = null;
          let expandedContext = context;
          if (hasIterationTemplates(context.editor_tables)) {
            accessToken = await getGoogleAccessToken(env);
            expandedContext = expandTournamentIterations(
              context,
              await getGoogleSheetTitles(accessToken, context.sheet_id),
            );
          }
          const editorConfig = selectedTournamentEditorConfig(expandedContext, requestedViewKey);
          accessToken ||= await getGoogleAccessToken(env);
          const googleUrl = new URL(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(context.sheet_id)}/values:batchGet`,
          );
          for (const range of editorConfig.sourceRanges) googleUrl.searchParams.append("ranges", range);
          googleUrl.searchParams.set("majorDimension", "ROWS");

          const sheetResponse = await fetch(googleUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const sheetData = await sheetResponse.json().catch(() => null);
          if (!sheetResponse.ok) {
            if ([401, 403].includes(sheetResponse.status)) googleAccessTokenCache = null;
            throw new AdminEditError("Unable to load tournament sheet values.", 502);
          }

          return json({
            event: {
              eventKey: context.event_key,
              displayName: context.display_name,
              routePath: context.route_path,
              sourceRanges: editorConfig.sourceRanges,
              editableRanges: expandedContext.editable_ranges,
              formulaRanges: expandedContext.formula_ranges,
              tables: editorConfig.tables,
              views: editorConfig.views,
              activeViewKey: editorConfig.activeViewKey,
              editEnabled: context.edit_enabled,
              archived: context.archived,
              canEdit: context.can_edit,
              archivedAt: context.archived_at,
            },
            valueRanges: sheetData?.valueRanges || [],
          }, 200, { "Cache-Control": "no-store" });
        }

        requireJsonContentType(request);
        const body = await readAdminJson(request);

        const actor = await callAdminRpc(env, authorization, "get_my_discord_actor", {});
        if (!actor.is_admin) throw new AdminEditError("Admin access required.", 403);

        const eventKey = String(body?.eventKey || "").trim();
        if (!eventKey) throw new AdminEditError("Missing eventKey.");

        const authorizationResult = await callAdminRpc(
          env,
          authorization,
          "authorize_tournament_result_edit",
          { p_event_key: eventKey },
        );
        if (!Array.isArray(authorizationResult.editable_ranges) || !authorizationResult.sheet_id) {
          throw new AdminEditError("Tournament authorization is incomplete.", 502);
        }

        let accessToken = null;
        let expandedAuthorization = authorizationResult;
        if (hasIterationTemplates(authorizationResult.editor_tables)) {
          accessToken = await getGoogleAccessToken(env);
          expandedAuthorization = expandTournamentIterations(
            {
              ...authorizationResult,
              formula_ranges: authorizationResult.formula_ranges || [],
            },
            await getGoogleSheetTitles(accessToken, authorizationResult.sheet_id),
          );
        }
        const updates = validateAdminUpdates(body?.updates, expandedAuthorization.editable_ranges);
        accessToken ||= await getGoogleAccessToken(env);
        const action = await callWorkerRpc(
          env,
          actor.actor_user_id,
          "create_tournament_result_action_log",
          {
            p_event_key: eventKey,
            p_action_type: "edit",
            p_changes: updates.map((update) => ({
              range: update.range,
              before: [],
              after: update.values,
              playerName: update.playerName,
              headers: update.headers,
            })),
            p_target_action_id: null,
          },
        );

        let writeData;
        try {
          const beforeValues = await getGoogleRangeValues(
            accessToken,
            authorizationResult.sheet_id,
            updates.map((update) => update.range),
          );
          await callWorkerRpc(
            env,
            actor.actor_user_id,
            "set_tournament_result_action_log_changes",
            {
              p_action_id: action.action_id,
              p_changes: auditChanges(updates, beforeValues),
            },
          );
          writeData = await writeGoogleUpdates(accessToken, authorizationResult.sheet_id, updates);
        } catch (error) {
          await completeActionLog(
            env,
            actor.actor_user_id,
            action.action_id,
            false,
            error instanceof Error ? error.message : "Tournament result write failed.",
          ).catch(() => null);
          throw error;
        }

        try {
          await completeActionLog(env, actor.actor_user_id, action.action_id, true);
        } catch {
          throw new AdminEditError(
            "Sheet values were updated, but the audit log could not be finalized. Do not retry this save.",
            502,
          );
        }

        return json({
          eventKey: authorizationResult.event_key,
          actionId: action.action_id,
          updatedRanges: updates.map((update) => update.range),
          totalUpdatedCells: writeData?.totalUpdatedCells || 0,
          totalUpdatedRows: writeData?.totalUpdatedRows || 0,
          totalUpdatedColumns: writeData?.totalUpdatedColumns || 0,
          totalUpdatedSheets: writeData?.totalUpdatedSheets || 0,
        }, 200, { "Cache-Control": "no-store" });
      } catch (error) {
        if (error instanceof AdminEditError) {
          return json({ error: error.message }, error.status, { "Cache-Control": "no-store" });
        }
        return json({ error: "Tournament results request failed." }, 502, { "Cache-Control": "no-store" });
      }
    }

    // =========================
    // Authenticated admin action logs
    // GET  /admin/tournament-action-logs
    // POST /admin/tournament-action-logs { actionId }
    // =========================
    if (url.pathname === "/admin/tournament-action-logs") {
      if (!["GET", "POST"].includes(request.method)) {
        return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST, OPTIONS" });
      }

      const authorization = request.headers.get("Authorization") || "";
      if (!/^Bearer\s+\S+$/i.test(authorization)) {
        return json({ error: "Authentication required." }, 401, { "Cache-Control": "no-store" });
      }

      try {
        if (request.method === "GET") {
          const requestedLimit = Number(url.searchParams.get("limit") || 100);
          const limit = Number.isInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
          const logs = await callAdminRpcRows(
            env,
            authorization,
            "list_admin_action_logs",
            { p_limit: limit },
          );
          return json({ logs }, 200, { "Cache-Control": "no-store" });
        }

        requireJsonContentType(request);
        const body = await readAdminJson(request);
        const actionId = String(body?.actionId || "").trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId)) {
          throw new AdminEditError("Invalid admin action ID.");
        }

        if (body?.actionType === "visibility") {
          const undoAction = await callAdminRpc(
            env,
            authorization,
            "undo_admin_visibility_action",
            { p_action_id: actionId },
          );
          return json({
            actionId: undoAction.action_id,
            undoneActionId: actionId,
            hidden: undoAction.hidden,
          }, 200, { "Cache-Control": "no-store" });
        }

        if (body?.actionType === "configuration") {
          const undoAction = await callAdminRpc(
            env,
            authorization,
            "undo_season_configuration_action",
            { p_action_id: actionId },
          );
          return json({
            actionId: undoAction.action_id,
            undoneActionId: actionId,
            configuration: undoAction,
          }, 200, { "Cache-Control": "no-store" });
        }

        const actor = await callAdminRpc(env, authorization, "get_my_discord_actor", {});
        if (!actor.is_admin) throw new AdminEditError("Admin access required.", 403);

        const target = await callAdminRpc(
          env,
          authorization,
          "get_tournament_result_action_for_undo",
          { p_action_id: actionId },
        );
        if (!target.sheet_id || !Array.isArray(target.editable_ranges) || !Array.isArray(target.changes)) {
          throw new AdminEditError("Tournament undo authorization is incomplete.", 502);
        }

        const accessToken = await getGoogleAccessToken(env);
        const undoAction = await callWorkerRpc(
          env,
          actor.actor_user_id,
          "create_tournament_result_action_log",
          {
            p_event_key: target.event_key,
            p_action_type: "undo",
            p_changes: null,
            p_target_action_id: actionId,
          },
        );

        let writeData;
        let updates;
        try {
          const ranges = target.changes.map((change) => String(change?.range || ""));
          const currentValues = await getGoogleRangeValues(accessToken, target.sheet_id, ranges);
          const hasConflict = target.changes.some((change, index) => (
            !rangeValuesMatch(currentValues[index], change?.after)
          ));
          if (hasConflict) {
            throw new AdminEditError(
              "This edit cannot be undone because one or more Sheet cells have changed since it was saved.",
              409,
            );
          }
          updates = updatesFromAuditChanges(undoAction.changes, target.editable_ranges);
          writeData = await writeGoogleUpdates(accessToken, target.sheet_id, updates);
        } catch (error) {
          await completeActionLog(
            env,
            actor.actor_user_id,
            undoAction.action_id,
            false,
            error instanceof Error ? error.message : "Tournament result undo failed.",
          ).catch(() => null);
          throw error;
        }

        try {
          await completeActionLog(env, actor.actor_user_id, undoAction.action_id, true);
        } catch {
          throw new AdminEditError(
            "Sheet values were restored, but the undo log could not be finalized. Do not retry this undo.",
            502,
          );
        }

        return json({
          actionId: undoAction.action_id,
          undoneActionId: actionId,
          updatedRanges: updates.map((update) => update.range),
          totalUpdatedCells: writeData?.totalUpdatedCells || 0,
        }, 200, { "Cache-Control": "no-store" });
      } catch (error) {
        if (error instanceof AdminEditError) {
          return json({ error: error.message }, error.status, { "Cache-Control": "no-store" });
        }
        return json({ error: "Tournament action log request failed." }, 502, { "Cache-Control": "no-store" });
      }
    }

    // =========================
    // YouTube Resolve (handle/url -> channelId)
    // GET /yt/resolve?input=<url-or-handle-or-UC>
    // =========================
    if (url.pathname === "/yt/resolve" && request.method === "GET") {
      const inputRaw = (url.searchParams.get("input") || "").trim();
      if (!inputRaw) return json({ error: "Missing input" }, 400);

      const cacheKey = normalizeResolveKey(inputRaw);

      // 0) KV cache hit
      const cached = await kvGetResolved(cacheKey);
      if (cached) {
        return json({ channelId: cached, source: "kv" }, 200, {
          "Cache-Control": "public, max-age=300",
        });
      }

      // 1) Direct UC id
      if (isUc(inputRaw)) {
        await kvPutResolved(cacheKey, inputRaw);
        return json({ channelId: inputRaw, source: "direct" }, 200, {
          "Cache-Control": "public, max-age=86400",
        });
      }

      // Normalize to URL when possible
      let inputUrl = null;
      try {
        const maybeUrl = inputRaw.startsWith("@")
          ? `https://www.youtube.com/${inputRaw}`
          : inputRaw;
        if (/^https?:\/\//i.test(maybeUrl)) inputUrl = new URL(maybeUrl);
      } catch {
        inputUrl = null;
      }

      // 2) /channel/UC...
      if (inputUrl && ytHostOk(inputUrl.hostname)) {
        const parts = inputUrl.pathname.split("/").filter(Boolean);
        if (parts[0] === "channel" && isUc(parts[1])) {
          await kvPutResolved(cacheKey, parts[1]);
          return json({ channelId: parts[1], source: "url-channel" }, 200, {
            "Cache-Control": "public, max-age=86400",
          });
        }
      }

      // Detect handle and/or legacy username
      let handleWithAt = null;    // "@ludwig"
      let legacyUsername = null;  // /user/<name>

      if (inputUrl && ytHostOk(inputUrl.hostname)) {
        const parts = inputUrl.pathname.split("/").filter(Boolean);
        if (parts[0]?.startsWith("@")) handleWithAt = parts[0];
        if (parts[0] === "user" && parts[1]) legacyUsername = parts[1];
      } else if (inputRaw.startsWith("@")) {
        handleWithAt = inputRaw;
      }

      // 3) legacy username via channels.list(forUsername)
      if (legacyUsername) {
        if (!env.YOUTUBE_API_KEY) {
          return json({ error: "Missing YOUTUBE_API_KEY in worker env" }, 500);
        }

        const apiUrl =
          "https://www.googleapis.com/youtube/v3/channels" +
          `?part=id&forUsername=${encodeURIComponent(legacyUsername)}` +
          `&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;

        const res = await fetch(apiUrl);
        const data = await res.json().catch(() => null);

        if (data?.items?.[0]?.id && isUc(data.items[0].id)) {
          const cid = data.items[0].id;
          await kvPutResolved(cacheKey, cid);
          return json({ channelId: cid, source: "forUsername" }, 200, {
            "Cache-Control": "public, max-age=86400",
          });
        }

        if (isQuotaExceededError(data)) {
          return json({ channelId: null, source: "quotaExceeded" }, 200);
        }
      }

      // 4) Handle resolution: oEmbed first (NO Data API quota)
      if (handleWithAt) {
        const handleUrl = `https://www.youtube.com/${handleWithAt}`;
        const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(handleUrl)}`;

        // call via our own proxy to avoid CORS + keep consistent
        const proxied = new URL(url.origin + "/proxy");
        proxied.searchParams.set("url", oembedUrl);

        try {
          const oRes = await fetch(proxied.toString());
          const o = await oRes.json().catch(() => null);
          const authorUrl = o?.author_url || "";

          // author_url is often https://www.youtube.com/channel/UC...
          try {
            const au = new URL(authorUrl);
            const parts = au.pathname.split("/").filter(Boolean);
            if (parts[0] === "channel" && isUc(parts[1])) {
              await kvPutResolved(cacheKey, parts[1]);
              // also store the raw handle key explicitly for future lookups
              await kvPutResolved(`handle:${handleWithAt.toLowerCase()}`, parts[1]);
              return json({ channelId: parts[1], source: "oembed" }, 200, {
                "Cache-Control": "public, max-age=86400",
              });
            }
          } catch {
            // ignore
          }
        } catch {
          // ignore, fall through to Data API search
        }

        // 5) Data API search fallback (quota)
        if (!env.YOUTUBE_API_KEY) {
          return json({ error: "Missing YOUTUBE_API_KEY in worker env" }, 500);
        }

        const searchUrl =
          "https://www.googleapis.com/youtube/v3/search" +
          `?part=snippet&type=channel&maxResults=5` +
          `&q=${encodeURIComponent(handleWithAt)}` +
          `&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;

        const sRes = await fetch(searchUrl);
        const sdata = await sRes.json().catch(() => null);

        if (isQuotaExceededError(sdata)) {
          // don’t hard-fail — just report it
          return json({ channelId: null, source: "quotaExceeded" }, 200);
        }

        const candidateIds = (sdata?.items || [])
          .map((it) => it?.id?.channelId) // ✅ correct field
          .filter((x) => isUc(x));

        if (candidateIds.length) {
          const cid = candidateIds[0];
          await kvPutResolved(cacheKey, cid);
          await kvPutResolved(`handle:${handleWithAt.toLowerCase()}`, cid);
          return json({ channelId: cid, source: "search-top" }, 200, {
            "Cache-Control": "public, max-age=3600",
          });
        }
      }

      // 6) Last resort: HTML scrape via /proxy (best-effort)
      try {
        if (!inputUrl) {
          return json({ channelId: null, source: "no-parse" }, 200);
        }
        if (!ytHostOk(inputUrl.hostname)) {
          return json({ error: "Not a YouTube URL/handle" }, 400);
        }

        const proxied = new URL(url.origin + "/proxy");
        proxied.searchParams.set("url", inputUrl.toString());

        const htmlRes = await fetch(proxied.toString());
        const html = await htmlRes.text();
        const channelId = extractChannelIdFromHtml(html);

        if (isUc(channelId)) {
          await kvPutResolved(cacheKey, channelId);
        }

        return json(
          { channelId: channelId || null, source: channelId ? "html" : "html-none" },
          200,
          { "Cache-Control": "public, max-age=3600" }
        );
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // =========================
    // YouTube: Channel metadata
    // GET /yt/channel?channelId=UC...
    // =========================
    if (url.pathname === "/yt/channel" && request.method === "GET") {
      const channelId = url.searchParams.get("channelId");
      if (!channelId || !isUc(channelId)) {
        return json({ error: "Missing or invalid channelId" }, 400);
      }

      if (!env.YOUTUBE_API_KEY) {
        return json({ error: "Missing YOUTUBE_API_KEY in worker env" }, 500);
      }

      const apiUrl =
        "https://www.googleapis.com/youtube/v3/channels" +
        `?part=snippet,brandingSettings,statistics&id=${encodeURIComponent(channelId)}` +
        `&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;

      try {
        const res = await fetch(apiUrl);
        const data = await res.json();

        const item = data?.items?.[0];
        if (!item) return json({ error: "Channel not found", data }, 404);

        const snippet = item.snippet || {};
        const branding = item.brandingSettings || {};
        const stats = item.statistics || {};

        const avatar =
          snippet?.thumbnails?.high?.url ||
          snippet?.thumbnails?.medium?.url ||
          snippet?.thumbnails?.default?.url ||
          "";

        const banner = branding?.image?.bannerExternalUrl || "";

        const out = {
          id: item.id,
          title: snippet.title || "",
          avatar,
          banner,
          subscribers: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount || 0),
          customUrl: snippet.customUrl || "",
          publishedAt: snippet.publishedAt || "",
        };

        return json(out, 200, { "Cache-Control": "public, max-age=900" });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // =========================
    // YouTube: Video stats
    // GET /yt/videos?ids=...
    // =========================
    if (url.pathname === "/yt/videos" && request.method === "GET") {
      const idsRaw = url.searchParams.get("ids") || "";
      const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);

      if (!ids.length) return json({ error: "Missing ids" }, 400);
      if (ids.length > 50) return json({ error: "Too many ids (max 50)" }, 400);

      const invalid = ids.find((id) => !/^[a-zA-Z0-9_-]{6,20}$/.test(id));
      if (invalid) return json({ error: `Invalid video id: ${invalid}` }, 400);

      if (!env.YOUTUBE_API_KEY) {
        return json({ error: "Missing YOUTUBE_API_KEY in worker env" }, 500);
      }

      const apiUrl =
        "https://www.googleapis.com/youtube/v3/videos" +
        `?part=statistics,liveStreamingDetails&id=${encodeURIComponent(ids.join(","))}` +
        `&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;

      try {
        const res = await fetch(apiUrl);
        const data = await res.json();
        return json(data, 200, { "Cache-Control": "public, max-age=300" });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // =========================
    // Proxy: GET /proxy?url=...
    // =========================
    if (url.pathname === "/proxy" && request.method === "GET") {
      const target = url.searchParams.get("url");
      if (!target) return json({ error: "Missing url param" }, 400);

      let targetUrl;
      try {
        targetUrl = new URL(target);
      } catch {
        return json({ error: "Invalid url param" }, 400);
      }

      if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
        return json({ error: "Protocol not allowed" }, 403);
      }

      const allowedHosts = new Set([
        // YouTube
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "i.ytimg.com",
        "ytimg.com",
        "yt3.ggpht.com",
        "yt3.googleusercontent.com",
        "lh3.googleusercontent.com",

        // Twitch
        "twitch.tv",
        "www.twitch.tv",
        "static-cdn.jtvnw.net",
        "clips.twitch.tv",
      ]);

      const host = targetUrl.hostname.toLowerCase();
      const bareHost = host.replace(/^www\./, "");

      const isAllowed =
        allowedHosts.has(host) ||
        allowedHosts.has(bareHost) ||
        bareHost.endsWith("ytimg.com") ||
        bareHost.endsWith("googleusercontent.com") ||
        bareHost.endsWith("ggpht.com") ||
        bareHost.endsWith("jtvnw.net");

      if (!isAllowed) return json({ error: "Host not allowed" }, 403);

      try {
        const upstream = await fetch(targetUrl.toString(), {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        const headers = new Headers(baseCorsHeaders);
        const contentType = upstream.headers.get("content-type");
        if (contentType) headers.set("Content-Type", contentType);
        headers.set("Cache-Control", "public, max-age=300");

        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // =========================
    // YouTube: Live now by channel
    // GET /yt/live?channelId=UC...
    // =========================
    if (url.pathname === "/yt/live" && request.method === "GET") {
      const channelId = url.searchParams.get("channelId");
      if (!channelId || !isUc(channelId)) {
        return json({ error: "Missing or invalid channelId" }, 400);
      }

      if (!env.YOUTUBE_API_KEY) {
        return json({ error: "Missing YOUTUBE_API_KEY in worker env" }, 500);
      }

      const apiUrl =
        "https://www.googleapis.com/youtube/v3/search" +
        `?part=snippet` +
        `&channelId=${encodeURIComponent(channelId)}` +
        `&eventType=live&type=video&maxResults=1` +
        `&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`;

      try {
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (isQuotaExceededError(data)) {
          return json({ live: false, source: "quotaExceeded" }, 200, { "Cache-Control": "public, max-age=15" });
        }

        const item = data?.items?.[0];
        if (!item) return json({ live: false }, 200, { "Cache-Control": "public, max-age=30" });

        const videoId = item?.id?.videoId;
        const title = item?.snippet?.title || "Live stream";
        const thumb =
          item?.snippet?.thumbnails?.high?.url ||
          item?.snippet?.thumbnails?.medium?.url ||
          item?.snippet?.thumbnails?.default?.url ||
          "";

        return json(
          { live: true, videoId, title, thumbnail: thumb },
          200,
          { "Cache-Control": "public, max-age=30" }
        );
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // =========================
    // Sheets: GET and POST support
    // =========================
    let sheetId = url.searchParams.get("sheetId");
    let range = url.searchParams.get("range");

    if (!sheetId || !range) {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          sheetId = sheetId || body?.sheetId;
          range = range || body?.range;
        } catch {}
      }
    }

    if (!sheetId || !range) {
      return json({ error: "Missing sheetId or range" }, 400);
    }

    if (!env.GOOGLE_API_KEY) {
      return json({ error: "Missing GOOGLE_API_KEY in worker env" }, 500);
    }

    const googleUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}` +
      `?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`;

    try {
      const res = await fetch(googleUrl);
      const data = await res.json();
      return json(data, 200, { "Cache-Control": "public, max-age=60" });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
