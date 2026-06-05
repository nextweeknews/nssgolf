require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const defaultWorkerUrl = "https://small-mud-2771.nextweekmedia.workers.dev/";
const defaultSheetId = "1qIM0HKhx9Y-3eCJCFzBqrbATwiPrK3C1ynATwZzRC1o";
const defaultLeagueKey = "shotgun_pro_league";
const outputDir = path.join(__dirname, "output");
const defaultReviewPath = path.join(outputDir, "proleague-alias-review.csv");

const RANGE_PLAYER_STANDINGS_A1 = "AE4:AH101";
const LOOKUP_RANGE_A1 = "A3:S250";
const CH_ROSTER = "B3:H23";
const MAX_SEASON_TO_CHECK = Number(process.env.PROLEAGUE_MAX_SEASON_TO_CHECK || 7);

const LEGACY_SEASON_CONFIG = {
  5: { sheet: "Season 5", rosters: "A3:S63", teamRank: "U4:X15" },
  4: { sheet: "Season 4", rosters: "A3:S53", teamRank: "U4:X13" },
  3: { sheet: "Season 3", rosters: "A3:S48", teamRank: "U4:X12" },
  2: { sheet: "Season 2", rosters: "A3:S43", teamRank: "U4:X11" },
  1: { sheet: "Season 1", rosters: "A3:S38", teamRank: "U4:X10" },
};
const STAGED_FORMAT = { rosters: "A3:S63", teamRank: "U4:X15" };

const csvHeaders = [
  "league_key",
  "league_player_name",
  "league_player_key",
  "occurrences",
  "periods",
  "sources",
  "suggested_discord_user_id",
  "suggested_display_name",
  "suggested_username",
  "suggested_nickname",
  "suggested_global_name",
  "match_score",
  "matched_field",
  "matched_value",
  "approval",
  "approved_discord_user_id",
  "notes",
  "candidates_json",
];

function usage() {
  console.log(`
Usage:
  node bot/proleague-player-aliases.js suggest [options]
  node bot/proleague-player-aliases.js import [options]

Commands:
  suggest   Scan the Shotgun Pro League Google Sheet, fuzzy-match names against
            discord_guild_members, and write a review CSV.
  import    Upsert CSV rows whose approval column is approve/approved/yes/y.

Options:
  --out <path>              Review CSV output path for suggest.
  --file <path>             Review CSV input path for import.
  --league-key <key>        League key. Default: ${defaultLeagueKey}
  --min-score <number>      Lowest candidate score to keep. Default: 0.58
  --auto-threshold <number> Score required to prefill approval=approve. Default: 0.92
  --min-gap <number>        Required gap between best and second candidate. Default: 0.08
  --max-candidates <number> Candidate count to include in candidates_json. Default: 5

Environment:
  DISCORD_GUILD_ID
  NSSGOLF_SUPABASE_URL or SUPABASE_URL
  NSSGOLF_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY
  PROLEAGUE_SHEET_ID optional
  PROLEAGUE_SHEETS_WORKER_URL optional
  PROLEAGUE_MAX_SEASON_TO_CHECK optional
`);
}

function getArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

function getNumberArg(name, fallback) {
  const value = Number(getArg(name, ""));
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
    throw new Error(
      "NSSGOLF_SUPABASE_SERVICE_ROLE_KEY is a publishable key. Use a Supabase secret key (sb_secret_...) or legacy service_role JWT key."
    );
  }

  if (trimmedKey.startsWith("sb_secret_")) return;

  const jwtPayload = decodeJwtPayload(trimmedKey);
  if (!jwtPayload) {
    throw new Error(
      "NSSGOLF_SUPABASE_SERVICE_ROLE_KEY is not a recognized Supabase secret key or legacy service_role JWT key."
    );
  }

  if (jwtPayload.role !== "service_role") {
    throw new Error(
      `NSSGOLF_SUPABASE_SERVICE_ROLE_KEY uses the '${jwtPayload.role || "unknown"}' role. Use the legacy service_role JWT key, not the anon key.`
    );
  }
}

function createSupabaseClient() {
  const supabaseUrl = process.env.NSSGOLF_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceRoleKey =
    process.env.NSSGOLF_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!process.env.DISCORD_GUILD_ID) {
    throw new Error("Missing DISCORD_GUILD_ID. Add it to .env before running this workflow.");
  }
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing NSSGOLF_SUPABASE_URL or NSSGOLF_SUPABASE_SERVICE_ROLE_KEY. Add them to .env before running this workflow."
    );
  }

  assertSupabaseElevatedKey(supabaseServiceRoleKey);

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
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

async function fetchRange(range) {
  const workerUrl = process.env.PROLEAGUE_SHEETS_WORKER_URL || defaultWorkerUrl;
  const sheetId = process.env.PROLEAGUE_SHEET_ID || defaultSheetId;
  const payload = { sheetId, range };

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return normalizeValues(await response.json());
  } catch {
    // The public page falls back to GET, so keep this script behavior aligned.
  }

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

function rowHasAnyValue(row) {
  return Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== "");
}

function toNum(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function sheetNameForPeriod(season, stage) {
  const seasonNumber = Number(season);
  if (seasonNumber < 6) return `Season ${seasonNumber}`;
  if (stage === "championship") return `Season ${seasonNumber}, Championship`;
  return `Season ${seasonNumber}, Stage ${Number(stage)}`;
}

function getPeriodConfig(season, stage) {
  const seasonNumber = Number(season);
  if (seasonNumber < 6) return LEGACY_SEASON_CONFIG[seasonNumber] || null;
  if (stage === "championship") return null;
  return {
    sheet: sheetNameForPeriod(seasonNumber, stage),
    rosters: STAGED_FORMAT.rosters,
    teamRank: STAGED_FORMAT.teamRank,
  };
}

function aliasKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function searchKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function displayPeriod(season, stage) {
  if (stage == null) return `S${season}`;
  if (stage === "championship") return `S${season} Championship`;
  return `S${season} Stage ${stage}`;
}

function addAlias(aliasMap, rawName, season, stage, source) {
  const name = String(rawName || "").trim();
  const key = aliasKey(name);
  if (!name || !key) return;

  if (!aliasMap.has(key)) {
    aliasMap.set(key, {
      name,
      key,
      occurrences: 0,
      periods: new Set(),
      sources: new Set(),
    });
  }

  const entry = aliasMap.get(key);
  entry.occurrences += 1;
  entry.periods.add(displayPeriod(season, stage));
  entry.sources.add(source);
}

function collectFromStandings(aliasMap, rows, season, stage) {
  for (const row of rows || []) {
    if (!rowHasAnyValue(row)) continue;
    const arr = Array.isArray(row) ? row : [];
    const rank = arr[0];
    const name = arr.length >= 2 ? arr[arr.length - 2] : "";
    if (!rank || !name) continue;
    addAlias(aliasMap, name, season, stage, "player_standings");
  }
}

function collectFromRoster(aliasMap, rows, season, stage) {
  const cleaned = (rows || []).filter(rowHasAnyValue);
  if (!cleaned.length) return;

  const bodyRows = cleaned.slice(1);
  for (let index = 0; index < bodyRows.length; index += 5) {
    const playerRows = [
      bodyRows[index + 1],
      bodyRows[index + 2],
      bodyRows[index + 3],
      bodyRows[index + 4],
    ].filter(Boolean);

    for (const row of playerRows) {
      addAlias(aliasMap, row?.[2], season, stage, "roster");
    }
  }
}

function collectFromLookup(aliasMap, rows, season, stage) {
  const cleaned = (rows || []).filter(rowHasAnyValue);
  if (!cleaned.length) return;

  for (const row of cleaned.slice(1)) {
    const name = String(row?.[2] ?? "").trim();
    if (!name) continue;

    const overallRank = toNum(row?.[0]);
    if (overallRank === null) continue;
    addAlias(aliasMap, name, season, stage, "lookup");
  }
}

function collectFromChampionshipRoster(aliasMap, rows, season) {
  const cleaned = (rows || []).filter(rowHasAnyValue);
  if (!cleaned.length) return;

  const bodyRows = cleaned.slice(1);
  for (let index = 0; index < bodyRows.length; index += 5) {
    for (let offset = 1; offset <= 4; offset += 1) {
      addAlias(aliasMap, bodyRows[index + offset]?.[0], season, "championship", "championship_roster");
    }
  }
}

async function scanPeriodAliases(aliasMap, season, stage) {
  const config = getPeriodConfig(season, stage);
  if (!config) return;

  const sheet = config.sheet;
  const ranges = {
    roster: `'${sheet}'!${config.rosters}`,
    lookup: `'${sheet}'!${LOOKUP_RANGE_A1}`,
    playerStandings: `'${sheet}'!${RANGE_PLAYER_STANDINGS_A1}`,
  };

  const [rosterRows, lookupRows, playerRows] = await Promise.all([
    fetchRange(ranges.roster).catch(() => []),
    fetchRange(ranges.lookup).catch(() => []),
    fetchRange(ranges.playerStandings).catch(() => []),
  ]);

  collectFromRoster(aliasMap, rosterRows, season, stage);
  collectFromLookup(aliasMap, lookupRows, season, stage);
  collectFromStandings(aliasMap, playerRows, season, stage);
}

async function scanChampionshipAliases(aliasMap, season) {
  const sheet = sheetNameForPeriod(season, "championship");
  const rosterRows = await fetchRange(`'${sheet}'!${CH_ROSTER}`).catch(() => []);
  collectFromChampionshipRoster(aliasMap, rosterRows, season);
}

async function collectSheetAliases() {
  const aliases = new Map();

  for (let season = 1; season <= Math.min(5, MAX_SEASON_TO_CHECK); season += 1) {
    await scanPeriodAliases(aliases, season, null);
  }

  for (let season = 6; season <= MAX_SEASON_TO_CHECK; season += 1) {
    for (let stage = 1; stage <= 3; stage += 1) {
      await scanPeriodAliases(aliases, season, stage);
    }
    await scanChampionshipAliases(aliases, season);
  }

  return [...aliases.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchAllSupabaseRows(buildQuery, pageSize = 1000) {
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;

    const pageRows = data || [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
  }
}

async function fetchDiscordMembers(supabase, guildId) {
  return fetchAllSupabaseRows(() =>
    supabase
      .from("discord_guild_members")
      .select("guild_id,discord_user_id,username,global_name,display_name,nickname,is_current_member,is_bot")
      .eq("guild_id", guildId)
      .eq("is_current_member", true)
      .eq("is_bot", false)
      .order("display_name", { ascending: true })
  );
}

function isMissingAliasTable(error) {
  return /schema cache|could not find the table|does not exist/i.test(error?.message || "");
}

async function fetchExistingAliases(supabase, leagueKey) {
  const { data, error } = await supabase
    .from("player_league_aliases")
    .select("league_key,league_player_name,league_player_key,guild_id,discord_user_id,active,notes")
    .eq("league_key", leagueKey)
    .eq("active", true);

  if (error) {
    if (isMissingAliasTable(error)) return new Map();
    throw error;
  }

  return new Map((data || []).map((row) => [row.league_player_key, row]));
}

function tokens(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function tokenScore(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union ? intersection / union : 0;
  const subset = intersection / Math.min(leftSet.size, rightSet.size);
  return Math.max(jaccard, subset * 0.92);
}

function fieldScore(alias, value) {
  const aliasNormalized = searchKey(alias);
  const valueNormalized = searchKey(value);
  if (!aliasNormalized || !valueNormalized) return 0;
  if (aliasNormalized === valueNormalized) return 1;

  const shorter = Math.min(aliasNormalized.length, valueNormalized.length);
  const longer = Math.max(aliasNormalized.length, valueNormalized.length);
  const lengthRatio = shorter / longer;

  if (shorter >= 4 && (aliasNormalized.startsWith(valueNormalized) || valueNormalized.startsWith(aliasNormalized))) {
    return Math.max(0.82, 0.94 * lengthRatio);
  }

  if (shorter >= 4 && (aliasNormalized.includes(valueNormalized) || valueNormalized.includes(aliasNormalized))) {
    return Math.max(0.74, 0.88 * lengthRatio);
  }

  const editRatio = 1 - levenshtein(aliasNormalized, valueNormalized) / longer;
  return Math.max(editRatio * 0.93, tokenScore(alias, value) * 0.9);
}

function scoreMember(alias, member) {
  const fields = [
    ["display_name", member.display_name, 1],
    ["nickname", member.nickname, 0.99],
    ["username", member.username, 0.96],
    ["global_name", member.global_name, 0.95],
  ];

  let best = null;
  for (const [field, value, weight] of fields) {
    const rawScore = fieldScore(alias, value);
    const score = rawScore * weight;
    if (!best || score > best.score) {
      best = {
        score,
        matchedField: field,
        matchedValue: value || "",
      };
    }
  }

  return best || { score: 0, matchedField: "", matchedValue: "" };
}

function candidatesForAlias(alias, members, minScore, maxCandidates) {
  return members
    .map((member) => {
      const scored = scoreMember(alias.name, member);
      return {
        discord_user_id: member.discord_user_id,
        display_name: member.display_name || "",
        username: member.username || "",
        nickname: member.nickname || "",
        global_name: member.global_name || "",
        score: scored.score,
        matched_field: scored.matchedField,
        matched_value: scored.matchedValue,
      };
    })
    .filter((candidate) => candidate.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCandidates);
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function stringifyCsv(rows) {
  const lines = [csvHeaders.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(csvHeaders.map((header) => csvEscape(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...bodyRows] = rows.filter((item) => item.some((value) => value !== ""));
  if (!headers) return [];

  return bodyRows.map((bodyRow) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = bodyRow[index] || "";
    });
    return record;
  });
}

async function runSuggest() {
  const supabase = createSupabaseClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  const leagueKey = getArg("--league-key", process.env.PROLEAGUE_LEAGUE_KEY || defaultLeagueKey);
  const outPath = path.resolve(getArg("--out", defaultReviewPath));
  const minScore = getNumberArg("--min-score", 0.58);
  const autoThreshold = getNumberArg("--auto-threshold", 0.92);
  const minGap = getNumberArg("--min-gap", 0.08);
  const maxCandidates = Math.max(1, Math.trunc(getNumberArg("--max-candidates", 5)));

  console.log("Scanning Shotgun Pro League sheet aliases...");
  const [aliases, members, existingAliases] = await Promise.all([
    collectSheetAliases(),
    fetchDiscordMembers(supabase, guildId),
    fetchExistingAliases(supabase, leagueKey),
  ]);

  const rows = aliases.map((alias) => {
    const candidates = candidatesForAlias(alias, members, minScore, maxCandidates);
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    const existing = existingAliases.get(alias.key);
    const clearMatch =
      !!best &&
      best.score >= autoThreshold &&
      (!second || best.score - second.score >= minGap);

    return {
      league_key: leagueKey,
      league_player_name: alias.name,
      league_player_key: alias.key,
      occurrences: alias.occurrences,
      periods: [...alias.periods].join("; "),
      sources: [...alias.sources].sort().join("; "),
      suggested_discord_user_id: best?.discord_user_id || "",
      suggested_display_name: best?.display_name || "",
      suggested_username: best?.username || "",
      suggested_nickname: best?.nickname || "",
      suggested_global_name: best?.global_name || "",
      match_score: best ? best.score.toFixed(3) : "",
      matched_field: best?.matched_field || "",
      matched_value: best?.matched_value || "",
      approval: existing ? "existing" : clearMatch ? "approve" : "",
      approved_discord_user_id: existing?.discord_user_id || (clearMatch ? best.discord_user_id : ""),
      notes: existing?.notes || "",
      candidates_json: JSON.stringify(
        candidates.map((candidate) => ({
          discord_user_id: candidate.discord_user_id,
          score: Number(candidate.score.toFixed(3)),
          display_name: candidate.display_name,
          username: candidate.username,
          nickname: candidate.nickname,
          global_name: candidate.global_name,
          matched_field: candidate.matched_field,
          matched_value: candidate.matched_value,
        }))
      ),
    };
  });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, stringifyCsv(rows));

  const approved = rows.filter((row) => row.approval === "approve").length;
  const existing = rows.filter((row) => row.approval === "existing").length;
  const needsReview = rows.length - approved - existing;

  console.log(`Wrote ${rows.length} alias suggestions to ${outPath}`);
  console.log(`${approved} clear matches pre-approved, ${existing} existing mappings, ${needsReview} rows need review.`);
  console.log("Edit approval to approve and/or fill approved_discord_user_id, then run npm run proleague:aliases:import.");
}

async function runImport() {
  const supabase = createSupabaseClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  const leagueKey = getArg("--league-key", process.env.PROLEAGUE_LEAGUE_KEY || defaultLeagueKey);
  const filePath = path.resolve(getArg("--file", defaultReviewPath));
  const text = await fs.readFile(filePath, "utf8");
  const records = parseCsv(text);
  const approvedRows = records.filter((record) =>
    ["approve", "approved", "yes", "y"].includes(String(record.approval || "").trim().toLowerCase())
  );

  if (!approvedRows.length) {
    console.log("No approved rows found. Set approval to approve/approved/yes/y before importing.");
    return;
  }

  const members = await fetchDiscordMembers(supabase, guildId);
  const memberIds = new Set(members.map((member) => member.discord_user_id));
  const importRows = [];

  for (const row of approvedRows) {
    const discordUserId = String(row.approved_discord_user_id || row.suggested_discord_user_id || "").trim();
    const leaguePlayerName = String(row.league_player_name || "").trim();
    if (!leaguePlayerName) {
      throw new Error("Approved row is missing league_player_name.");
    }
    if (!discordUserId) {
      throw new Error(`Approved row for '${leaguePlayerName}' is missing approved_discord_user_id.`);
    }
    if (!memberIds.has(discordUserId)) {
      throw new Error(`Approved Discord user ID ${discordUserId} for '${leaguePlayerName}' is not a current non-bot guild member.`);
    }

    importRows.push({
      league_key: row.league_key || leagueKey,
      league_player_name: leaguePlayerName,
      guild_id: guildId,
      discord_user_id: discordUserId,
      active: true,
      source: "proleague-alias-script",
      notes: row.notes || null,
    });
  }

  const { error } = await supabase
    .from("player_league_aliases")
    .upsert(importRows, { onConflict: "league_key,league_player_key" });

  if (error) {
    if (isMissingAliasTable(error)) {
      throw new Error(`Import failed: ${error.message}. Run bot/proleague-player-alias-schema.sql in Supabase first.`);
    }
    throw error;
  }

  console.log(`Imported ${importRows.length} approved player alias mappings from ${filePath}.`);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h" || command === "help") {
    usage();
    return;
  }

  if (command === "suggest") {
    await runSuggest();
    return;
  }

  if (command === "import") {
    await runImport();
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
