"use strict";

const assert = require("node:assert/strict");
const {
  dedupeMatches,
  replayElo,
  resultSignature,
} = require("./internal-ranked-core");

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
  assert.equal(loser.pairwise_losses, 1);
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
