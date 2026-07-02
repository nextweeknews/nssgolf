"use strict";

const crypto = require("node:crypto");

const CALCULATION_VERSION = "ranked-pairwise-elo-v1";
const GPI_CALCULATION_VERSION = "ranked-pl-gpi-v1";
const NPS_ELO_CALCULATION_VERSION = "ranked-normalized-placement-elo-v1";
const DEFAULT_BASE_RATING = 1200;
const DEFAULT_K_FACTOR = 20;
const DEFAULT_PL_RATING_SCALE = 400 / Math.log(10);
const DEFAULT_PL_PRIOR_STRENGTH = 20;
const DEFAULT_PL_SHRINKAGE_MATCHES = 10;
const DEFAULT_PL_MAX_ITERATIONS = 500;
const DEFAULT_PL_TOLERANCE = 0.000001;
const DEFAULT_PL_RECENCY_MODE = "player";
const DEFAULT_NPS_PARTICIPANT_WEIGHT_SCALE = 0.35;
const DEFAULT_NPS_MAX_PARTICIPANT_WEIGHT = 2;
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

function groupedPlayersFromMatch(matchRow) {
  const players = playersFromMatch(matchRow);
  const groupsByPlace = new Map();
  for (const player of players) {
    if (!groupsByPlace.has(player.place)) groupsByPlace.set(player.place, []);
    groupsByPlace.get(player.place).push(player);
  }

  return [...groupsByPlace.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, group]) =>
      group.sort((left, right) => left.discord_user_id.localeCompare(right.discord_user_id))
    );
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
    first_place_finishes: 0,
    placement_score_sum: 0,
    display_name: null,
    first_played_at: null,
    last_played_at: null,
  };
}

function matchRecencyWeightForIndex(index, totalMatches) {
  if (totalMatches <= 1) return 1;
  const ageFraction = Math.max(0, Math.min(1, (totalMatches - 1 - index) / (totalMatches - 1)));
  if (ageFraction <= 0.2) return 1;
  if (ageFraction <= 0.4) return 0.85 - ((ageFraction - 0.2) / 0.2) * 0.15;
  if (ageFraction <= 0.7) return 0.65 - ((ageFraction - 0.4) / 0.3) * 0.25;
  return Math.max(0.15, 0.35 - ((ageFraction - 0.7) / 0.3) * 0.2);
}

function recencyWeightForMatch(matchRow, latestTimestampMs, index, totalMatches, mode) {
  if (mode === "none") return 1;
  return matchRecencyWeightForIndex(index, totalMatches);
}

function playerMatchRecencyWeights(matchRows, recencyMode) {
  const playerMatchIndexes = new Map();
  for (let matchIndex = 0; matchIndex < matchRows.length; matchIndex += 1) {
    const players = playersFromMatch(matchRows[matchIndex]);
    for (const player of players) {
      if (!playerMatchIndexes.has(player.discord_user_id)) {
        playerMatchIndexes.set(player.discord_user_id, []);
      }
      playerMatchIndexes.get(player.discord_user_id).push(matchIndex);
    }
  }

  const weightsByMatchAndPlayer = new Map();
  for (const [discordUserId, indexes] of playerMatchIndexes.entries()) {
    for (let playerMatchIndex = 0; playerMatchIndex < indexes.length; playerMatchIndex += 1) {
      const matchIndex = indexes[playerMatchIndex];
      if (!weightsByMatchAndPlayer.has(matchIndex)) weightsByMatchAndPlayer.set(matchIndex, new Map());
      weightsByMatchAndPlayer
        .get(matchIndex)
        .set(
          discordUserId,
          recencyMode === "none" ? 1 : matchRecencyWeightForIndex(playerMatchIndex, indexes.length)
        );
    }
  }

  return weightsByMatchAndPlayer;
}

function plWeightForPlayer(matchIndex, player, context) {
  const participantWeight = context.participantWeights?.[matchIndex] ?? 1;
  if (context.recencyMode === "none") return participantWeight;
  if (context.recencyMode === "global") {
    return participantWeight * recencyWeightForMatch(
      context.matchRows[matchIndex],
      context.latestTimestampMs,
      matchIndex,
      context.matchRows.length,
      context.recencyMode
    );
  }
  return participantWeight * (context.playerWeights.get(matchIndex)?.get(player.discord_user_id) ?? 1);
}

function averagePlWeightForPlayers(matchIndex, players, context) {
  if (!players.length) return 1;
  const total = players.reduce(
    (sum, player) => sum + plWeightForPlayer(matchIndex, player, context),
    0
  );
  return total / players.length;
}

function placementScore(place, playerCount) {
  if (playerCount <= 1) return 0;
  return (playerCount - place) / (playerCount - 1);
}

function participantWeightForMatchSize(
  playerCount,
  {
    participantWeightScale = DEFAULT_NPS_PARTICIPANT_WEIGHT_SCALE,
    maxParticipantWeight = DEFAULT_NPS_MAX_PARTICIPANT_WEIGHT,
  } = {}
) {
  const cleanPlayerCount = Number(playerCount);
  if (!Number.isFinite(cleanPlayerCount) || cleanPlayerCount <= 2) return 1;
  const scaledWeight =
    1 + Number(participantWeightScale) * Math.log2(Math.max(1, cleanPlayerCount - 1));
  if (!Number.isFinite(scaledWeight)) return 1;
  return Math.min(Number(maxParticipantWeight), Math.max(1, scaledWeight));
}

function normalizedOutcomeScore(player, players) {
  if (players.length <= 1) return 0;
  const total = players.reduce((sum, opponent) => {
    if (opponent.discord_user_id === player.discord_user_id) return sum;
    return sum + actualScore(player.place, opponent.place);
  }, 0);
  return total / (players.length - 1);
}

function expectedFieldScore(player, players, beforeRatings) {
  if (players.length <= 1) return 0;
  const playerRating = beforeRatings.get(player.discord_user_id);
  const total = players.reduce((sum, opponent) => {
    if (opponent.discord_user_id === player.discord_user_id) return sum;
    return sum + expectedScore(playerRating, beforeRatings.get(opponent.discord_user_id));
  }, 0);
  return total / (players.length - 1);
}

function summarizeMatchStats(matchRows, recencyContext) {
  const states = new Map();

  function stateFor(player) {
    if (!states.has(player.discord_user_id)) {
      states.set(player.discord_user_id, {
        matches_played: 0,
        weighted_matches: 0,
        pairwise_wins: 0,
        pairwise_losses: 0,
        pairwise_ties: 0,
        pairwise_games: 0,
        first_place_finishes: 0,
        placement_score_sum: 0,
        weighted_placement_score_sum: 0,
        display_name: null,
        first_played_at: null,
        last_played_at: null,
      });
    }
    return states.get(player.discord_user_id);
  }

  for (let matchIndex = 0; matchIndex < matchRows.length; matchIndex += 1) {
    const matchRow = matchRows[matchIndex];
    const players = playersFromMatch(matchRow);
    if (players.length < 2) continue;

    const playedAt = matchRow.played_at || playedAtFromTimestamp(matchRow.timestamp_ms);
    const perMatchStats = new Map(
      players.map((player) => [player.discord_user_id, { wins: 0, losses: 0, ties: 0 }])
    );

    for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
        const left = players[leftIndex];
        const right = players[rightIndex];
        const leftActual = actualScore(left.place, right.place);
        const leftStats = perMatchStats.get(left.discord_user_id);
        const rightStats = perMatchStats.get(right.discord_user_id);
        if (leftActual === 1) {
          leftStats.wins += 1;
          rightStats.losses += 1;
        } else if (leftActual === 0) {
          leftStats.losses += 1;
          rightStats.wins += 1;
        } else {
          leftStats.ties += 1;
          rightStats.ties += 1;
        }
      }
    }

    for (const player of players) {
      const state = stateFor(player);
      const stats = perMatchStats.get(player.discord_user_id);
      const normalizedPlacement = placementScore(player.place, players.length);
      const weight = plWeightForPlayer(matchIndex, player, recencyContext);

      state.matches_played += 1;
      state.weighted_matches += weight;
      state.pairwise_wins += stats.wins;
      state.pairwise_losses += stats.losses;
      state.pairwise_ties += stats.ties;
      state.pairwise_games += stats.wins + stats.losses + stats.ties;
      if (player.place === 1) state.first_place_finishes += 1;
      state.placement_score_sum += normalizedPlacement;
      state.weighted_placement_score_sum += normalizedPlacement * weight;
      state.display_name = player.display_name || state.display_name;
      state.first_played_at = state.first_played_at || playedAt;
      state.last_played_at = playedAt;
    }
  }

  return states;
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
      if (player.place === 1) {
        state.first_place_finishes += 1;
      }
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
    .map(([discordUserId, state]) => {
      const outcomeWinPercentage =
        state.pairwise_games > 0 ? state.pairwise_wins / state.pairwise_games : 0;
      const matchWinPercentage =
        state.matches_played > 0 ? state.first_place_finishes / state.matches_played : 0;
      return {
        discord_user_id: discordUserId,
        display_name: state.display_name,
        rating: state.rating,
        matches_played: state.matches_played,
        pairwise_wins: state.pairwise_wins,
        pairwise_losses: state.pairwise_losses,
        pairwise_ties: state.pairwise_ties,
        pairwise_games: state.pairwise_games,
        first_place_finishes: state.first_place_finishes,
        outcome_win_percentage: outcomeWinPercentage,
        match_win_percentage: matchWinPercentage,
        first_played_at: state.first_played_at,
        last_played_at: state.last_played_at,
      };
    })
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

function replayNormalizedPlacementElo(matchRows, options = {}) {
  const baseRating = Number(options.baseRating ?? DEFAULT_BASE_RATING);
  const kFactor = Number(options.kFactor ?? DEFAULT_K_FACTOR);
  const participantWeightScale = Number(
    options.participantWeightScale ?? DEFAULT_NPS_PARTICIPANT_WEIGHT_SCALE
  );
  const maxParticipantWeight = Number(
    options.maxParticipantWeight ?? DEFAULT_NPS_MAX_PARTICIPANT_WEIGHT
  );
  if (!Number.isFinite(baseRating)) throw new Error("baseRating must be a finite number.");
  if (!Number.isFinite(kFactor)) throw new Error("kFactor must be a finite number.");
  if (!Number.isFinite(participantWeightScale) || participantWeightScale < 0) {
    throw new Error("participantWeightScale must be a non-negative finite number.");
  }
  if (!Number.isFinite(maxParticipantWeight) || maxParticipantWeight < 1) {
    throw new Error("maxParticipantWeight must be a finite number greater than or equal to 1.");
  }

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
    const normalizedScores = new Map();
    const expectedScores = new Map();
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
        const leftActual = actualScore(left.place, right.place);
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
      const actual = normalizedOutcomeScore(player, players);
      const expected = expectedFieldScore(player, players, beforeRatings);
      const participantWeight = participantWeightForMatchSize(players.length, {
        participantWeightScale,
        maxParticipantWeight,
      });
      normalizedScores.set(player.discord_user_id, actual);
      expectedScores.set(player.discord_user_id, expected);
      deltas.set(player.discord_user_id, kFactor * participantWeight * (actual - expected));
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
      if (player.place === 1) {
        state.first_place_finishes += 1;
      }
      state.placement_score_sum += normalizedScores.get(player.discord_user_id);
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
        player_count: players.length,
        participant_weight: participantWeightForMatchSize(players.length, {
          participantWeightScale,
          maxParticipantWeight,
        }),
        normalized_score: normalizedScores.get(player.discord_user_id),
        expected_score: expectedScores.get(player.discord_user_id),
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
    .map(([discordUserId, state]) => {
      const outcomeWinPercentage =
        state.pairwise_games > 0 ? state.pairwise_wins / state.pairwise_games : 0;
      const matchWinPercentage =
        state.matches_played > 0 ? state.first_place_finishes / state.matches_played : 0;
      const placementScoreAverage =
        state.matches_played > 0 ? state.placement_score_sum / state.matches_played : 0;
      return {
        discord_user_id: discordUserId,
        display_name: state.display_name,
        rating: state.rating,
        raw_rating: state.rating,
        ability: 1,
        skill_log: 0,
        reliability: 1,
        matches_played: state.matches_played,
        weighted_matches: state.matches_played,
        average_match_weight: state.matches_played > 0 ? 1 : 0,
        pairwise_wins: state.pairwise_wins,
        pairwise_losses: state.pairwise_losses,
        pairwise_ties: state.pairwise_ties,
        pairwise_games: state.pairwise_games,
        first_place_finishes: state.first_place_finishes,
        outcome_win_percentage: outcomeWinPercentage,
        match_win_percentage: matchWinPercentage,
        placement_score_average: placementScoreAverage,
        weighted_placement_score: placementScoreAverage,
        first_played_at: state.first_played_at,
        last_played_at: state.last_played_at,
      };
    })
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

function replayPlackettLuceGpi(matchRows, options = {}) {
  const baseRating = Number(options.baseRating ?? DEFAULT_BASE_RATING);
  const ratingScale = Number(options.ratingScale ?? DEFAULT_PL_RATING_SCALE);
  const priorStrength = Number(options.priorStrength ?? DEFAULT_PL_PRIOR_STRENGTH);
  const shrinkageMatches = Number(options.shrinkageMatches ?? DEFAULT_PL_SHRINKAGE_MATCHES);
  const maxIterations = Math.max(
    1,
    Math.trunc(Number(options.maxIterations ?? DEFAULT_PL_MAX_ITERATIONS))
  );
  const tolerance = Number(options.tolerance ?? DEFAULT_PL_TOLERANCE);
  const recencyMode = String(options.recencyMode || DEFAULT_PL_RECENCY_MODE).trim();
  const participantWeightScale = Number(
    options.participantWeightScale ?? DEFAULT_NPS_PARTICIPANT_WEIGHT_SCALE
  );
  const maxParticipantWeight = Number(
    options.maxParticipantWeight ?? DEFAULT_NPS_MAX_PARTICIPANT_WEIGHT
  );

  if (!Number.isFinite(baseRating)) throw new Error("baseRating must be a finite number.");
  if (!Number.isFinite(ratingScale) || ratingScale <= 0) {
    throw new Error("ratingScale must be a positive finite number.");
  }
  if (!Number.isFinite(priorStrength) || priorStrength < 0) {
    throw new Error("priorStrength must be a non-negative finite number.");
  }
  if (!Number.isFinite(shrinkageMatches) || shrinkageMatches < 0) {
    throw new Error("shrinkageMatches must be a non-negative finite number.");
  }
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error("tolerance must be a positive finite number.");
  }
  if (!Number.isFinite(participantWeightScale) || participantWeightScale < 0) {
    throw new Error("participantWeightScale must be a non-negative finite number.");
  }
  if (!Number.isFinite(maxParticipantWeight) || maxParticipantWeight < 1) {
    throw new Error("maxParticipantWeight must be a finite number greater than or equal to 1.");
  }
  if (!["player", "global", "none"].includes(recencyMode)) {
    throw new Error("recencyMode must be one of: player, global, none.");
  }

  const sortedMatches = [...matchRows]
    .sort((left, right) => {
      if (left.timestamp_ms !== right.timestamp_ms) return left.timestamp_ms - right.timestamp_ms;
      return String(left.match_hash).localeCompare(String(right.match_hash));
    })
    .filter((matchRow) => playersFromMatch(matchRow).length >= 2);

  const latestTimestampMs = sortedMatches.reduce(
    (latest, matchRow) => Math.max(latest, asInteger(matchRow.timestamp_ms) || 0),
    0
  );
  const recencyContext = {
    recencyMode,
    matchRows: sortedMatches,
    latestTimestampMs,
    playerWeights: playerMatchRecencyWeights(sortedMatches, recencyMode),
    participantWeights: sortedMatches.map((matchRow) =>
      participantWeightForMatchSize(playersFromMatch(matchRow).length, {
        participantWeightScale,
        maxParticipantWeight,
      })
    ),
  };
  const statsByPlayer = summarizeMatchStats(sortedMatches, recencyContext);
  const playerIds = [...statsByPlayer.keys()].sort();
  const abilities = new Map(playerIds.map((discordUserId) => [discordUserId, 1]));

  let iterations = 0;
  let converged = false;
  let maxChange = Infinity;

  for (iterations = 1; iterations <= maxIterations; iterations += 1) {
    const numerators = new Map(playerIds.map((discordUserId) => [discordUserId, priorStrength]));
    const denominators = new Map(playerIds.map((discordUserId) => [discordUserId, priorStrength]));

    for (let matchIndex = 0; matchIndex < sortedMatches.length; matchIndex += 1) {
      const matchRow = sortedMatches[matchIndex];
      const groups = groupedPlayersFromMatch(matchRow);
      if (groups.length < 2) continue;

      let remainingIds = groups.flat().map((player) => player.discord_user_id);

      for (const group of groups) {
        if (remainingIds.length <= group.length) break;

        const denominator = remainingIds.reduce(
          (sum, discordUserId) => sum + abilities.get(discordUserId),
          0
        );
        if (denominator <= 0) break;

        const stageWeight = averagePlWeightForPlayers(matchIndex, group, recencyContext);
        for (const player of group) {
          numerators.set(
            player.discord_user_id,
            numerators.get(player.discord_user_id) + plWeightForPlayer(matchIndex, player, recencyContext)
          );
        }
        for (const discordUserId of remainingIds) {
          denominators.set(
            discordUserId,
            denominators.get(discordUserId) + (stageWeight * group.length) / denominator
          );
        }

        const selectedIds = new Set(group.map((player) => player.discord_user_id));
        remainingIds = remainingIds.filter((discordUserId) => !selectedIds.has(discordUserId));
      }
    }

    const nextAbilities = new Map();
    let logTotal = 0;
    for (const discordUserId of playerIds) {
      const nextAbility = numerators.get(discordUserId) / denominators.get(discordUserId);
      nextAbilities.set(discordUserId, nextAbility);
      logTotal += Math.log(nextAbility);
    }

    const geometricMean = Math.exp(logTotal / Math.max(1, playerIds.length));
    maxChange = 0;
    for (const discordUserId of playerIds) {
      const normalizedAbility = nextAbilities.get(discordUserId) / geometricMean;
      const previousAbility = abilities.get(discordUserId);
      maxChange = Math.max(
        maxChange,
        Math.abs(Math.log(normalizedAbility) - Math.log(previousAbility))
      );
      abilities.set(discordUserId, normalizedAbility);
    }

    if (maxChange < tolerance) {
      converged = true;
      break;
    }
  }

  const finalRatings = playerIds
    .map((discordUserId) => {
      const state = statsByPlayer.get(discordUserId);
      const ability = abilities.get(discordUserId);
      const skillLog = Math.log(ability);
      const rawRating = baseRating + ratingScale * skillLog;
      const reliability =
        state.matches_played > 0
          ? state.matches_played / (state.matches_played + shrinkageMatches)
          : 0;
      const rating = baseRating + reliability * (rawRating - baseRating);
      const outcomeWinPercentage =
        state.pairwise_games > 0 ? state.pairwise_wins / state.pairwise_games : 0;
      const matchWinPercentage =
        state.matches_played > 0 ? state.first_place_finishes / state.matches_played : 0;
      const placementScoreAverage =
        state.matches_played > 0 ? state.placement_score_sum / state.matches_played : 0;
      const weightedPlacementScore =
        state.weighted_matches > 0
          ? state.weighted_placement_score_sum / state.weighted_matches
          : 0;

      return {
        discord_user_id: discordUserId,
        display_name: state.display_name,
        rating,
        raw_rating: rawRating,
        ability,
        skill_log: skillLog,
        reliability,
        matches_played: state.matches_played,
        weighted_matches: state.weighted_matches,
        average_match_weight:
          state.matches_played > 0 ? state.weighted_matches / state.matches_played : 0,
        pairwise_wins: state.pairwise_wins,
        pairwise_losses: state.pairwise_losses,
        pairwise_ties: state.pairwise_ties,
        pairwise_games: state.pairwise_games,
        first_place_finishes: state.first_place_finishes,
        outcome_win_percentage: outcomeWinPercentage,
        match_win_percentage: matchWinPercentage,
        placement_score_average: placementScoreAverage,
        weighted_placement_score: weightedPlacementScore,
        first_played_at: state.first_played_at,
        last_played_at: state.last_played_at,
      };
    })
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
    matchCount: sortedMatches.length,
    latestTimestampMs,
    iterations,
    converged,
    maxChange,
    recencyMode,
  };
}

module.exports = {
  CALCULATION_VERSION,
  GPI_CALCULATION_VERSION,
  NPS_ELO_CALCULATION_VERSION,
  DEFAULT_BASE_RATING,
  DEFAULT_K_FACTOR,
  DEFAULT_PL_MAX_ITERATIONS,
  DEFAULT_PL_PRIOR_STRENGTH,
  DEFAULT_PL_RATING_SCALE,
  DEFAULT_PL_RECENCY_MODE,
  DEFAULT_PL_SHRINKAGE_MATCHES,
  DEFAULT_PL_TOLERANCE,
  DEFAULT_NPS_MAX_PARTICIPANT_WEIGHT,
  DEFAULT_NPS_PARTICIPANT_WEIGHT_SCALE,
  DUPLICATE_WINDOW_MS,
  dedupeMatches,
  expectedScore,
  matchHash,
  normalizeMatchForStorage,
  normalizedOutcomeScore,
  expectedFieldScore,
  participantWeightForMatchSize,
  matchRecencyWeightForIndex,
  recencyWeightForMatch,
  replayPlackettLuceGpi,
  replayNormalizedPlacementElo,
  playersFromMatch,
  replayElo,
  resultSignature,
  validateDescendingMatches,
};
