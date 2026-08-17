import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mastersPath = new URL("../masters.html", import.meta.url);

function element(){
  return {
    className:"",
    dataset:{},
    hidden:false,
    innerHTML:"",
    textContent:"",
  };
}

test("Masters keeps sheet results visible when member enrichment fails", async () => {
  const html = await readFile(mastersPath, "utf8");
  const scripts = [...html.matchAll(/<script type="module"(?:\s+src="[^"]+")?>([\s\S]*?)<\/script>/g)];
  const source = scripts.at(-1)?.[1] || "";

  assert.match(source, /from "\/auth\/supabase-auth\.js\?v=20260817-singleton"/);

  const ids = [
    "qualifiersStatus",
    "defendingChampionMount",
    "qualifiersTableWrap",
    "qualifiersTableBody",
    "qualifiersPanel",
    "bracketPanel",
    "qualifierTournamentBracketGrid",
    "mastersBracketGrid",
  ];
  const elements = new Map(ids.map(id => [id, element()]));
  const document = {
    getElementById:id => elements.get(id) || null,
    querySelectorAll:() => [],
  };
  const window = {
    addEventListener:() => {},
    history:{ pushState:() => {}, replaceState:() => {} },
    location:{
      hash:"",
      href:"https://nssgolf.com/masters?view=bracket",
      pathname:"/masters",
      search:"?view=bracket",
    },
  };
  const ranges = {
    "'Qualifiers'!A:T":[
      ["ID", "Name", "Qualifications"],
      ["12345", "Player", "Ranked"],
    ],
    "'Bracket'!A1:R16":[
      ["Round", "Player 1", "1", "2", "3", "4", "5", "SD", "Score", "Player 2", "1", "2", "3", "4", "5", "SD", "Score", "Winner"],
      ["R16", "Hunter", "-10", "", "", "", "", "", "1", "Jonas", "-9", "", "", "", "", "", "0", "Hunter"],
    ],
    "'Discord IDs'!A:B":[["Hunter", "77777"], ["Jonas", "88888"]],
  };
  const fetch = async (_url, options) => {
    const range = JSON.parse(options.body).range;
    return { ok:true, json:async () => ({ values:ranges[range] }) };
  };
  const warnings = [];
  const testConsole = {
    error:() => {},
    warn:(...args) => warnings.push(args),
  };
  const createBrowserSupabaseClient = () => ({
    from:() => ({
      select(){ return this; },
      async in(){ return { data:null, error:new Error("member lookup unavailable") }; },
    }),
  });
  const runnableSource = source.replace(/^\s*import[^;]+;\s*/m, "");
  const run = new Function("document", "window", "fetch", "console", "createBrowserSupabaseClient", runnableSource);

  run(document, window, fetch, testConsole, createBrowserSupabaseClient);
  for(let attempt = 0; attempt < 10 && !elements.get("mastersBracketGrid").innerHTML.includes("Hunter"); attempt += 1){
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  assert.match(elements.get("mastersBracketGrid").innerHTML, /Hunter/);
  assert.equal(elements.get("bracketPanel").hidden, false);
  assert.equal(warnings.length, 1);
});
