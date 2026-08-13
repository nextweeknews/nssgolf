"use strict";

const assert = require("node:assert/strict");
const { fetchPlanForCurrentSeason, fetchSeason } = require("./internal-ranked");

function match(timestamp, winnerId = "100", loserId = "200") {
  return {
    timestamp,
    versus: "1v1",
    team_sizes: [1, 1],
    results: [
      { place: 1, players: [{ player_id: winnerId, display_name: `Player ${winnerId}` }] },
      { place: 2, players: [{ player_id: loserId, display_name: `Player ${loserId}` }] },
    ],
  };
}

(async () => {
  assert.deepEqual(fetchPlanForCurrentSeason(13, null, null), [{ season: 13 }]);
  assert.deepEqual(fetchPlanForCurrentSeason(13, { timestamp_ms: 123 }, null), [
    { season: 13, newerThanTimestampMs: 123 },
  ]);
  assert.deepEqual(fetchPlanForCurrentSeason(13, null, [9, 13]), [
    { season: 9 },
    { season: 13 },
  ]);

  const originalFetch = global.fetch;
  const requestedCursors = [];
  const pages = [
    { matches: [match(300, "101", "201"), match(250, "102", "202")], cursor: "older-page", total_matches: 4 },
    { matches: [match(200, "103", "203"), match(150, "104", "204")], cursor: "should-not-be-requested", total_matches: 4 },
  ];

  global.fetch = async (url) => {
    requestedCursors.push(new URL(url).searchParams.get("cursor") || "");
    const page = pages.shift();
    assert(page, "Incremental fetch should stop at the stored-match boundary.");
    return { ok: true, json: async () => page };
  };

  try {
    const result = await fetchSeason(
      13,
      { limit: 2, maxPages: 0, allowIncomplete: false },
      async () => {},
      { newerThanTimestampMs: 200 }
    );

    assert.deepEqual(requestedCursors, ["", "older-page"]);
    assert.equal(result.fetchedCount, 2);
    assert.deepEqual(result.valid.map((row) => row.timestamp_ms), [250, 300]);
  } finally {
    global.fetch = originalFetch;
  }

  console.log("internal ranked incremental fetch tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
