"use strict";

require("dotenv").config();

const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  DEFAULT_BASE_RATING,
  DEFAULT_PL_MAX_ITERATIONS,
  DEFAULT_PL_PRIOR_STRENGTH,
  DEFAULT_PL_RATING_SCALE,
  DEFAULT_PL_SHRINKAGE_MATCHES,
  DEFAULT_PL_TOLERANCE,
  replayPlackettLuceGpi,
} = require("./internal-ranked-core");

const CALCULATION_VERSION = "tournament-flat-pl-gpi-v1";
const defaultSupabaseUrl = "https://kwaprkwemtxizorpnrzq.supabase.co";
const workerUrl = "https://small-mud-2771.nextweekmedia.workers.dev/";
const superLeagueSheetId = "1BbT8t6erCVdx-Bdshv_hax9r9JSRzU1WygjWxW3vPkY";
const worldOpenSheetId = "1WcRVGmEpQkRDTwe8aDfQgxuDoapvLxAdSjnqg4PHgXM";
const lightningCupSheetId = "1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ";
const syntheticStartMs = Date.UTC(2026, 0, 1, 0, 0, 0);

const eventOrder = [
  { key: "super_league_s5", name: "Super League Season 5" },
  { key: "world_open_2026", name: "World Open" },
  { key: "lightning_cup_2026", name: "Lightning Cup" },
  { key: "super_league_s6", name: "Super League Season 6" },
];

const worldOpenRounds = [
  { key: "r1", label: "First Round", matchups: "C2:F33", matchSize: 32, showFlag: "F1:F1" },
  { key: "r2", label: "Second Round", matchups: "J2:M17", matchSize: 16, showFlag: "M1:M1" },
  { key: "r3", label: "Round of 32", matchups: "Q2:T17", matchSize: 16 },
  { key: "r4", label: "Round of 16", matchups: "X2:AA9", matchSize: 8 },
  { key: "r5", label: "Quarterfinals", matchups: "AE2:AH5", matchSize: 4 },
  { key: "r6", label: "Semi-Finals", matchups: "AL2:AO3", matchSize: 2 },
  { key: "r7", label: "Finals", matchups: "AS2:AV2", matchSize: 1 },
];

const lightningRoundOrder = ["R64", "R32", "R16", "R8", "R4", "Final"];

function usage() {
  console.log(`
Usage:
  node bot/tournament-gpi.js fetch [options]
  node bot/tournament-gpi.js replay [options]
  node bot/tournament-gpi.js sync [options]

Commands:
  fetch   Pull tournament 1v1 results and upsert cleaned matches.
  replay  Recalculate tournament GPI using flat-weighted Plackett-Luce.
  sync    Run fetch, then replay.

Options:
  --allow-unresolved       Skip matches whose players cannot be mapped to Discord IDs.
  --base-rating <number>   PL base rating. Default: ${DEFAULT_BASE_RATING}
  --rating-scale <number>  PL log-skill to rating scale. Default: ${DEFAULT_PL_RATING_SCALE.toFixed(6)}
  --pl-prior <number>      PL population-average prior strength. Default: ${DEFAULT_PL_PRIOR_STRENGTH}
  --pl-shrinkage-matches <number>
                           Raw match count for full PL reliability. Default: ${DEFAULT_PL_SHRINKAGE_MATCHES}
  --pl-iterations <number> Max PL fit iterations. Default: ${DEFAULT_PL_MAX_ITERATIONS}
  --pl-tolerance <number>  PL convergence tolerance. Default: ${DEFAULT_PL_TOLERANCE}

Environment:
  NSSGOLF_SUPABASE_URL or SUPABASE_URL
  NSSGOLF_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY
`);
}

function getArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function getNumberArg(name, fallback) {
  const rawValue = getArg(name, "");
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function decodeJwtPayload(tokenValue) {
  const parts = tokenValue.split(".");
  if (parts.length !== 3) return null;
  try {
    const normalizedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "="
    );
    return JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function assertSupabaseElevatedKey(keyValue) {
  const trimmedKey = String(keyValue || "").trim();
  if (trimmedKey.startsWith("sb_publishable_")) {
    throw new Error("NSSGOLF_SUPABASE_SERVICE_ROLE_KEY is a publishable key. Use a service-role key.");
  }
  if (trimmedKey.startsWith("sb_secret_")) return;
  const jwtPayload = decodeJwtPayload(trimmedKey);
  if (!jwtPayload || jwtPayload.role !== "service_role") {
    throw new Error("NSSGOLF_SUPABASE_SERVICE_ROLE_KEY must be a Supabase service_role key.");
  }
}

function createSupabaseServiceClient() {
  const supabaseUrl =
    process.env.NSSGOLF_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    defaultSupabaseUrl;
  const supabaseServiceRoleKey =
    process.env.NSSGOLF_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing NSSGOLF_SUPABASE_URL or NSSGOLF_SUPABASE_SERVICE_ROLE_KEY.");
  }

  assertSupabaseElevatedKey(supabaseServiceRoleKey);
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeValues(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.values)) return resp.values;
  if (Array.isArray(resp.data?.values)) return resp.data.values;
  if (Array.isArray(resp.result?.values)) return resp.result.values;
  return [];
}

async function fetchWorkerRange(sheetId, range) {
  const url = new URL(workerUrl);
  url.searchParams.set("sheetId", sheetId);
  url.searchParams.set("range", range);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Worker request failed (${response.status}) for ${range}. ${text}`.trim());
  }
  return normalizeValues(await response.json());
}

function parseGvizResponse(text) {
  const match = String(text || "").match(/google\.visualization\.Query\.setResponse\((.*)\);?\s*$/s);
  if (!match) throw new Error("Unable to parse Google Sheets response.");
  const payload = JSON.parse(match[1]);
  const rows = payload?.table?.rows ?? [];
  return rows.map((row) => (row.c ?? []).map((cell) => cell?.v ?? ""));
}

async function fetchGvizRange(sheetId, sheetName, a1) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  url.searchParams.set("sheet", sheetName);
  url.searchParams.set("range", a1);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google Sheets request failed (${response.status}) for ${sheetName}!${a1}. ${text}`.trim());
  }
  return parseGvizResponse(await response.text());
}

async function fetchSheetRange(sheetId, sheetName, a1) {
  const range = sheetName ? `'${sheetName}'!${a1}` : a1;
  try {
    return await fetchWorkerRange(sheetId, range);
  } catch {
    if (!sheetName) throw new Error(`Worker-only range failed and no sheet name was provided: ${range}`);
    return fetchGvizRange(sheetId, sheetName, a1);
  }
}

function normalizeName(value) {
  return String(value || "").trim();
}

function normalizeAliasKey(value) {
  return normalizeName(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeDiscordId(value) {
  const raw = normalizeName(value);
  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  const clean = mentionMatch ? mentionMatch[1] : raw.replace(/[^\d]/g, "");
  return /^[0-9]+$/.test(clean) ? clean : "";
}

function toNumber(value) {
  const text = normalizeName(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function chunkRows(rows, size = 500) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function roundRating(value) {
  return Number(value.toFixed(4));
}

function roundPercentage(value) {
  return Number(value.toFixed(6));
}

function roundMetric(value) {
  return Number(value.toFixed(8));
}

function createEmptyIdentityMap() {
  return {
    exact: new Map(),
    key: new Map(),
    ambiguousKeys: new Set(),
  };
}

function addIdentity(identityMap, name, discordUserId, source) {
  const cleanName = normalizeName(name);
  const cleanDiscordId = normalizeDiscordId(discordUserId);
  if (!cleanName || !cleanDiscordId) return;

  identityMap.exact.set(cleanName, { discordUserId: cleanDiscordId, displayName: cleanName, source });
  const aliasKey = normalizeAliasKey(cleanName);
  const previous = identityMap.key.get(aliasKey);
  if (previous && previous.discordUserId !== cleanDiscordId) {
    identityMap.ambiguousKeys.add(aliasKey);
    return;
  }
  identityMap.key.set(aliasKey, { discordUserId: cleanDiscordId, displayName: cleanName, source });
}

function addTwoColumnIdentity(identityMap, row, source) {
  const first = row?.[0];
  const second = row?.[1];
  const firstId = normalizeDiscordId(first);
  const secondId = normalizeDiscordId(second);
  if (firstId && !secondId) {
    addIdentity(identityMap, second, first, source);
  } else if (secondId && !firstId) {
    addIdentity(identityMap, first, second, source);
  }
}

function resolveIdentity(identityMap, name) {
  const cleanName = normalizeName(name);
  if (!cleanName) return null;
  const exact = identityMap.exact.get(cleanName);
  if (exact) return exact;
  const aliasKey = normalizeAliasKey(cleanName);
  if (!aliasKey || identityMap.ambiguousKeys.has(aliasKey)) return null;
  return identityMap.key.get(aliasKey) || null;
}

async function loadSupabaseIdentities(supabase, identityMap) {
  const [aliasesResult, membersResult] = await Promise.all([
    supabase
      .from("player_league_aliases")
      .select("league_player_name,discord_user_id,active")
      .eq("active", true),
    supabase
      .from("discord_guild_members")
      .select("discord_user_id,username,global_name,display_name,nickname,is_current_member,is_bot")
      .eq("is_current_member", true)
      .eq("is_bot", false),
  ]);

  if (!aliasesResult.error) {
    for (const row of aliasesResult.data || []) {
      addIdentity(identityMap, row.league_player_name, row.discord_user_id, "player_league_aliases");
    }
  } else {
    console.warn(`Could not load player_league_aliases: ${aliasesResult.error.message}`);
  }

  if (membersResult.error) {
    console.warn(`Could not load discord_guild_members: ${membersResult.error.message}`);
    return;
  }

  for (const row of membersResult.data || []) {
    for (const name of [row.display_name, row.nickname, row.global_name, row.username]) {
      addIdentity(identityMap, name, row.discord_user_id, "discord_guild_members");
    }
  }
}

async function loadSuperLeagueIdentitySheet(identityMap) {
  const rows = await fetchSheetRange(superLeagueSheetId, "Discord IDs", "A:B");
  for (const row of rows || []) {
    addTwoColumnIdentity(identityMap, row, "super_league_discord_ids");
  }
}

async function loadLightningIdentitySheet(identityMap) {
  const rows = await fetchSheetRange(lightningCupSheetId, "Seeds", "C:E");
  for (const row of rows || []) {
    const name = normalizeName(row?.[0]);
    if (name.toLowerCase() === "name") continue;
    addIdentity(identityMap, name, row?.[2], "lightning_cup_seeds");
  }
}

async function loadWorldOpenIdentitySheet(identityMap) {
  const rows = await fetchSheetRange(worldOpenSheetId, "Discord IDs", "A:B");
  for (const row of rows || []) {
    addTwoColumnIdentity(identityMap, row, "world_open_discord_ids");
  }
}

function winnerFromLowerScore(scoreA, scoreB) {
  const left = toNumber(scoreA);
  const right = toNumber(scoreB);
  if (left == null || right == null || left === right) return "";
  return left < right ? "a" : "b";
}

function winnerFromHigherScore(scoreA, scoreB) {
  const left = toNumber(scoreA);
  const right = toNumber(scoreB);
  if (left == null || right == null || left === right) return "";
  return left > right ? "a" : "b";
}

function rawMatchFromSides({ timestampMs, playerA, playerB, winnerSide }) {
  return {
    timestamp: timestampMs,
    versus: "1v1",
    team_sizes: [1, 1],
    results: [
      {
        place: winnerSide === "a" ? 1 : 2,
        players: [{ player_id: playerA.discordUserId, display_name: playerA.displayName }],
      },
      {
        place: winnerSide === "b" ? 1 : 2,
        players: [{ player_id: playerB.discordUserId, display_name: playerB.displayName }],
      },
    ].sort((left, right) => left.place - right.place),
  };
}

function tournamentMatchHash(match) {
  return hashText(stableJson({
    event_key: match.event_key,
    source_match_id: match.source_match_id,
    player_a: match.player_a_discord_user_id,
    player_b: match.player_b_discord_user_id,
    winner: match.winner_discord_user_id,
    match_order: match.match_order,
  }));
}

function buildTournamentMatch({
  event,
  eventIndex,
  localOrder,
  sourceMatchId,
  roundLabel,
  playerAName,
  playerBName,
  scoreA = "",
  scoreB = "",
  winnerSide,
  identityMap,
  rawSource,
}) {
  const playerAIdentity = resolveIdentity(identityMap, playerAName);
  const playerBIdentity = resolveIdentity(identityMap, playerBName);
  const missing = [];
  if (!playerAIdentity) missing.push(playerAName);
  if (!playerBIdentity) missing.push(playerBName);
  if (missing.length || !winnerSide) {
    return {
      row: null,
      warning: {
        event_key: event.key,
        source_match_id: sourceMatchId,
        players: [playerAName, playerBName],
        reason: missing.length ? `unresolved player identity: ${missing.join(", ")}` : "missing winner",
      },
    };
  }

  const timestampMs = syntheticStartMs + eventIndex * 1_000_000 + localOrder * 1000;
  const playerA = { discordUserId: playerAIdentity.discordUserId, displayName: playerAName };
  const playerB = { discordUserId: playerBIdentity.discordUserId, displayName: playerBName };
  const winnerDiscordUserId =
    winnerSide === "a" ? playerAIdentity.discordUserId : playerBIdentity.discordUserId;
  const rawMatch = rawMatchFromSides({ timestampMs, playerA, playerB, winnerSide });
  const row = {
    match_hash: "",
    event_key: event.key,
    event_name: event.name,
    event_order: eventIndex + 1,
    match_order: localOrder,
    source_match_id: String(sourceMatchId),
    round_label: roundLabel,
    timestamp_ms: timestampMs,
    played_at: new Date(timestampMs).toISOString(),
    player_a_discord_user_id: playerAIdentity.discordUserId,
    player_a_name: playerAName,
    player_a_score: normalizeName(scoreA),
    player_b_discord_user_id: playerBIdentity.discordUserId,
    player_b_name: playerBName,
    player_b_score: normalizeName(scoreB),
    winner_discord_user_id: winnerDiscordUserId,
    raw_match: rawMatch,
    raw_source: rawSource,
  };
  row.match_hash = tournamentMatchHash(row);
  return { row, warning: null };
}

function parseSuperLeagueScheduleRows(rows, event, eventIndex, identityMap, startOrder) {
  const matches = [];
  const warnings = [];
  let localOrder = startOrder;

  for (const row of rows || []) {
    const week = normalizeName(row?.[0]);
    const division = normalizeName(row?.[1]);
    const playerAName = normalizeName(row?.[3]);
    const playerBName = normalizeName(row?.[12]);
    const resultA = normalizeName(row?.[10]).toUpperCase();
    const resultB = normalizeName(row?.[19]).toUpperCase();
    if (!week || !division || !playerAName || !playerBName) continue;
    if (!((resultA === "W" && resultB === "L") || (resultA === "L" && resultB === "W"))) continue;
    localOrder += 1;
    const { row: matchRow, warning } = buildTournamentMatch({
      event,
      eventIndex,
      localOrder,
      sourceMatchId: `week-${week}-${division}-${localOrder}`,
      roundLabel: `Week ${week} ${division}`,
      playerAName,
      playerBName,
      scoreA: row?.[7],
      scoreB: row?.[16],
      winnerSide: resultA === "W" ? "a" : "b",
      identityMap,
      rawSource: { type: "super_league_schedule", row },
    });
    if (matchRow) matches.push(matchRow);
    if (warning) warnings.push(warning);
  }

  return { matches, warnings, nextOrder: localOrder };
}

function parseSuperLeaguePlayoffRows(rows, event, eventIndex, identityMap, startOrder) {
  const labels = [
    "Division 1 Semi-Final",
    "Division 1 Semi-Final",
    "Division 1 Championship",
    "Division 1 3rd Place",
    "Division 1/2 Playoff",
    "Division 2/3 Playoff",
  ];
  const matches = [];
  const warnings = [];
  let localOrder = startOrder;

  (rows || []).forEach((row = [], index) => {
    const playerAName = normalizeName(row?.[3]);
    const playerBName = normalizeName(row?.[12]);
    const resultA = normalizeName(row?.[10]).toUpperCase();
    const resultB = normalizeName(row?.[19]).toUpperCase();
    if (!playerAName || !playerBName) return;
    if (!((resultA === "W" && resultB === "L") || (resultA === "L" && resultB === "W"))) return;
    localOrder += 1;
    const { row: matchRow, warning } = buildTournamentMatch({
      event,
      eventIndex,
      localOrder,
      sourceMatchId: `playoff-${index + 1}`,
      roundLabel: labels[index] || `Playoff ${index + 1}`,
      playerAName,
      playerBName,
      scoreA: row?.[7],
      scoreB: row?.[16],
      winnerSide: resultA === "W" ? "a" : "b",
      identityMap,
      rawSource: { type: "super_league_playoff", row },
    });
    if (matchRow) matches.push(matchRow);
    if (warning) warnings.push(warning);
  });

  return { matches, warnings, nextOrder: localOrder };
}

async function fetchSuperLeagueEvent(seasonNumber, event, eventIndex, identityMap) {
  const sheetName = `Season ${seasonNumber}`;
  const [scheduleRows, playoffRows] = await Promise.all([
    fetchSheetRange(superLeagueSheetId, sheetName, "I2:AB85"),
    fetchSheetRange(superLeagueSheetId, sheetName, "I87:AB92"),
  ]);
  const schedule = parseSuperLeagueScheduleRows(scheduleRows, event, eventIndex, identityMap, 0);
  const playoffs = parseSuperLeaguePlayoffRows(
    playoffRows,
    event,
    eventIndex,
    identityMap,
    schedule.nextOrder
  );
  return {
    matches: [...schedule.matches, ...playoffs.matches],
    warnings: [...schedule.warnings, ...playoffs.warnings],
  };
}

async function fetchWorldOpenEvent(event, eventIndex, identityMap) {
  const matches = [];
  const warnings = [];
  let localOrder = 0;

  for (const round of worldOpenRounds) {
    const [matchupRows, flagRows] = await Promise.all([
      fetchSheetRange(worldOpenSheetId, "2026 Results", round.matchups),
      round.showFlag
        ? fetchSheetRange(worldOpenSheetId, "2026 Results", round.showFlag)
        : Promise.resolve([["yes"]]),
    ]);
    const allowMatchups = normalizeName(flagRows?.[0]?.[0]).toLowerCase() === "yes";
    if (!allowMatchups) continue;

    for (let index = 0; index < round.matchSize; index += 1) {
      const row = matchupRows?.[index] || [];
      const playerAName = normalizeName(row?.[0]);
      const scoreA = row?.[1];
      const playerBName = normalizeName(row?.[2]);
      const scoreB = row?.[3];
      if (!playerAName || !playerBName) continue;
      if (playerAName.toLowerCase() === "bye" || playerBName.toLowerCase() === "bye") continue;
      localOrder += 1;
      const { row: matchRow, warning } = buildTournamentMatch({
        event,
        eventIndex,
        localOrder,
        sourceMatchId: `${round.key}-${index + 1}`,
        roundLabel: round.label,
        playerAName,
        playerBName,
        scoreA,
        scoreB,
        winnerSide: winnerFromHigherScore(scoreA, scoreB),
        identityMap,
        rawSource: { type: "world_open_matchup", row },
      });
      if (matchRow) matches.push(matchRow);
      if (warning) warnings.push(warning);
    }
  }

  return { matches, warnings };
}

function buildLightningMatchesFromRows(rows) {
  return (rows || [])
    .slice(1)
    .map((row) => ({
      id: Number(row?.[0]),
      round: normalizeName(row?.[1]),
      region: Number(row?.[2]) || 0,
      top: {
        seed: Number(row?.[3]) || null,
        name: normalizeName(row?.[4]),
        score: normalizeName(row?.[5]),
      },
      bottom: {
        seed: Number(row?.[6]) || null,
        name: normalizeName(row?.[7]),
        score: normalizeName(row?.[8]),
      },
      winner: normalizeName(row?.[9]),
      source: row,
    }))
    .filter((match) => Number.isFinite(match.id) && lightningRoundOrder.includes(match.round));
}

async function fetchLightningCupEvent(event, eventIndex, identityMap) {
  const rows = await fetchSheetRange(lightningCupSheetId, "Bracket", "A:T");
  const sourceMatches = buildLightningMatchesFromRows(rows).sort((left, right) => {
    const leftRound = lightningRoundOrder.indexOf(left.round);
    const rightRound = lightningRoundOrder.indexOf(right.round);
    if (leftRound !== rightRound) return leftRound - rightRound;
    return left.id - right.id;
  });
  const matches = [];
  const warnings = [];
  let localOrder = 0;

  for (const sourceMatch of sourceMatches) {
    const playerAName = sourceMatch.top.name;
    const playerBName = sourceMatch.bottom.name;
    const winnerName = sourceMatch.winner;
    if (!playerAName || !playerBName || !winnerName) continue;
    localOrder += 1;
    const winnerSide =
      winnerName.toLowerCase() === playerAName.toLowerCase()
        ? "a"
        : winnerName.toLowerCase() === playerBName.toLowerCase()
          ? "b"
          : winnerFromLowerScore(sourceMatch.top.score, sourceMatch.bottom.score);
    const { row: matchRow, warning } = buildTournamentMatch({
      event,
      eventIndex,
      localOrder,
      sourceMatchId: String(sourceMatch.id),
      roundLabel: sourceMatch.round,
      playerAName,
      playerBName,
      scoreA: sourceMatch.top.score,
      scoreB: sourceMatch.bottom.score,
      winnerSide,
      identityMap,
      rawSource: { type: "lightning_cup_bracket", match: sourceMatch },
    });
    if (matchRow) matches.push(matchRow);
    if (warning) warnings.push(warning);
  }

  return { matches, warnings };
}

async function collectTournamentMatches(supabase) {
  const identityMap = createEmptyIdentityMap();
  await Promise.all([
    loadSupabaseIdentities(supabase, identityMap),
    loadSuperLeagueIdentitySheet(identityMap),
    loadWorldOpenIdentitySheet(identityMap),
    loadLightningIdentitySheet(identityMap),
  ]);

  const results = [];
  for (let eventIndex = 0; eventIndex < eventOrder.length; eventIndex += 1) {
    const event = eventOrder[eventIndex];
    console.log(`Fetching ${event.name}`);
    if (event.key === "super_league_s5") {
      results.push(await fetchSuperLeagueEvent(5, event, eventIndex, identityMap));
    } else if (event.key === "world_open_2026") {
      results.push(await fetchWorldOpenEvent(event, eventIndex, identityMap));
    } else if (event.key === "lightning_cup_2026") {
      results.push(await fetchLightningCupEvent(event, eventIndex, identityMap));
    } else if (event.key === "super_league_s6") {
      results.push(await fetchSuperLeagueEvent(6, event, eventIndex, identityMap));
    }
  }

  return {
    matches: results.flatMap((result) => result.matches),
    warnings: results.flatMap((result) => result.warnings),
  };
}

async function upsertTournamentMatches(supabase, rows) {
  for (const event of eventOrder) {
    const { error } = await supabase
      .from("internal_tournament_matches")
      .delete()
      .eq("event_key", event.key);
    if (error) throw new Error(`${event.name}: stale match delete failed: ${error.message}`);
  }

  for (const chunk of chunkRows(rows, 250)) {
    const { error } = await supabase
      .from("internal_tournament_matches")
      .upsert(chunk, { onConflict: "match_hash" });
    if (error) throw new Error(`Tournament match upsert failed: ${error.message}`);
  }
}

async function fetchAndUpsert(options) {
  const supabase = createSupabaseServiceClient();
  const { matches, warnings } = await collectTournamentMatches(supabase);

  for (const warning of warnings) {
    console.warn(`${warning.event_key} ${warning.source_match_id}: ${warning.reason}`);
  }
  if (warnings.length && !options.allowUnresolved) {
    throw new Error(
      `Tournament fetch found ${warnings.length} unresolved or incomplete matchups. Add aliases/Discord IDs or rerun with --allow-unresolved to skip them.`
    );
  }

  await upsertTournamentMatches(supabase, matches);
  console.log(`Tournament fetch complete: upserted ${matches.length} valid 1v1 matches; warnings ${warnings.length}.`);
  return matches;
}

async function loadStoredTournamentMatches(supabase) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("internal_tournament_matches")
      .select("match_hash,event_key,event_name,event_order,match_order,timestamp_ms,played_at,raw_match")
      .order("event_order", { ascending: true })
      .order("match_order", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Stored tournament match lookup failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows.map((row) => ({
    match_hash: row.match_hash,
    season: row.event_order,
    timestamp_ms: row.timestamp_ms,
    played_at: row.played_at,
    raw_match: row.raw_match,
    event_key: row.event_key,
    event_name: row.event_name,
  }));
}

async function insertRows(supabase, tableName, rows, context) {
  for (const chunk of chunkRows(rows, 500)) {
    const { error } = await supabase.from(tableName).insert(chunk);
    if (error) throw new Error(`${context}: ${error.message}`);
  }
}

async function replayStoredTournamentMatches(options) {
  const supabase = createSupabaseServiceClient();
  const storedMatches = await loadStoredTournamentMatches(supabase);
  if (!storedMatches.length) {
    throw new Error("No stored tournament matches found. Run tournament-gpi fetch first.");
  }

  const replay = replayPlackettLuceGpi(storedMatches, {
    baseRating: options.baseRating,
    ratingScale: options.ratingScale,
    priorStrength: options.plPrior,
    shrinkageMatches: options.plShrinkageMatches,
    maxIterations: options.plIterations,
    tolerance: options.plTolerance,
    recencyMode: "none",
    participantWeightScale: 0,
    maxParticipantWeight: 1,
  });

  const { data: runRow, error: runError } = await supabase
    .from("internal_tournament_gpi_runs")
    .insert({
      calculation_version: CALCULATION_VERSION,
      model: "flat_pl",
      base_rating: options.baseRating,
      rating_scale: options.ratingScale,
      event_start: eventOrder[0].key,
      event_end: eventOrder[eventOrder.length - 1].key,
      match_count: replay.matchCount,
      player_count: replay.finalRatings.length,
      latest_match_at: replay.latestTimestampMs
        ? new Date(replay.latestTimestampMs).toISOString()
        : null,
      config: {
        model: "flat_pl",
        event_order: eventOrder,
        rating_formula: "flat-weighted full-history Plackett-Luce tournament rating",
        recency_weighting: { mode: "none", basis: "flat_all_tournament_history" },
        participant_weighting: { mode: "none", reason: "solo_1v1_tournament_matches_only" },
        prior_strength: options.plPrior,
        shrinkage_matches: options.plShrinkageMatches,
        rating_scale: options.ratingScale,
        convergence: {
          max_iterations: options.plIterations,
          tolerance: options.plTolerance,
          iterations: replay.iterations,
          converged: replay.converged,
          max_change: replay.maxChange,
        },
      },
    })
    .select("id")
    .single();
  if (runError) throw new Error(`Tournament GPI run insert failed: ${runError.message}`);
  const runId = runRow.id;

  const ratingRows = replay.finalRatings.map((row) => ({
    run_id: runId,
    discord_user_id: row.discord_user_id,
    display_name: row.display_name,
    rating: roundRating(row.rating),
    raw_rating: roundRating(row.raw_rating),
    ability: roundMetric(row.ability),
    skill_log: roundMetric(row.skill_log),
    reliability: roundPercentage(row.reliability),
    matches_played: row.matches_played,
    weighted_matches: roundMetric(row.weighted_matches),
    average_match_weight: roundPercentage(row.average_match_weight),
    pairwise_wins: row.pairwise_wins,
    pairwise_losses: row.pairwise_losses,
    pairwise_ties: row.pairwise_ties,
    pairwise_games: row.pairwise_games,
    first_place_finishes: row.first_place_finishes,
    outcome_win_percentage: roundPercentage(row.outcome_win_percentage),
    match_win_percentage: roundPercentage(row.match_win_percentage),
    placement_score_average: roundPercentage(row.placement_score_average),
    weighted_placement_score: roundPercentage(row.weighted_placement_score),
    first_played_at: row.first_played_at,
    last_played_at: row.last_played_at,
    rank: row.rank,
  }));

  await insertRows(
    supabase,
    "internal_tournament_gpi_ratings",
    ratingRows,
    "Final tournament GPI rating insert failed"
  );

  console.log(
    `Tournament GPI replay complete: run ${runId}, ${replay.matchCount} matches, ${ratingRows.length} players, ${replay.iterations} PL iterations, converged=${replay.converged}.`
  );
  console.log("Top 10:");
  for (const row of ratingRows.slice(0, 10)) {
    console.log(`${row.rank}. ${row.display_name || row.discord_user_id} (${row.discord_user_id}) ${row.rating}`);
  }
  return runId;
}

function parseOptions() {
  return {
    allowUnresolved: hasFlag("--allow-unresolved"),
    baseRating: getNumberArg("--base-rating", DEFAULT_BASE_RATING),
    ratingScale: getNumberArg("--rating-scale", DEFAULT_PL_RATING_SCALE),
    plPrior: getNumberArg("--pl-prior", DEFAULT_PL_PRIOR_STRENGTH),
    plShrinkageMatches: getNumberArg("--pl-shrinkage-matches", DEFAULT_PL_SHRINKAGE_MATCHES),
    plIterations: getNumberArg("--pl-iterations", DEFAULT_PL_MAX_ITERATIONS),
    plTolerance: getNumberArg("--pl-tolerance", DEFAULT_PL_TOLERANCE),
  };
}

async function main() {
  const command = process.argv[2] || "help";
  if (command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const options = parseOptions();
  if (command === "fetch") {
    await fetchAndUpsert(options);
  } else if (command === "replay") {
    await replayStoredTournamentMatches(options);
  } else if (command === "sync") {
    await fetchAndUpsert(options);
    await replayStoredTournamentMatches(options);
  } else {
    usage();
    throw new Error(`Unknown command: ${command}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildLightningMatchesFromRows,
  normalizeAliasKey,
  normalizeDiscordId,
  parseSuperLeagueScheduleRows,
  winnerFromHigherScore,
  winnerFromLowerScore,
};
