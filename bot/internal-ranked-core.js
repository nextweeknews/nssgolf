"use strict";

const crypto = require("node:crypto");

const CALCULATION_VERSION = "ranked-pairwise-elo-v1";
const DEFAULT_BASE_RATING = 1200;
const DEFAULT_K_FACTOR = 20;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

function asInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function normalizeDiscordId(value) {
  const cleanValue = String(value || "").trim();
  return /^[0-9]+$/.test(cleanValue) ? cleanValue : "";
}

function normalizeTeamSizes(value) {
  return Array.isArray(value)
    ? value.map((item) => asInteger(item)).filter((item) => item != null)
    : [];
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function resultSignature(match) {
  const results = Array.isArray(match?.results) ? match.results : [];
  const normalizedResults = results
    .map((result) => ({
      place: asInteger(result?.place),
      player_ids: (Array.isArray(result?.players) ? result.players : [])
        .map((player) => normalizeDiscordId(player?.player_id))
        .filter(Boolean)
        .sort(),
    }))
    .filter((result) => result.place != null && result.player_ids.length > 0)
    .sort((left, right) => {
      if (left.place !== right.place) return left.place - right.place;
      return left.player_ids.join(",").localeCompare(right.player_ids.join(","));
    });

  return stableJson({
    versus: String(match?.versus || "").trim(),
    team_sizes: normalizeTeamSizes(match?.team_sizes),
    results: normalizedResults,
  });
}

function matchHash(season, match) {
  return hashText(
    stableJson({
      season,
      timestamp_ms: asInteger(match?.timestamp),
      result_signature: resultSignature(match),
    })
  );
}

function playedAtFromTimestamp(timestampMs) {
  const timestamp = asInteger(timestampMs);
  if (timestamp == null || timestamp <= 0) return "";
  return new Date(timestamp).toISOString();
}

function normalizeMatchForStorage(season, match) {
  const cleanSeason = asInteger(season);
  const timestampMs = asInteger(match?.timestamp);
  if (cleanSeason == null || cleanSeason < 1) {
    throw new Error(`Invalid Ranked League season: ${season}`);
  }
  if (timestampMs == null || timestampMs <= 0) {
    throw new Error(`Invalid match timestamp for Season ${season}`);
  }

  const signature = resultSignature(match);
  return {
    match_hash: matchHash(cleanSeason, match),
    season: cleanSeason,
    leaderboard: `Season_${cleanSeason}`,
    timestamp_ms: timestampMs,
    played_at: playedAtFromTimestamp(timestampMs),
    versus: String(match?.versus || "").trim(),
    team_sizes: normalizeTeamSizes(match?.team_sizes),
    result_signature: signature,
    raw_match: match,
  };
}

function validateDescendingMatches(matches) {
  const problems = [];
  for (let index = 1; index < matches.length; index += 1) {
    const previous = asInteger(matches[index - 1]?.timestamp);
    const current = asInteger(matches[index]?.timestamp);
    if (previous == null || current == null) {
      problems.push(`Match ${index + 1} has an invalid timestamp.`);
      continue;
    }
    if (previous < current) {
      problems.push(
        `Match ${index + 1} is newer than the previous match (${current} > ${previous}).`
      );
    }
  }
  return problems;
}

function dedupeMatches(season, matches, { duplicateWindowMs = DUPLICATE_WINDOW_MS } = {}) {
  const sorted = [...matches].sort((left, right) => {
    const leftTimestamp = asInteger(left?.timestamp) ?? 0;
    const rightTimestamp = asInteger(right?.timestamp) ?? 0;
    if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
    return resultSignature(left).localeCompare(resultSignature(right));
  });

  const lastSeenBySignature = new Map();
  const valid = [];
  const duplicates = [];

  for (const match of sorted) {
    const timestampMs = asInteger(match?.timestamp);
    const signature = resultSignature(match);
    const previous = lastSeenBySignature.get(signature);

    if (
      previous &&
      timestampMs != null &&
      Math.abs(timestampMs - previous.timestampMs) <= duplicateWindowMs
    ) {
      duplicates.push({
        season,
        duplicate_hash: matchHash(season, match),
        kept_hash: previous.keptHash,
        timestamp_ms: timestampMs,
        kept_timestamp_ms: previous.keptTimestampMs,
        reason: "exact_duplicate_within_2_minutes",
      });
      lastSeenBySignature.set(signature, {
        timestampMs,
        keptHash: previous.keptHash,
        keptTimestampMs: previous.keptTimestampMs,
      });
      continue;
    }

    const normalized = normalizeMatchForStorage(season, match);
    lastSeenBySignature.set(signature, {
      timestampMs: normalized.timestamp_ms,
      keptHash: normalized.match_hash,
      keptTimestampMs: normalized.timestamp_ms,
    });
    valid.push(normalized);
  }

  return {
    valid: valid.sort((left, right) => {
      if (left.timestamp_ms !== right.timestamp_ms) return left.timestamp_ms - right.timestamp_ms;
      return left.match_hash.localeCompare(right.match_hash);
    }),
    duplicates,
  };
}

function playersFromMatch(matchRow) {
  const rawMatch = matchRow?.raw_match || matchRow;
  const results = Array.isArray(rawMatch?.results) ? rawMatch.results : [];
  const players = [];
  const seen = new Set();

  for (const result of results) {
    const place = asInteger(result?.place);
    if (place == null) continue;

    for (const player of Array.isArray(result?.players) ? result.players : []) {
      const discordUserId = normalizeDiscordId(player?.player_id);
      if (!discordUserId) continue;
      if (seen.has(discordUserId)) {
        throw new Error(
          `Player ${discordUserId} appears more than once in match ${matchRow?.match_hash || "unknown"}.`
        );
      }
      seen.add(discordUserId);
      players.push({
        discord_user_id: discordUserId,
        display_name: String(player?.display_name || "").trim() || null,
        place,
      });
    }
  }

  return players.sort((left, right) => {
    if (left.place !== right.place) return left.place - right.place;
    return left.discord_user_id.localeCompare(right.discord_user_id);
  });
}

function expectedScore(leftRating, rightRating) {
  return 1 / (1 + 10 ** ((rightRating - leftRating) / 400));
}

function actualScore(leftPlace, rightPlace) {
  if (leftPlace < rightPlace) return 1;
  if (leftPlace > rightPlace) return 0;
  return 0.5;
}

function initialPlayerState(baseRating) {
  return {
    rating: baseRating,
    matches_played: 0,
    pairwise_wins: 0,
    pairwise_losses: 0,
    pairwise_ties: 0,
    pairwise_games: 0,
    display_name: null,
    first_played_at: null,
    last_played_at: null,
  };
}

function replayElo(matchRows, options = {}) {
  const baseRating = Number(options.baseRating ?? DEFAULT_BASE_RATING);
  const kFactor = Number(options.kFactor ?? DEFAULT_K_FACTOR);
  if (!Number.isFinite(baseRating)) throw new Error("baseRating must be a finite number.");
  if (!Number.isFinite(kFactor)) throw new Error("kFactor must be a finite number.");

  const sortedMatches = [...matchRows].sort((left, right) => {
    if (left.timestamp_ms !== right.timestamp_ms) return left.timestamp_ms - right.timestamp_ms;
    return String(left.match_hash).localeCompare(String(right.match_hash));
  });

  const ratings = new Map();
  const matchResults = [];

  for (const matchRow of sortedMatches) {
    const players = playersFromMatch(matchRow);
    if (players.length < 2) continue;

    const beforeRatings = new Map();
    const deltas = new Map();
    const pairwise = new Map();

    for (const player of players) {
      if (!ratings.has(player.discord_user_id)) {
        ratings.set(player.discord_user_id, initialPlayerState(baseRating));
      }
      const state = ratings.get(player.discord_user_id);
      beforeRatings.set(player.discord_user_id, state.rating);
      deltas.set(player.discord_user_id, 0);
      pairwise.set(player.discord_user_id, { wins: 0, losses: 0, ties: 0 });
    }

    for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
        const left = players[leftIndex];
        const right = players[rightIndex];
        const leftRating = beforeRatings.get(left.discord_user_id);
        const rightRating = beforeRatings.get(right.discord_user_id);
        const leftActual = actualScore(left.place, right.place);
        const rightActual = 1 - leftActual;
        const leftExpected = expectedScore(leftRating, rightRating);
        const rightExpected = expectedScore(rightRating, leftRating);

        deltas.set(
          left.discord_user_id,
          deltas.get(left.discord_user_id) + kFactor * (leftActual - leftExpected)
        );
        deltas.set(
          right.discord_user_id,
          deltas.get(right.discord_user_id) + kFactor * (rightActual - rightExpected)
        );

        const leftPairwise = pairwise.get(left.discord_user_id);
        const rightPairwise = pairwise.get(right.discord_user_id);
        if (leftActual === 1) {
          leftPairwise.wins += 1;
          rightPairwise.losses += 1;
        } else if (leftActual === 0) {
          leftPairwise.losses += 1;
          rightPairwise.wins += 1;
        } else {
          leftPairwise.ties += 1;
          rightPairwise.ties += 1;
        }
      }
    }

    for (const player of players) {
      const state = ratings.get(player.discord_user_id);
      const before = beforeRatings.get(player.discord_user_id);
      const delta = deltas.get(player.discord_user_id);
      const after = before + delta;
      const stats = pairwise.get(player.discord_user_id);
      const playedAt = matchRow.played_at || playedAtFromTimestamp(matchRow.timestamp_ms);

      state.rating = after;
      state.matches_played += 1;
      state.pairwise_wins += stats.wins;
      state.pairwise_losses += stats.losses;
      state.pairwise_ties += stats.ties;
      state.pairwise_games += stats.wins + stats.losses + stats.ties;
      state.display_name = player.display_name || state.display_name;
      state.first_played_at = state.first_played_at || playedAt;
      state.last_played_at = playedAt;

      matchResults.push({
        match_hash: matchRow.match_hash,
        season: matchRow.season,
        timestamp_ms: matchRow.timestamp_ms,
        played_at: playedAt,
        discord_user_id: player.discord_user_id,
        display_name: player.display_name,
        place: player.place,
        rating_before: before,
        rating_delta: delta,
        rating_after: after,
        pairwise_wins: stats.wins,
        pairwise_losses: stats.losses,
        pairwise_ties: stats.ties,
      });
    }
  }

  const finalRatings = [...ratings.entries()]
    .map(([discordUserId, state]) => ({
      discord_user_id: discordUserId,
      display_name: state.display_name,
      rating: state.rating,
      matches_played: state.matches_played,
      pairwise_wins: state.pairwise_wins,
      pairwise_losses: state.pairwise_losses,
      pairwise_ties: state.pairwise_ties,
      pairwise_games: state.pairwise_games,
      first_played_at: state.first_played_at,
      last_played_at: state.last_played_at,
    }))
    .sort((left, right) => {
      if (right.rating !== left.rating) return right.rating - left.rating;
      return left.discord_user_id.localeCompare(right.discord_user_id);
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  return {
    finalRatings,
    matchResults,
    matchCount: sortedMatches.length,
  };
}

module.exports = {
  CALCULATION_VERSION,
  DEFAULT_BASE_RATING,
  DEFAULT_K_FACTOR,
  DUPLICATE_WINDOW_MS,
  dedupeMatches,
  expectedScore,
  matchHash,
  normalizeMatchForStorage,
  playersFromMatch,
  replayElo,
  resultSignature,
  validateDescendingMatches,
};
