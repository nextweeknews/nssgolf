const TEAMUP_CLIENT_ID = "DISCORD|1069003073311211601";
const TEAMUP_API_BASE = "https://api.teamupgg.com/v1/client";
const ALLOWED_SEASONS = new Set([9, 10, 11]);

function asTrimmedString(value){
  return typeof value === "string" ? value.trim() : "";
}

function parseSeason(value){
  const parsed = Number(value);
  if(!Number.isInteger(parsed) || !ALLOWED_SEASONS.has(parsed)) return null;
  return parsed;
}

function parseCount(value){
  const parsed = Number(value);
  if(!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function json(body, status = 200, extraHeaders = {}){
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function buildEmptySeasonPayload(season){
  return {
    season,
    playerAWins: null,
    playerBWins: null,
    ties: null,
  };
}

function buildSeasonPayload(payload, season){
  const playerAWins = parseCount(payload?.player_a_wins);
  const playerBWins = parseCount(payload?.player_b_wins);
  const ties = parseCount(payload?.ties);
  if(playerAWins == null || playerBWins == null || ties == null){
    return buildEmptySeasonPayload(season);
  }
  return {
    season,
    playerAWins,
    playerBWins,
    ties,
  };
}

export async function onRequestGet(context){
  const apiKey = asTrimmedString(context.env?.NSSGOLF_TEAMUP_API_KEY);
  if(!apiKey){
    return json({ error: "Missing Team Up API key." }, 500);
  }

  const requestUrl = new URL(context.request.url);
  const playerA = asTrimmedString(requestUrl.searchParams.get("player_a"));
  const playerB = asTrimmedString(requestUrl.searchParams.get("player_b"));
  const season = parseSeason(requestUrl.searchParams.get("season"));

  if(!playerA || !playerB || season == null){
    return json({ error: "Expected player_a, player_b, and season=9|10|11." }, 400);
  }

  const leaderboard = `Season_${season}`;
  const upstreamUrl = new URL(`${TEAMUP_API_BASE}/${encodeURIComponent(TEAMUP_CLIENT_ID)}/players/head-to-head`);
  upstreamUrl.searchParams.set("player_a", playerA);
  upstreamUrl.searchParams.set("player_b", playerB);
  upstreamUrl.searchParams.set("leaderboard", leaderboard);

  let upstreamResponse;
  try{
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
    });
  }catch{
    return json({ error: "Team Up request failed." }, 502);
  }

  if(upstreamResponse.status === 404){
    return json(buildEmptySeasonPayload(season), 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
    });
  }

  if(!upstreamResponse.ok){
    return json({ error: `Team Up request failed (${upstreamResponse.status}).` }, upstreamResponse.status >= 500 ? 502 : upstreamResponse.status);
  }

  let payload = null;
  try{
    payload = await upstreamResponse.json();
  }catch{
    payload = null;
  }

  return json(buildSeasonPayload(payload, season), 200, {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
  });
}
