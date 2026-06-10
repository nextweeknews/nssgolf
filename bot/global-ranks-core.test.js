"use strict";

const assert = require("node:assert/strict");
const {
  applyRankUpdate,
  normalizeRankInput,
} = require("./global-ranks-core");

assert.equal(normalizeRankInput("inf3"), "∞3");
assert.equal(normalizeRankInput("INF 03"), "∞3");
assert.equal(normalizeRankInput("∞ 4"), "∞4");
assert.equal(normalizeRankInput("< a20"), "<A20");
assert.equal(normalizeRankInput("s9"), "S9");

assert.equal(normalizeRankInput("inf16", [
  "<A20",
  "A21",
  "S9",
  "∞15",
]), "");

{
  const result = applyRankUpdate(
    {
      current_global_rank: null,
      max_global_rank_no_cs: null,
      max_global_rank_cs: null,
    },
    "rank_no_cs",
    "S5"
  );

  assert.equal(result.settings.current_global_rank, "S5");
  assert.equal(result.settings.max_global_rank_no_cs, "S5");
  assert.deepEqual(
    result.changes.map((change) => change.field),
    ["current_global_rank", "max_global_rank_no_cs"]
  );
}

{
  const result = applyRankUpdate(
    {
      current_global_rank: "S5",
      max_global_rank_no_cs: "S7",
      max_global_rank_cs: "∞3",
    },
    "rank_cs",
    "S8"
  );

  assert.equal(result.settings.current_global_rank, "S8");
  assert.equal(result.settings.max_global_rank_cs, "∞3");
  assert.deepEqual(
    result.changes.map((change) => change.field),
    ["current_global_rank"]
  );
}

assert.throws(
  () =>
    applyRankUpdate(
      {
        current_global_rank: "S5",
        max_global_rank_no_cs: "S7",
        max_global_rank_cs: "S8",
      },
      "max_cs",
      "S9"
    ),
  /Current rank cannot be below both max rank values/
);

assert.throws(
  () =>
    applyRankUpdate(
      {
        current_global_rank: null,
        max_global_rank_no_cs: null,
        max_global_rank_cs: null,
      },
      "rank_no_cs",
      "inf16"
    ),
  /Use a valid rank/
);

console.log("global rank core tests passed");
