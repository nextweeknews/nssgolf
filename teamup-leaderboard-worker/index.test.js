const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const test = require("node:test");

const workerSource = readFileSync(`${__dirname}/index.js`, "utf8");
const id = "123456789";
const game = (timestamp, matches, elo = 1200) => ({ timestamp, results: [{ place: 1, players: [{ player_id: id, old_elo: elo - 10, new_elo: elo, matches }] }] });

function setup(count, pages) {
  const cache = new Map();
  const calls = [];
  const snapshot = () => cache.set("leaderboard_snapshot", JSON.stringify({ requested_leaderboard: "season-14", data: { entries: [{ player_id: id, matches: count }] } }));
  snapshot();
  const context = {
    Response, URLSearchParams, URL, console: {log() {}}, addEventListener() {},
    TEAMUP_CLIENT_ID: "TEST", TEAMUP_API_KEY: "synthetic-test-key",
    DEFAULT_LEADERBOARD: "season-14", KV_KEY_LEADERBOARD: "leaderboard_snapshot", TEAMUP_CACHE: {
      get: async key => cache.get(key) ?? null,
      put: async (key, value) => cache.set(key, value)
    },
    errorResponse: (error, status) => new Response(JSON.stringify({ error }), { status }),
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
    getClientBasePath: () => "/v1/client/TEST",
    buildQuery: params => "?" + new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "")),
    fetch: async path => { calls.push(path); return new Response(JSON.stringify(pages.shift())); }
  };
  const vm = { ...context, URL };
  runInNewContext(workerSource, vm);
  return {
    calls, cache, pages,
    setCount(value) { count = value; snapshot(); },
    request: (body = { player_id: id }) => vm.handleRequest(new Request("https://worker.example/get_player_history", { method: "POST", body: JSON.stringify(body) }))
  };
}

test("history paginates, caches across reloads, and fetches only new matches", async () => {
  const worker = setup(2, [{ matches: [game(200,2)], cursor: "older" }, { matches: [game(100,1)] }]);
  let response = await worker.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual((await response.json()).matches.map(match => match.timestamp), [200,100]);
  assert.equal(worker.calls.length, 2);
  assert.match(worker.calls[0], /player=123456789/);
  assert.doesNotMatch(worker.calls[0], /player_id|\/global/);
  await worker.request();
  assert.equal(worker.calls.length, 2);
  worker.setCount(3);
  worker.pages.push({ matches: [game(300,3),game(200,2)], cursor: "older-again" });
  response = await worker.request();
  assert.deepEqual((await response.json()).matches.map(match => match.timestamp), [300,200,100]);
  assert.equal(worker.calls.length, 3);
  worker.setCount(2);
  worker.pages.push({ matches: [game(200,2),game(100,1)] });
  assert.deepEqual((await (await worker.request()).json()).matches.map(match => match.timestamp), [200,100]);
});

test("untrusted requests and unknown players cannot trigger upstream fetches", async () => {
  const worker = setup(1, []);
  for (const body of [null, {}, {player_id:123}, {player_id:"../../other"}, {player_id:id,leaderboard:"other"}, {player_id:id,format:"2v2"}]) {
    assert.equal((await worker.request(body)).status, 400);
  }
  assert.equal((await worker.request({player_id:"999"})).status, 404);
  assert.equal(worker.calls.length, 0);
});

test("lagging history and upstream failures preserve the last good cache and retry", async () => {
  const worker = setup(1, [{matches:[game(100,1)]}]);
  await worker.request();
  worker.setCount(2);
  worker.pages.push({matches:[game(100,1)]});
  assert.equal((await worker.request()).status, 409);
  worker.pages.push({unexpected:true});
  assert.equal((await worker.request()).status, 502);
  worker.pages.push({matches:[game(200,2),game(100,1)]});
  assert.equal((await worker.request()).status, 200);
  assert.equal((await worker.request()).status, 200);
  assert.equal(worker.calls.length, 4);
});

test("zero matches require no TeamUp call; repeated cursors fail visibly", async () => {
  const empty = setup(0, []);
  assert.deepEqual((await (await empty.request()).json()).matches, []);
  assert.equal(empty.calls.length, 0);
  const looping = setup(2, [{matches:[game(200,2)],cursor:"repeat"},{matches:[game(100,1)],cursor:"repeat"}]);
  assert.equal((await looping.request()).status, 502);
});
