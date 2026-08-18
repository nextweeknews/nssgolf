import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { appendHiddenTournamentRows } from "../championship-qualifier-state.mjs";

test("appends scored hidden tournament players after visible rows for admins", () => {
  const visible = [{ name:"Visible", total:10, hidden:false, rank:1, rankLabel:"1", qualified:true }];
  const all = [
    { name:"Hidden", total:20, hidden:true, rank:1, rankLabel:"1" },
    ...visible,
    { name:"Unscored hidden", total:0, hidden:true, rank:3, rankLabel:"3" },
  ];

  assert.deepEqual(appendHiddenTournamentRows(visible, all, true), [
    visible[0],
    { name:"Hidden", total:20, hidden:true, rank:"", rankLabel:"", qualified:false },
  ]);
});

test("keeps hidden tournament rows out of the public list", () => {
  const visible = [{ name:"Visible", total:10 }];
  assert.equal(appendHiddenTournamentRows(visible, [{ name:"Hidden", total:20, hidden:true }], false), visible);
});

test("routes every player-hide control through the audited admin visibility RPC", async () => {
  const sources = await Promise.all([
    "../championship.html",
    "../gpi.html",
    "../records.html",
    "../player-profile.js",
  ].map(async path => readFile(new URL(path, import.meta.url), "utf8")));

  for(const source of sources){
    assert.match(source, /import \{ setAdminVisibility \}/);
    assert.match(source, /await setAdminVisibility\(supabase,/);
  }

  assert.match(sources[0], /surfaceKey:"championship-qualifiers"/);
  assert.match(sources[1], /surfaceKey:"gpi"/);
  assert.match(sources[2], /surfaceKey:"global-ranks"/);
  assert.match(sources[3], /surfaceKey:"global-ranks"/);
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
