"use strict";

require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const {
  CALCULATION_VERSION,
  DEFAULT_BASE_RATING,
  DEFAULT_K_FACTOR,
  dedupeMatches,
  replayElo,
  validateDescendingMatches,
} = require("./internal-ranked-core");

const defaultTeamUpApiBaseUrl = "https://api.teamupgg.com/v1";
const defaultTeamUpClientId = "DISCORD|1069003073311211601";
const defaultSupabaseUrl = "https://kwaprkwemtxizorpnrzq.supabase.co";
const defaultSeasons = [7, 8, 9, 10, 11, 12];
const defaultLimit = 50;
const defaultDelayMs = 30000;

function usage() {
  console.log(`
Usage:
  node bot/internal-ranked.js fetch [options]
  node bot/internal-ranked.js replay [options]
  node bot/internal-ranked.js sync [options]

Commands:
  fetch    Pull TeamUp Ranked League matches for seasons 7-12, validate,
           dedupe, and upsert valid matches into Supabase.
  replay   Recalculate internal Ranked League Elo from stored matches and
           write a new Elo run with final ratings and per-match history.
  sync     Run fetch, then replay.

Options:
  --seasons <list>       Seasons to process. Examples: 7-12 or 7,8,9.
                         Default: 7-12
  --limit <number>       TeamUp page size. Default: ${defaultLimit}
  --delay-ms <number>    Delay between TeamUp requests. Default: ${defaultDelayMs}
  --max-pages <number>   Testing only: stop after this many pages per season.
  --allow-incomplete     Testing only: never fail on total_matches under-fetch.
  --base-rating <number> Elo starting rating. Default: ${DEFAULT_BASE_RATING}
  --k-factor <number>    Elo K-factor. Default: ${DEFAULT_K_FACTOR}

Environment:
  NSSGOLF_SUPABASE_URL or SUPABASE_URL
  NSSGOLF_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY
  TEAMUP_API_BASE_URL optional, defaults to ${defaultTeamUpApiBaseUrl}
  TEAMUP_CLIENT_ID optional, defaults to ${defaultTeamUpClientId}
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

function parseSeasons(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return defaultSeasons;

  const seasons = new Set();
  for (const part of rawValue.split(",")) {
    const cleanPart = part.trim();
    const rangeMatch = cleanPart.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const step = start <= end ? 1 : -1;
      for (let season = start; season !== end + step; season += step) {
        seasons.add(season);
      }
      continue;
    }

    const season = Number(cleanPart);
    if (Number.isInteger(season)) seasons.add(season);
  }

  const parsed = [...seasons].filter((season) => season > 0).sort((a, b) => a - b);
  if (!parsed.length) throw new Error(`Invalid --seasons value: ${value}`);
  return parsed;
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

function createSupabaseServiceClient() {
  const supabaseUrl =
    process.env.NSSGOLF_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    defaultSupabaseUrl;
  const supabaseServiceRoleKey =
    process.env.NSSGOLF_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing NSSGOLF_SUPABASE_URL or NSSGOLF_SUPABASE_SERVICE_ROLE_KEY. Add them to .env before running this importer."
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

function chunkRows(rows, size = 500) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRateLimiter(delayMs) {
  let hasFetched = false;
  return async function waitForTurn() {
    if (hasFetched && delayMs > 0) {
      await sleep(delayMs);
    }
    hasFetched = true;
  };
}

function teamUpUrlForSeason(season, { cursor = "", limit = defaultLimit } = {}) {
  const baseUrl = String(process.env.TEAMUP_API_BASE_URL || defaultTeamUpApiBaseUrl).replace(/\/+$/, "");
  const clientId = teamUpClientId();
  const url = new URL(
    `${baseUrl}/client/${encodeURIComponent(clientId)}/matches/Season_${season}`
  );
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  return url;
}

function teamUpClientId() {
  return process.env.TEAMUP_CLIENT_ID || defaultTeamUpClientId;
}

function timestampFromMatch(match) {
  const timestamp = Number(match?.timestamp);
  return Number.isInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function syntheticCursorForSeason(season, match) {
  const timestamp = timestampFromMatch(match);
  if (timestamp == null) return "";

  return Buffer.from(
    JSON.stringify({
      pk: `${teamUpClientId()}|Season_${season}`,
      ts: timestamp,
    })
  ).toString("base64");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `TeamUp request failed (${response.status}) for ${url}: ${body.slice(0, 300)}`
    );
  }
  return response.json();
}

async function fetchSeason(season, options, waitForTurn) {
  let cursor = "";
  let totalMatches = null;
  let pageCount = 0;
  const matches = [];
  const seenCursors = new Set();

  while (true) {
    if (options.maxPages && pageCount >= options.maxPages) {
      console.warn(
        `Season ${season}: stopped after --max-pages=${options.maxPages}; fetched data may be incomplete.`
      );
      break;
    }

    await waitForTurn();
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error(`Season ${season}: TeamUp returned a repeated cursor; stopping to avoid an infinite fetch loop.`);
      }
      seenCursors.add(cursor);
    }

    const url = teamUpUrlForSeason(season, {
      cursor,
      limit: options.limit,
    });
    console.log(`Season ${season}: fetching page ${pageCount + 1}`);
    const payload = await fetchJson(url);
    const pageMatches = Array.isArray(payload.matches) ? payload.matches : [];
    const payloadTotal = Number(payload.total_matches);

    if (Number.isInteger(payloadTotal) && payloadTotal >= 0) {
      if (totalMatches != null && totalMatches !== payloadTotal) {
        throw new Error(
          `Season ${season}: total_matches changed from ${totalMatches} to ${payloadTotal}.`
        );
      }
      totalMatches = payloadTotal;
    }

    if (payload.leaderboard && payload.leaderboard !== `Season_${season}`) {
      throw new Error(
        `Season ${season}: expected leaderboard Season_${season}, got ${payload.leaderboard}.`
      );
    }

    matches.push(...pageMatches);
    pageCount += 1;
    console.log(
      `Season ${season}: page ${pageCount} returned ${pageMatches.length} matches; collected ${matches.length}/${totalMatches ?? "?"}.`
    );

    cursor = String(payload.cursor || "");
    if (cursor && pageMatches.length !== options.limit) {
      console.warn(
        `Season ${season}: page ${pageCount} returned ${pageMatches.length} matches instead of ${options.limit}, but TeamUp returned another cursor; continuing.`
      );
    }
    if (
      !cursor &&
      totalMatches != null &&
      matches.length < totalMatches &&
      pageMatches.length > 0
    ) {
      cursor = syntheticCursorForSeason(season, pageMatches[pageMatches.length - 1]);
      if (cursor) {
        console.warn(
          `Season ${season}: TeamUp omitted a cursor after ${matches.length}/${totalMatches} matches; continuing with a timestamp cursor from the last match on page ${pageCount}.`
        );
      }
    }
    if (!cursor) break;
  }

  const orderProblems = validateDescendingMatches(matches);
  if (orderProblems.length) {
    throw new Error(`Season ${season}: timestamp order check failed:\n${orderProblems.join("\n")}`);
  }

  const { valid, duplicates } = dedupeMatches(season, matches);

  if (totalMatches != null && matches.length < totalMatches) {
    const deficit = totalMatches - matches.length;
    const fetchedRatio = totalMatches === 0 ? 1 : matches.length / totalMatches;
    const underFetchMessage = `Season ${season}: fetched ${matches.length} match groups, which is ${deficit} fewer than TeamUp total_matches (${totalMatches}).`;

    if (!options.allowIncomplete && fetchedRatio < 0.95) {
      throw new Error(
        `${underFetchMessage} This is below the 95% completeness threshold, so the fetch is probably incomplete.`
      );
    }

    console.warn(
      `${underFetchMessage} Continuing because fetched results are within the 5% tolerance${options.allowIncomplete ? " or --allow-incomplete was set" : ""}.`
    );
  }

  if (totalMatches != null && matches.length > totalMatches) {
    console.warn(
      `Season ${season}: fetched ${matches.length} match groups, which is ${matches.length - totalMatches} more than TeamUp total_matches (${totalMatches}). Continuing because cursor pagination reached the end.`
    );
  }

  console.log(
    `Season ${season}: fetched ${matches.length}; valid after dedupe ${valid.length}; skipped duplicates ${duplicates.length}.`
  );
  for (const duplicate of duplicates) {
    console.warn(
      `Season ${season}: skipped duplicate ${duplicate.duplicate_hash} within 2 minutes of ${duplicate.kept_hash}.`
    );
  }

  return {
    season,
    totalMatches,
    fetchedCount: matches.length,
    valid,
    duplicates,
  };
}

async function upsertSeasonMatches(supabase, seasonResult) {
  const rows = seasonResult.valid;
  if (!rows.length) {
    console.log(`Season ${seasonResult.season}: no valid matches to upsert.`);
    return;
  }

  for (const chunk of chunkRows(rows, 250)) {
    const { error } = await supabase
      .from("internal_ranked_matches")
      .upsert(chunk, { onConflict: "match_hash" });
    if (error) {
      throw new Error(`Season ${seasonResult.season}: match upsert failed: ${error.message}`);
    }
  }

  console.log(`Season ${seasonResult.season}: upserted ${rows.length} valid matches.`);
}

async function fetchAndUpsert(options) {
  const supabase = createSupabaseServiceClient();
  const waitForTurn = createRateLimiter(options.delayMs);
  const results = [];

  for (const season of options.seasons) {
    const seasonResult = await fetchSeason(season, options, waitForTurn);
    await upsertSeasonMatches(supabase, seasonResult);
    results.push(seasonResult);
  }

  const fetched = results.reduce((sum, result) => sum + result.fetchedCount, 0);
  const valid = results.reduce((sum, result) => sum + result.valid.length, 0);
  const duplicates = results.reduce((sum, result) => sum + result.duplicates.length, 0);
  console.log(
    `Fetch complete: fetched ${fetched} match groups, upserted ${valid}, skipped ${duplicates} duplicates.`
  );
  return results;
}

async function loadStoredMatches(supabase, seasons) {
  const rows = [];
  const minSeason = Math.min(...seasons);
  const maxSeason = Math.max(...seasons);
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("internal_ranked_matches")
      .select("match_hash,season,timestamp_ms,played_at,raw_match")
      .gte("season", minSeason)
      .lte("season", maxSeason)
      .order("timestamp_ms", { ascending: true })
      .order("match_hash", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Stored match lookup failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function roundRating(value) {
  return Number(value.toFixed(4));
}

async function insertReplayRows(supabase, tableName, rows, context) {
  for (const chunk of chunkRows(rows, 500)) {
    const { error } = await supabase.from(tableName).insert(chunk);
    if (error) throw new Error(`${context}: ${error.message}`);
  }
}

async function replayStoredMatches(options) {
  const supabase = createSupabaseServiceClient();
  const storedMatches = await loadStoredMatches(supabase, options.seasons);
  if (!storedMatches.length) {
    throw new Error(
      `No stored internal Ranked League matches found for seasons ${options.seasons.join(", ")}. Run fetch first.`
    );
  }

  const replay = replayElo(storedMatches, {
    baseRating: options.baseRating,
    kFactor: options.kFactor,
  });

  const runConfig = {
    pairwise_model: "all_players_in_match",
    same_place_score: 0.5,
    win_score: 1,
    loss_score: 0,
    pre_match_ratings: true,
    duplicate_policy: "exact_result_signature_within_2_minutes_skipped_before_insert",
  };

  const { data: runRow, error: runError } = await supabase
    .from("internal_ranked_elo_runs")
    .insert({
      calculation_version: CALCULATION_VERSION,
      base_rating: options.baseRating,
      k_factor: options.kFactor,
      season_start: Math.min(...options.seasons),
      season_end: Math.max(...options.seasons),
      match_count: replay.matchCount,
      player_count: replay.finalRatings.length,
      config: runConfig,
    })
    .select("id")
    .single();

  if (runError) throw new Error(`Elo run insert failed: ${runError.message}`);
  const runId = runRow.id;

  const ratingRows = replay.finalRatings.map((row) => ({
    run_id: runId,
    discord_user_id: row.discord_user_id,
    display_name: row.display_name,
    rating: roundRating(row.rating),
    matches_played: row.matches_played,
    pairwise_wins: row.pairwise_wins,
    pairwise_losses: row.pairwise_losses,
    pairwise_ties: row.pairwise_ties,
    pairwise_games: row.pairwise_games,
    first_played_at: row.first_played_at,
    last_played_at: row.last_played_at,
    rank: row.rank,
  }));

  const matchResultRows = replay.matchResults.map((row) => ({
    run_id: runId,
    match_hash: row.match_hash,
    season: row.season,
    timestamp_ms: row.timestamp_ms,
    played_at: row.played_at,
    discord_user_id: row.discord_user_id,
    display_name: row.display_name,
    place: row.place,
    rating_before: roundRating(row.rating_before),
    rating_delta: roundRating(row.rating_delta),
    rating_after: roundRating(row.rating_after),
    pairwise_wins: row.pairwise_wins,
    pairwise_losses: row.pairwise_losses,
    pairwise_ties: row.pairwise_ties,
  }));

  await insertReplayRows(
    supabase,
    "internal_ranked_elo_ratings",
    ratingRows,
    "Final rating insert failed"
  );
  await insertReplayRows(
    supabase,
    "internal_ranked_elo_match_results",
    matchResultRows,
    "Per-match Elo result insert failed"
  );

  console.log(
    `Replay complete: run ${runId}, ${replay.matchCount} matches, ${ratingRows.length} players, ${matchResultRows.length} player-match rows.`
  );
  console.log("Top 10:");
  for (const row of ratingRows.slice(0, 10)) {
    console.log(
      `${row.rank}. ${row.display_name || row.discord_user_id} (${row.discord_user_id}) ${row.rating}`
    );
  }

  return runId;
}

function parseOptions() {
  return {
    seasons: parseSeasons(getArg("--seasons", "7-12")),
    limit: getNumberArg("--limit", defaultLimit),
    delayMs: getNumberArg("--delay-ms", defaultDelayMs),
    maxPages: getNumberArg("--max-pages", 0),
    allowIncomplete: hasFlag("--allow-incomplete"),
    baseRating: getNumberArg("--base-rating", DEFAULT_BASE_RATING),
    kFactor: getNumberArg("--k-factor", DEFAULT_K_FACTOR),
  };
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const options = parseOptions();

  if (command === "fetch") {
    await fetchAndUpsert(options);
  } else if (command === "replay") {
    await replayStoredMatches(options);
  } else if (command === "sync") {
    await fetchAndUpsert(options);
    await replayStoredMatches(options);
  } else {
    usage();
    throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
