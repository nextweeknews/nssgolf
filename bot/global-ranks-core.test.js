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

{
  const result = applyRankUpdate(
    {
      current_global_rank: "S5",
      max_global_rank_no_cs: "S7",
      max_global_rank_cs: "S8",
    },
    "max_cs",
    "S9"
  );

  assert.equal(result.settings.current_global_rank, "S5");
  assert.equal(result.settings.max_global_rank_cs, "S9");
}

assert.throws(
  () =>
    applyRankUpdate(
      {
        current_global_rank: "S9",
        max_global_rank_no_cs: "S7",
        max_global_rank_cs: "S8",
      },
      "max_cs",
      "S6"
    ),
  /Current rank cannot be above both max rank values/
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

{
  const result = applyRankUpdate(
    {
      current_global_rank: "∞3",
      max_global_rank_no_cs: "S9",
      max_global_rank_cs: "∞3",
    },
    "rank_cs",
    "remove"
  );

  assert.equal(result.settings.current_global_rank, null);
  assert.equal(result.settings.max_global_rank_cs, "∞3");
  assert.deepEqual(result.changes, [
    {
      field: "current_global_rank",
      label: "Global rank (with CS)",
      rank: null,
      removed: true,
    },
  ]);
}

{
  const result = applyRankUpdate(
    {
      current_global_rank: "S7",
      max_global_rank_no_cs: "S9",
      max_global_rank_cs: "∞3",
    },
    "max_no_cs",
    "remove"
  );

  assert.equal(result.settings.max_global_rank_no_cs, null);
  assert.deepEqual(result.changes, [
    {
      field: "max_global_rank_no_cs",
      label: "Global max rank (no CS)",
      rank: null,
      removed: true,
    },
  ]);
}

{
  const result = applyRankUpdate(
    {
      current_global_rank: null,
      max_global_rank_no_cs: null,
      max_global_rank_cs: null,
    },
    "max_cs",
    "remove"
  );

  assert.deepEqual(result.changes, []);
}

console.log("global rank core tests passed");
