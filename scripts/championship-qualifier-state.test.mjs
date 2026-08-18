import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { recoverTournamentVisibility } from "../championship-qualifier-state.mjs";

test("recovers when every scored tournament player was persisted as hidden", () => {
  const result = recoverTournamentVisibility(
    ["id:1", "id:2", "name:stale-player"],
    ["id:1", "id:2"],
  );

  assert.equal(result.recovered, true);
  assert.deepEqual([...result.hiddenPlayerKeys], ["name:stale-player"]);
});

test("preserves intentional hidden-player settings while any scored player remains visible", () => {
  const result = recoverTournamentVisibility(["id:1"], ["id:1", "id:2"]);

  assert.equal(result.recovered, false);
  assert.deepEqual([...result.hiddenPlayerKeys], ["id:1"]);
});

test("does not change hidden-player settings before tournament results load", () => {
  const result = recoverTournamentVisibility(["id:1"], []);

  assert.equal(result.recovered, false);
  assert.deepEqual([...result.hiddenPlayerKeys], ["id:1"]);
});

test("World Cup data requests bypass browser caches", async () => {
  const source = await readFile(new URL("../worldcup-data.js", import.meta.url), "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const worldCupData = await import(moduleUrl);
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url:String(url), options });
    return new Response(JSON.stringify({ values:[["ROSTERS"]] }), {
      status:200,
      headers:{ "Content-Type":"application/json" },
    });
  };

  try{
    const values = await worldCupData.fetchWorldCupValues(2025);
    assert.deepEqual(values, [["ROSTERS"]]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.cache, "no-store");
  }finally{
    globalThis.fetch = originalFetch;
  }
});
