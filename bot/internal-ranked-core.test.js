"use strict";

const assert = require("node:assert/strict");
const {
  dedupeMatches,
  matchRecencyWeightForIndex,
  recencyWeightForMatch,
  normalizedOutcomeScore,
  pairWeightForMatchSize,
  participantWeightForMatchSize,
  replayElo,
  replayNormalizedPlacementElo,
  replayOpponentAwareWeightedPairwiseGpi,
  replayPlackettLuceGpi,
  resultSignature,
} = require("./internal-ranked-core");

function assertAlmostEqual(actual, expected, tolerance = 0.0000001) {
  assert(Math.abs(actual - expected) <= tolerance, `${actual} !== ${expected}`);
}

function match(timestamp, results, versus = "1v1v1") {
  return {
    timestamp,
    versus,
    team_sizes: results.map((result) => result.players.length),
    results: results.map((result) => ({
      place: result.place,
      players: result.players.map((playerId) => ({
        player_id: playerId,
        display_name: `Player ${playerId}`,
        old_elo: 9999,
        new_elo: 1,
        delta: -123,
        matches: 42,
      })),
    })),
  };
}

{
  const first = match(1_000_000, [
    { place: 1, players: ["100"] },
    { place: 2, players: ["200"] },
  ], "1v1");
  const duplicateWithDifferentTeamUpRatings = match(1_060_000, [
    { place: 1, players: ["100"] },
    { place: 2, players: ["200"] },
  ], "1v1");
  duplicateWithDifferentTeamUpRatings.results[0].players[0].old_elo = 100;
  duplicateWithDifferentTeamUpRatings.results[0].players[0].new_elo = 140;

  assert.equal(resultSignature(first), resultSignature(duplicateWithDifferentTeamUpRatings));

  const { valid, duplicates } = dedupeMatches(7, [
    duplicateWithDifferentTeamUpRatings,
    first,
  ]);

  assert.equal(valid.length, 1);
  assert.equal(duplicates.length, 1);
  assert.equal(valid[0].timestamp_ms, 1_000_000);
  assert.equal(duplicates[0].reason, "exact_duplicate_within_2_minutes");
}

{
  const oldEnoughRepeat = match(1_130_001, [
    { place: 1, players: ["100"] },
    { place: 2, players: ["200"] },
  ], "1v1");
  const { valid, duplicates } = dedupeMatches(7, [
    match(1_000_000, [
      { place: 1, players: ["100"] },
      { place: 2, players: ["200"] },
    ], "1v1"),
    oldEnoughRepeat,
  ]);

  assert.equal(valid.length, 2);
  assert.equal(duplicates.length, 0);
}

{
  const clustered = [
    match(1_000_000, [
      { place: 1, players: ["100"] },
      { place: 2, players: ["200"] },
    ], "1v1"),
    match(1_060_000, [
      { place: 1, players: ["100"] },
      { place: 2, players: ["200"] },
    ], "1v1"),
    match(1_119_000, [
      { place: 1, players: ["100"] },
      { place: 2, players: ["200"] },
    ], "1v1"),
  ];

  const { valid, duplicates } = dedupeMatches(7, clustered);

  assert.equal(valid.length, 1);
  assert.equal(duplicates.length, 2);
  assert.equal(valid[0].timestamp_ms, 1_000_000);
  assert.equal(duplicates[1].kept_timestamp_ms, 1_000_000);
}

{
  assert.equal(matchRecencyWeightForIndex(9, 10), 1);
  assert(matchRecencyWeightForIndex(0, 10) < matchRecencyWeightForIndex(9, 10));
  assert.equal(
    recencyWeightForMatch({ timestamp_ms: 1_000 }, 1_000 + 1200 * 24 * 60 * 60 * 1000, 9, 10, "global"),
    1
  );
  assert.equal(
    recencyWeightForMatch({ timestamp_ms: 1_000 }, 1_000 + 1200 * 24 * 60 * 60 * 1000, 0, 10, "none"),
    1
  );
}

{
  const replay = replayPlackettLuceGpi([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    },
  ], {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
  });

  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");
  const loser = replay.finalRatings.find((row) => row.discord_user_id === "200");

  assert.equal(replay.finalRatings.length, 2);
  assert(winner.rating > 1200);
  assert(loser.rating < 1200);
  assert.equal(winner.rank, 1);
  assert.equal(winner.reliability, 0.1);
  assert.equal(winner.weighted_matches, 1);
  assertAlmostEqual(
    winner.rating,
    1200 + winner.reliability * (winner.raw_rating - 1200)
  );
}

{
  const rows = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let index = 0; index < 100; index += 1) {
    const timestamp = 1_000 + index * dayMs;
    rows.push({
      match_hash: `m${index}`,
      season: 7,
      timestamp_ms: timestamp,
      played_at: new Date(timestamp).toISOString(),
      raw_match: match(timestamp, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    });
  }

  const replay = replayPlackettLuceGpi(rows, {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
    recencyMode: "player",
  });
  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");

  assert.equal(winner.matches_played, 100);
  assert.equal(winner.reliability, 1);
  assert(winner.weighted_matches < winner.matches_played);
  assert(winner.rating > 1200);
}

{
  const rows = [];
  for (let index = 0; index < 20; index += 1) {
    rows.push({
      match_hash: `flat-default-${index}`,
      season: 7,
      timestamp_ms: 1_000 + index,
      played_at: new Date(1_000 + index).toISOString(),
      raw_match: match(1_000 + index, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    });
  }

  const replay = replayPlackettLuceGpi(rows, {
    baseRating: 1200,
    priorStrength: 20,
    maxIterations: 200,
  });
  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");

  assert.equal(replay.recencyMode, "none");
  assert.equal(winner.weighted_matches, winner.matches_played);
  assert.equal(winner.reliability, 20 / 50);
}

{
  const rows = [];
  for (let index = 0; index < 75; index += 1) {
    rows.push({
      match_hash: `full-reliability-${index}`,
      season: 7,
      timestamp_ms: 20_000 + index,
      played_at: new Date(20_000 + index).toISOString(),
      raw_match: match(20_000 + index, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    });
  }

  const replay = replayPlackettLuceGpi(rows, {
    baseRating: 1200,
    priorStrength: 20,
    maxIterations: 200,
  });
  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");

  assert.equal(winner.reliability, 1);
  assert.equal(winner.rating, winner.raw_rating);
}

{
  const rows = [];
  rows.push({
    match_hash: "inactive-elite",
    season: 7,
    timestamp_ms: 1_000,
    played_at: new Date(1_000).toISOString(),
    raw_match: match(1_000, [
      { place: 1, players: ["300"] },
      { place: 2, players: ["100"] },
    ], "1v1"),
  });
  for (let index = 0; index < 20; index += 1) {
    const timestamp = 10_000 + index;
    rows.push({
      match_hash: `active-${index}`,
      season: 7,
      timestamp_ms: timestamp,
      played_at: new Date(timestamp).toISOString(),
      raw_match: match(timestamp, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    });
  }

  const playerWeighted = replayPlackettLuceGpi(rows, {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
    recencyMode: "player",
  });
  const globalWeighted = replayPlackettLuceGpi(rows, {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
    recencyMode: "global",
  });

  const playerModeInactive = playerWeighted.finalRatings.find((row) => row.discord_user_id === "300");
  const globalModeInactive = globalWeighted.finalRatings.find((row) => row.discord_user_id === "300");

  assert(playerModeInactive.weighted_matches > globalModeInactive.weighted_matches);
}

{
  const replay = replayPlackettLuceGpi([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
        { place: 3, players: ["300"] },
      ]),
    },
  ], {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
    recencyMode: "none",
  });

  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");
  assertAlmostEqual(winner.weighted_matches, participantWeightForMatchSize(3, {
    participantWeightScale: 0.7,
    maxParticipantWeight: 3,
  }));
}

{
  const replay = replayPlackettLuceGpi([
    {
      match_hash: "double-weight-1",
      season: 1,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    },
  ], {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
    recencyMode: "none",
    participantWeightScale: 0,
    maxParticipantWeight: 1,
    matchWeightMultiplier: 2,
  });

  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");
  assert.equal(replay.matchWeightMultiplier, 2);
  assertAlmostEqual(winner.weighted_matches, 2);
  assertAlmostEqual(winner.average_match_weight, 2);
}

{
  const rows = [];
  for (let index = 0; index < 10; index += 1) {
    rows.push({
      match_hash: `weighted-reliability-${index}`,
      season: 1,
      timestamp_ms: 2_000 + index,
      played_at: new Date(2_000 + index).toISOString(),
      raw_match: match(2_000 + index, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    });
  }

  const replay = replayPlackettLuceGpi(rows, {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 20,
    maxIterations: 200,
    recencyMode: "none",
    participantWeightScale: 0,
    maxParticipantWeight: 1,
    matchWeightMultiplier: 2,
    reliabilityBasis: "weighted_matches",
  });

  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");
  assert.equal(replay.reliabilityBasis, "weighted_matches");
  assert.equal(winner.matches_played, 10);
  assertAlmostEqual(winner.weighted_matches, 20);
  assert.equal(winner.reliability, 1);
}

{
  const strongerWeighting = {
    participantWeightScale: 0.7,
    maxParticipantWeight: 3,
  };
  assert.equal(participantWeightForMatchSize(2), 1);
  assertAlmostEqual(participantWeightForMatchSize(3), 1.35);
  assertAlmostEqual(participantWeightForMatchSize(8, strongerWeighting), 1 + 0.7 * Math.log2(7));
  assertAlmostEqual(pairWeightForMatchSize(2), 1);
  assertAlmostEqual(pairWeightForMatchSize(3, strongerWeighting), 1.7 / 2);
  assertAlmostEqual(pairWeightForMatchSize(8, strongerWeighting), (1 + 0.7 * Math.log2(7)) / 7);
}

{
  const replay = replayOpponentAwareWeightedPairwiseGpi([
    {
      match_hash: "oawp-1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
        { place: 3, players: ["300"] },
      ]),
    },
  ], {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
  });

  const byPlayer = new Map(replay.finalRatings.map((row) => [row.discord_user_id, row]));

  assert(byPlayer.get("100").rating > byPlayer.get("200").rating);
  assert(byPlayer.get("200").rating > byPlayer.get("300").rating);
  assertAlmostEqual(byPlayer.get("100").weighted_matches, participantWeightForMatchSize(3, {
    participantWeightScale: 0.7,
    maxParticipantWeight: 3,
  }));
  assertAlmostEqual(
    byPlayer.get("100").rating,
    0.5 * byPlayer.get("100").full_history_rating +
      0.25 * byPlayer.get("100").potential_rating +
      0.25 * byPlayer.get("100").recent_form_rating
  );
  assert(Number.isFinite(byPlayer.get("100").full_history_rating));
  assert(Number.isFinite(byPlayer.get("100").potential_rating));
  assert(Number.isFinite(byPlayer.get("100").recent_form_rating));
  assert.equal(replay.recencyMode, "none");
}

{
  const rows = [];
  for (let index = 0; index < 120; index += 1) {
    rows.push({
      match_hash: `recent-${index}`,
      season: 7,
      timestamp_ms: 1_000 + index,
      played_at: new Date(1_000 + index).toISOString(),
      raw_match: match(1_000 + index, [
        { place: index < 20 ? 2 : 1, players: ["100"] },
        { place: index < 20 ? 1 : 2, players: ["200"] },
      ], "1v1"),
    });
  }
  for (let index = 0; index < 150; index += 1) {
    rows.push({
      match_hash: `unrelated-${index}`,
      season: 7,
      timestamp_ms: 2_000 + index,
      played_at: new Date(2_000 + index).toISOString(),
      raw_match: match(2_000 + index, [
        { place: index % 2 === 0 ? 1 : 2, players: ["300"] },
        { place: index % 2 === 0 ? 2 : 1, players: ["400"] },
      ], "1v1"),
    });
  }

  const replay = replayOpponentAwareWeightedPairwiseGpi(rows, {
    baseRating: 1200,
    priorStrength: 20,
    shrinkageMatches: 10,
    maxIterations: 200,
  });
  const player = replay.finalRatings.find((row) => row.discord_user_id === "100");
  assert(player.recent_form_rating > player.full_history_rating);
  assert(player.recent_form_rating > 1200);
  assert.equal(replay.recentFormMatchLimit, 100);
}

{
  const replay = replayNormalizedPlacementElo([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    },
  ], { baseRating: 1200, kFactor: 20 });

  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");
  const loser = replay.finalRatings.find((row) => row.discord_user_id === "200");

  assert.equal(winner.rating, 1210);
  assert.equal(loser.rating, 1190);
  assert.equal(winner.placement_score_average, 1);
  assert.equal(loser.placement_score_average, 0);
  assert.equal(replay.matchResults.length, 2);
  assert.deepEqual(
    replay.matchResults
      .filter((row) => row.discord_user_id === "100")
      .map((row) => [
        row.rating_before,
        row.rating_delta,
        row.rating_after,
        row.normalized_score,
        row.expected_score,
        row.participant_weight,
      ]),
    [[1200, 10, 1210, 1, 0.5, 1]]
  );
}

{
  const replay = replayNormalizedPlacementElo([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
        { place: 3, players: ["300"] },
      ]),
    },
  ], { baseRating: 1200, kFactor: 20 });

  const byPlayer = new Map(replay.finalRatings.map((row) => [row.discord_user_id, row]));

  assert.equal(byPlayer.get("100").rating, 1213.5);
  assert.equal(byPlayer.get("200").rating, 1200);
  assert.equal(byPlayer.get("300").rating, 1186.5);
  assert.equal(byPlayer.get("100").placement_score_average, 1);
  assert.equal(byPlayer.get("200").placement_score_average, 0.5);
  assert.equal(byPlayer.get("300").placement_score_average, 0);
}

{
  const replay = replayNormalizedPlacementElo([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100", "200"] },
        { place: 2, players: ["300"] },
      ]),
    },
  ], { baseRating: 1200, kFactor: 20 });

  const tiedFirst = replay.finalRatings
    .filter((row) => row.discord_user_id === "100" || row.discord_user_id === "200")
    .sort((left, right) => left.discord_user_id.localeCompare(right.discord_user_id));
  const third = replay.finalRatings.find((row) => row.discord_user_id === "300");

  assert.deepEqual(tiedFirst.map((row) => row.rating), [1206.75, 1206.75]);
  assert.deepEqual(tiedFirst.map((row) => row.placement_score_average), [0.75, 0.75]);
  assert.equal(third.rating, 1186.5);
}

{
  const players = [
    { discord_user_id: "100", place: 1 },
    { discord_user_id: "200", place: 1 },
    { discord_user_id: "300", place: 2 },
  ];

  assert.equal(normalizedOutcomeScore(players[0], players), 0.75);
  assert.equal(normalizedOutcomeScore(players[2], players), 0);
}

{
  const replay = replayElo([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
      ], "1v1"),
    },
  ], { baseRating: 1200, kFactor: 20 });

  const winner = replay.finalRatings.find((row) => row.discord_user_id === "100");
  const loser = replay.finalRatings.find((row) => row.discord_user_id === "200");

  assert.equal(winner.rating, 1210);
  assert.equal(loser.rating, 1190);
  assert.equal(winner.pairwise_wins, 1);
  assert.equal(winner.first_place_finishes, 1);
  assert.equal(winner.outcome_win_percentage, 1);
  assert.equal(winner.match_win_percentage, 1);
  assert.equal(loser.pairwise_losses, 1);
  assert.equal(loser.first_place_finishes, 0);
  assert.equal(loser.outcome_win_percentage, 0);
  assert.equal(loser.match_win_percentage, 0);
}

{
  const replay = replayElo([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100", "200"] },
        { place: 2, players: ["300"] },
      ]),
    },
  ], { baseRating: 1200, kFactor: 20 });

  const tiedFirst = replay.finalRatings
    .filter((row) => row.discord_user_id === "100" || row.discord_user_id === "200")
    .sort((left, right) => left.discord_user_id.localeCompare(right.discord_user_id));
  const third = replay.finalRatings.find((row) => row.discord_user_id === "300");

  assert.deepEqual(tiedFirst.map((row) => row.rating), [1210, 1210]);
  assert.equal(third.rating, 1180);
  assert.deepEqual(tiedFirst.map((row) => row.first_place_finishes), [1, 1]);
  assert.deepEqual(tiedFirst.map((row) => row.match_win_percentage), [1, 1]);
  assert.deepEqual(
    tiedFirst.map((row) => [row.pairwise_wins, row.pairwise_ties]),
    [[1, 1], [1, 1]]
  );
  assert.equal(third.pairwise_losses, 2);
}

{
  const replay = replayElo([
    {
      match_hash: "m1",
      season: 7,
      timestamp_ms: 1_000,
      played_at: new Date(1_000).toISOString(),
      raw_match: match(1_000, [
        { place: 1, players: ["100"] },
        { place: 2, players: ["200"] },
        { place: 3, players: ["300"] },
      ]),
    },
  ], { baseRating: 1200, kFactor: 20 });

  const byPlayer = new Map(replay.finalRatings.map((row) => [row.discord_user_id, row]));

  assert.equal(byPlayer.get("100").rating, 1220);
  assert.equal(byPlayer.get("200").rating, 1200);
  assert.equal(byPlayer.get("300").rating, 1180);
  assert.equal(byPlayer.get("100").pairwise_wins, 2);
  assert.equal(byPlayer.get("200").pairwise_wins, 1);
  assert.equal(byPlayer.get("200").pairwise_losses, 1);
  assert.equal(byPlayer.get("300").pairwise_losses, 2);
}

console.log("internal ranked core tests passed");
