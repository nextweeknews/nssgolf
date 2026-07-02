"use strict";

const assert = require("node:assert/strict");
const {
  addTwoColumnIdentity,
  buildLightningMatchesFromRows,
  createExternalIdentity,
  externalDiscordIdForName,
  normalizeAliasKey,
  normalizeDiscordId,
  parseSuperLeagueScheduleRows,
  resolveIdentity,
  superLeagueDiscordIdsRange,
  winnerFromHigherScore,
  winnerFromLowerScore,
} = require("./tournament-gpi");

const identityMap = {
  exact: new Map([
    ["Alice", { discordUserId: "100", displayName: "Alice", source: "test" }],
    ["Bob", { discordUserId: "200", displayName: "Bob", source: "test" }],
  ]),
  key: new Map([
    ["alice", { discordUserId: "100", displayName: "Alice", source: "test" }],
    ["bob", { discordUserId: "200", displayName: "Bob", source: "test" }],
  ]),
  ambiguousKeys: new Set(),
};

{
  assert.equal(superLeagueDiscordIdsRange, "A:B");
  assert.equal(normalizeDiscordId("<@!123456789012345678>"), "123456789012345678");
  assert.equal(normalizeDiscordId("123456789012345678"), "123456789012345678");
  assert.equal(normalizeDiscordId("abc123def"), "");
  assert.equal(normalizeDiscordId("Dylan3594"), "");
  assert.equal(normalizeAliasKey(" Alice Smith! "), "alicesmith");
}

{
  const sheetIdentityMap = { exact: new Map(), key: new Map(), ambiguousKeys: new Set() };
  addTwoColumnIdentity(
    sheetIdentityMap,
    ["Dylan3594", "123456789012345678"],
    "test_discord_ids"
  );
  addTwoColumnIdentity(
    sheetIdentityMap,
    ["987654321098765432", "alexcat27"],
    "test_discord_ids"
  );

  assert.equal(resolveIdentity(sheetIdentityMap, "Dylan3594")?.discordUserId, "123456789012345678");
  assert.equal(resolveIdentity(sheetIdentityMap, "alexcat27")?.discordUserId, "987654321098765432");
}

{
  assert.equal(externalDiscordIdForName("Mr. E"), externalDiscordIdForName("Mr. E"));
  assert.match(externalDiscordIdForName("Mr. E"), /^9[0-9]{18}$/);
  assert.equal(createExternalIdentity("Mr. E")?.source, "external_tournament_placeholder");
}

{
  assert.equal(winnerFromHigherScore("10", "8"), "a");
  assert.equal(winnerFromHigherScore("8", "10"), "b");
  assert.equal(winnerFromHigherScore("8", "8"), "");
  assert.equal(winnerFromLowerScore("-3", "-1"), "a");
  assert.equal(winnerFromLowerScore("+2", "0"), "b");
}

{
  const rows = [[
    "1",
    "Division 1",
    "",
    "Alice",
    "-3",
    "-2",
    "",
    "2",
    "",
    "",
    "W",
    "",
    "Bob",
    "-1",
    "-4",
    "",
    "1",
    "",
    "",
    "L",
  ]];

  const parsed = parseSuperLeagueScheduleRows(
    rows,
    { key: "super_league_s5", name: "Super League Season 5" },
    0,
    identityMap,
    0
  );

  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.matches[0].winner_discord_user_id, "100");
  assert.equal(parsed.matches[0].raw_match.results[0].players[0].player_id, "100");
}

{
  const parsed = parseSuperLeagueScheduleRows(
    [[
      "1",
      "Division 1",
      "",
      "Alice",
      "",
      "",
      "",
      "2",
      "",
      "",
      "W",
      "",
      "Unmapped Player",
      "",
      "",
      "",
      "1",
      "",
      "",
      "L",
    ]],
    { key: "super_league_s5", name: "Super League Season 5" },
    0,
    identityMap,
    0
  );

  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0].reason, /placeholder identity used/);
  assert.match(parsed.matches[0].player_b_discord_user_id, /^9[0-9]{18}$/);
}

{
  const matches = buildLightningMatchesFromRows([
    ["id", "round", "region", "top seed", "top", "top score", "bottom seed", "bottom", "bottom score", "winner"],
    [1, "R64", 1, 1, "Alice", "2", 64, "Bob", "0", "Alice"],
    ["bad", "R64", 1, 1, "Nope", "2", 64, "Nobody", "0", "Nope"],
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 1);
  assert.equal(matches[0].winner, "Alice");
}

console.log("tournament GPI tests passed");
