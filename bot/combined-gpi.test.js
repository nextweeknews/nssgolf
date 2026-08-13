"use strict";

const assert = require("node:assert/strict");
const { buildCombinedGpiRatings } = require("./combined-gpi");

const rows = buildCombinedGpiRatings({
  rankedRatings: [
    { discord_user_id: "1", display_name: "One", rating: 1300, matches_played: 30 },
    { discord_user_id: "2", display_name: "Two", rating: 1200, matches_played: 30 },
  ],
  tournamentRatings: [
    { discord_user_id: "1", display_name: "One", rating: 1350, raw_rating: 1350, matches_played: 10, weighted_matches: 20 },
    { discord_user_id: "2", display_name: "Two", rating: 1150, raw_rating: 1150, matches_played: 10, weighted_matches: 20 },
    { discord_user_id: "3", display_name: "Three", rating: 1250, raw_rating: 1250, matches_played: 3, weighted_matches: 6 },
  ],
  tournamentMatches: [
    { player_a_discord_user_id: "1", player_b_discord_user_id: "2", winner_discord_user_id: "1" },
  ],
  tournamentRun: { base_rating: 1200 },
});

assert.deepEqual(rows.map((row) => row.rank), [1, 2, 3]);
assert.equal(rows.find((row) => row.discord_user_id === "3").ranked_provisional, true);
assert(rows.every((row) => Number.isFinite(row.rating)));
console.log("combined GPI snapshot tests passed");
