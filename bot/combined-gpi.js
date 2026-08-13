"use strict";

const DEFAULT_BASE_RATING = 1200;
const MIN_RANKED_MATCHES = 25;
const MIN_TOURNAMENT_MATCHES = 3;
const FULL_DELTA_MATCHES = 10;
const TANH_SCALE = 1.5;
const POSITIVE_SCALE = 120;
const NEGATIVE_SCALE = 60;
const PROVISIONAL_TOURNAMENT_WEIGHT = 0.75;
const PROVISIONAL_SOS_WEIGHT = 0.25;
const TOURNAMENT_DISTRIBUTION_SCALE = 1.5;
const TOURNAMENT_SHRINKAGE_WEIGHTED_MATCHES = 20;
const NEGATIVE_EVIDENCE_FULL_UPSET_LOSSES = 2;
const NEGATIVE_EVIDENCE_MIN_UPSET_LOSS = 1;
const HISTORICAL_WIN_CURVE = [
  { delta: 0, probability: 0.5 },
  { delta: 25, probability: 0.5 },
  { delta: 50, probability: 0.565 },
  { delta: 75, probability: 0.599 },
  { delta: 100, probability: 0.635 },
  { delta: 150, probability: 0.676 },
  { delta: 200, probability: 0.745 },
  { delta: 300, probability: 0.827 },
  { delta: 400, probability: 0.928 },
];

function normalizeDiscordId(value) {
  const clean = String(value || "").trim();
  return /^[0-9]+$/.test(clean) ? clean : "";
}

function numericStats(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return { mean: 0, std: 1 };
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance = clean.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / clean.length;
  const std = Math.sqrt(variance);
  return { mean, std: std > 0 ? std : 1 };
}

function zScore(value, stats) {
  return (Number(value) - stats.mean) / stats.std;
}

function normalizeRatingToStats(value, sourceStats, targetStats) {
  return targetStats.mean + (zScore(value, sourceStats) * targetStats.std);
}

function tournamentBaseRating(run) {
  const value = Number(run?.base_rating);
  return Number.isFinite(value) ? value : DEFAULT_BASE_RATING;
}

function tournamentFittedRating(row) {
  const raw = Number(row?.raw_rating);
  if (Number.isFinite(raw)) return raw;
  const rating = Number(row?.rating);
  return Number.isFinite(rating) ? rating : 0;
}

function tournamentDistributionRating(row, run) {
  const fitted = tournamentFittedRating(row);
  const reliability = Math.min(
    1,
    Math.max(0, (Number(row?.weighted_matches) || 0) / TOURNAMENT_SHRINKAGE_WEIGHTED_MATCHES)
  );
  const base = tournamentBaseRating(run);
  return base + (reliability * (fitted - base));
}

function scaleTournamentRating(value, run) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  const base = tournamentBaseRating(run);
  return base + ((rating - base) * TOURNAMENT_DISTRIBUTION_SCALE);
}

function deltaConfidence(matchesPlayed) {
  const progress = Math.min(1, Math.max(0, (Number(matchesPlayed) || 0) / FULL_DELTA_MATCHES));
  return progress * progress * (3 - (2 * progress));
}

function adjustmentFromDelta(deltaZ, reliability) {
  const scale = deltaZ >= 0 ? POSITIVE_SCALE : NEGATIVE_SCALE;
  return reliability * scale * Math.tanh(deltaZ / TANH_SCALE);
}

function probabilityLogit(probability) {
  const value = Math.max(0.000001, Math.min(0.999999, Number(probability)));
  return Math.log(value / (1 - value));
}

function probabilityFromLogit(logit) {
  return 1 / (1 + Math.exp(-logit));
}

function calibratedFavoriteProbability(delta) {
  const cleanDelta = Math.max(0, Math.abs(Number(delta) || 0));
  if (cleanDelta <= HISTORICAL_WIN_CURVE[0].delta) return HISTORICAL_WIN_CURVE[0].probability;
  for (let index = 1; index < HISTORICAL_WIN_CURVE.length; index += 1) {
    const previous = HISTORICAL_WIN_CURVE[index - 1];
    const next = HISTORICAL_WIN_CURVE[index];
    if (cleanDelta <= next.delta) {
      const progress = (cleanDelta - previous.delta) / (next.delta - previous.delta);
      return previous.probability + ((next.probability - previous.probability) * progress);
    }
  }
  const previous = HISTORICAL_WIN_CURVE[HISTORICAL_WIN_CURVE.length - 2];
  const last = HISTORICAL_WIN_CURVE[HISTORICAL_WIN_CURVE.length - 1];
  const slope =
    (probabilityLogit(last.probability) - probabilityLogit(previous.probability)) /
    (last.delta - previous.delta);
  return probabilityFromLogit(probabilityLogit(last.probability) + (slope * (cleanDelta - last.delta)));
}

function tournamentWinProbability(leftRating, rightRating) {
  const left = Number(leftRating);
  const right = Number(rightRating);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0.5;
  const favorite = calibratedFavoriteProbability(left - right);
  return left >= right ? favorite : 1 - favorite;
}

function buildTournamentStrength(tournamentRatings, tournamentMatches, tournamentRun) {
  const ratingById = new Map(
    tournamentRatings
      .map((row) => [normalizeDiscordId(row.discord_user_id), tournamentDistributionRating(row, tournamentRun)])
      .filter(([discordId, rating]) => discordId && Number.isFinite(rating))
  );
  const schedules = new Map();
  const add = (discordId, opponentRating) => {
    if (!discordId || !Number.isFinite(opponentRating)) return;
    const current = schedules.get(discordId) || { total: 0, count: 0 };
    current.total += opponentRating;
    current.count += 1;
    schedules.set(discordId, current);
  };
  for (const match of tournamentMatches || []) {
    const playerA = normalizeDiscordId(match.player_a_discord_user_id);
    const playerB = normalizeDiscordId(match.player_b_discord_user_id);
    add(playerA, ratingById.get(playerB));
    add(playerB, ratingById.get(playerA));
  }
  return new Map([...schedules.entries()].map(([id, value]) => [
    id,
    value.count ? value.total / value.count : null,
  ]));
}

function buildNegativeEvidence(tournamentRatings, tournamentMatches) {
  const ratingById = new Map(
    tournamentRatings
      .map((row) => [normalizeDiscordId(row.discord_user_id), tournamentFittedRating(row)])
      .filter(([discordId, rating]) => discordId && Number.isFinite(rating))
  );
  const evidenceById = new Map();
  for (const match of tournamentMatches || []) {
    const playerA = normalizeDiscordId(match.player_a_discord_user_id);
    const playerB = normalizeDiscordId(match.player_b_discord_user_id);
    const winner = normalizeDiscordId(match.winner_discord_user_id);
    const loser = winner === playerA ? playerB : winner === playerB ? playerA : "";
    if (!loser) continue;
    const expectedWin = tournamentWinProbability(ratingById.get(loser), ratingById.get(winner));
    if (expectedWin <= 0.5) continue;
    const evidence = NEGATIVE_EVIDENCE_MIN_UPSET_LOSS + ((expectedWin - 0.5) * 2);
    evidenceById.set(loser, (evidenceById.get(loser) || 0) + evidence);
  }
  return new Map([...evidenceById.entries()].map(([id, evidence]) => [
    id,
    Math.min(1, Math.max(0, evidence / NEGATIVE_EVIDENCE_FULL_UPSET_LOSSES)),
  ]));
}

function buildCombinedGpiRatings({ rankedRatings, tournamentRatings, tournamentMatches, tournamentRun }) {
  const tournamentById = new Map(
    tournamentRatings
      .map((row) => [normalizeDiscordId(row.discord_user_id), row])
      .filter(([discordId]) => discordId)
  );
  const rankedRows = rankedRatings
    .map((row) => ({
      row,
      discordId: normalizeDiscordId(row.discord_user_id),
      rankedRating: Number(row.rating) || 0,
      rankedMatches: Number(row.matches_played) || 0,
      tournamentRow: tournamentById.get(normalizeDiscordId(row.discord_user_id)) || null,
    }))
    .filter((row) => row.discordId && row.rankedMatches >= MIN_RANKED_MATCHES);
  const rankedIds = new Set(rankedRows.map((row) => row.discordId));
  const bridgeRows = rankedRows.filter((row) =>
    row.tournamentRow && (Number(row.tournamentRow.matches_played) || 0) >= MIN_TOURNAMENT_MATCHES
  );
  const rankedStats = numericStats(bridgeRows.map((row) => row.rankedRating));
  const tournamentStats = numericStats(
    bridgeRows.map((row) => tournamentDistributionRating(row.tournamentRow, tournamentRun))
  );
  const tournamentStrength = buildTournamentStrength(tournamentRatings, tournamentMatches, tournamentRun);
  const negativeEvidence = buildNegativeEvidence(tournamentRatings, tournamentMatches);
  const hasBridge = bridgeRows.length >= 2;

  const rows = rankedRows.map((item) => {
    const tournamentRow = item.tournamentRow;
    const tournamentMatchesPlayed = Number(tournamentRow?.matches_played) || 0;
    const tournamentWeightedMatches = Number(tournamentRow?.weighted_matches) || 0;
    let tournamentRating = null;
    let tournamentDelta = 0;
    let tournamentReliability = 0;
    if (hasBridge && tournamentRow && tournamentMatchesPlayed >= MIN_TOURNAMENT_MATCHES) {
      tournamentRating = tournamentFittedRating(tournamentRow);
      tournamentReliability = deltaConfidence(tournamentMatchesPlayed);
      const deltaZ = zScore(tournamentRating, tournamentStats) - zScore(item.rankedRating, rankedStats);
      const ungatedDelta = adjustmentFromDelta(deltaZ, tournamentReliability);
      tournamentDelta = ungatedDelta < 0
        ? ungatedDelta * (negativeEvidence.get(item.discordId) || 0)
        : ungatedDelta;
    }
    return {
      discord_user_id: item.discordId,
      display_name: item.row.display_name,
      rating: item.rankedRating + tournamentDelta,
      ranked_rating: item.rankedRating,
      ranked_provisional: false,
      ranked_matches: item.rankedMatches,
      tournament_delta: tournamentDelta,
      tournament_rating: scaleTournamentRating(tournamentRating, tournamentRun),
      tournament_strength: scaleTournamentRating(tournamentStrength.get(item.discordId), tournamentRun),
      tournament_reliability: tournamentReliability,
      tournament_matches: tournamentMatchesPlayed,
      tournament_weighted_matches: tournamentWeightedMatches,
    };
  });

  for (const tournamentRow of tournamentRatings) {
    const discordId = normalizeDiscordId(tournamentRow.discord_user_id);
    const tournamentMatchesPlayed = Number(tournamentRow.matches_played) || 0;
    if (!discordId || rankedIds.has(discordId) || tournamentMatchesPlayed < MIN_TOURNAMENT_MATCHES) continue;
    const fittedRating = tournamentFittedRating(tournamentRow);
    const strength = tournamentStrength.get(discordId);
    const normalizedRating = hasBridge
      ? normalizeRatingToStats(fittedRating, tournamentStats, rankedStats)
      : fittedRating;
    const normalizedStrength = Number.isFinite(strength)
      ? (hasBridge ? normalizeRatingToStats(strength, tournamentStats, rankedStats) : strength)
      : normalizedRating;
    const provisionalRating =
      (PROVISIONAL_TOURNAMENT_WEIGHT * normalizedRating) +
      (PROVISIONAL_SOS_WEIGHT * normalizedStrength);
    rows.push({
      discord_user_id: discordId,
      display_name: tournamentRow.display_name,
      rating: provisionalRating,
      ranked_rating: provisionalRating,
      ranked_provisional: true,
      ranked_matches: tournamentMatchesPlayed,
      tournament_delta: null,
      tournament_rating: scaleTournamentRating(fittedRating, tournamentRun),
      tournament_strength: scaleTournamentRating(strength, tournamentRun),
      tournament_reliability: deltaConfidence(tournamentMatchesPlayed),
      tournament_matches: tournamentMatchesPlayed,
      tournament_weighted_matches: Number(tournamentRow.weighted_matches) || 0,
    });
  }

  rows.sort((left, right) =>
    right.rating - left.rating ||
    right.ranked_rating - left.ranked_rating ||
    String(left.display_name || left.discord_user_id).localeCompare(String(right.display_name || right.discord_user_id))
  );
  rows.forEach((row, index) => { row.rank = index + 1; });
  return rows;
}

module.exports = { buildCombinedGpiRatings };
