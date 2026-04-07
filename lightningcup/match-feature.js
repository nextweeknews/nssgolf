export const MATCH_QUERY_PARAM = "matchId";
export const MATCH_PAGE_PATH = "/lightningcup/match/";
export const MATCH_REALTIME_CHANNEL_PREFIX = "lightningcup:match";

const ROUND_NUMBER = {
  R64: 1,
  R32: 2,
  R16: 3,
  R8: 4,
  R4: 5,
  Final: 6,
  final: 6,
};

const ROUND_LABEL_BY_CODE = {
  R64: "ROUND OF 64",
  R32: "ROUND OF 32",
  R16: "ROUND OF 16",
  R8: "ROUND OF 8",
  R4: "ROUND OF 4",
  Final: "FINALS",
  final: "FINALS",
};

const REGION_NAME_BY_ID = {
  1: "Wii Plaza",
  2: "Wedge Island",
  3: "Spocco Square",
  4: "Wuhu Island",
};

export function normalizeName(value){
  return String(value || "").trim();
}

export function normalizeDiscordId(value){
  const raw = normalizeName(value);
  if(!raw) return "";
  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  return mentionMatch ? mentionMatch[1] : raw;
}

export function buildActualMatchesFromSheet(raw){
  const rows = Array.isArray(raw?.values) ? raw.values : [];
  return rows.slice(1).map((row) => ({
    id: Number(row?.[0]),
    round: normalizeName(row?.[1]),
    region: Number(row?.[2]) || 0,
    top: {
      seed: Number(row?.[3]) || null,
      name: normalizeName(row?.[4]),
      score: normalizeName(row?.[5]) || null,
    },
    bottom: {
      seed: Number(row?.[6]) || null,
      name: normalizeName(row?.[7]),
      score: normalizeName(row?.[8]) || null,
    },
    winner: normalizeName(row?.[9]),
  })).filter((match) => Number.isFinite(match.id) && ROUND_NUMBER[match.round]);
}

export function parseSeedsNameDiscordMap(raw){
  const rows = Array.isArray(raw?.values) ? raw.values : [];
  const exact = new Map();
  const lower = new Map();

  rows.forEach((row, index) => {
    const name = normalizeName(row?.[0]);
    const discordId = normalizeDiscordId(row?.[2]);
    if(!name) return;
    if(index === 0 && name.toLowerCase() === "name") return;
    exact.set(name, discordId);
    lower.set(name.toLowerCase(), discordId);
  });

  return { exact, lower };
}

export function buildBracketContext(actualMatches){
  const byRoundRegion = new Map();
  const byId = new Map(actualMatches.map((match) => [match.id, match]));

  actualMatches.forEach((match) => {
    const key = `${match.round}:${match.region}`;
    if(!byRoundRegion.has(key)) byRoundRegion.set(key, []);
    byRoundRegion.get(key).push(match);
  });

  for(const list of byRoundRegion.values()){
    list.sort((left, right) => left.id - right.id);
  }

  const nextMap = new Map();
  const prevMap = new Map();

  const setEdge = (fromId, toId, slot) => {
    if(!fromId || !toId) return;
    nextMap.set(fromId, { nextId: toId, slot });
    const previous = prevMap.get(toId) || { topSource: null, bottomSource: null };
    previous[slot === "top" ? "topSource" : "bottomSource"] = fromId;
    prevMap.set(toId, previous);
  };

  const regionChampions = new Map();
  [1, 2, 3, 4].forEach((region) => {
    const r64 = byRoundRegion.get(`R64:${region}`) || [];
    const r32 = byRoundRegion.get(`R32:${region}`) || [];
    const r16 = byRoundRegion.get(`R16:${region}`) || [];
    const r8 = byRoundRegion.get(`R8:${region}`) || [];

    r64.forEach((match, index) => setEdge(match.id, r32[Math.floor(index / 2)]?.id, index % 2 === 0 ? "top" : "bottom"));
    r32.forEach((match, index) => setEdge(match.id, r16[Math.floor(index / 2)]?.id, index % 2 === 0 ? "top" : "bottom"));
    r16.forEach((match, index) => setEdge(match.id, r8[Math.floor(index / 2)]?.id, index % 2 === 0 ? "top" : "bottom"));
    if(r8[0]) regionChampions.set(region, r8[0].id);
  });

  const semifinals = actualMatches.filter((match) => match.round === "R4").sort((left, right) => left.id - right.id);
  const finals = actualMatches.filter((match) => match.round === "Final" || match.round === "final").sort((left, right) => left.id - right.id);
  const finalMatch = finals[0];

  setEdge(regionChampions.get(1), semifinals[0]?.id, "top");
  setEdge(regionChampions.get(4), semifinals[0]?.id, "bottom");
  setEdge(regionChampions.get(2), semifinals[1]?.id, "top");
  setEdge(regionChampions.get(3), semifinals[1]?.id, "bottom");
  setEdge(semifinals[0]?.id, finalMatch?.id, "top");
  setEdge(semifinals[1]?.id, finalMatch?.id, "bottom");

  return { byId, byRoundRegion, nextMap, prevMap };
}

function cloneSlot(slot){
  return {
    seed: slot?.seed == null ? null : Number(slot.seed),
    name: normalizeName(slot?.name),
    score: normalizeName(slot?.score) || null,
  };
}

function getWinnerSlot(match, winnerName){
  const winner = normalizeName(winnerName);
  if(!match || !winner) return null;

  if(normalizeName(match.top?.name) === winner){
    return cloneSlot(match.top);
  }
  if(normalizeName(match.bottom?.name) === winner){
    return cloneSlot(match.bottom);
  }

  return { seed: null, name: winner, score: null };
}

function mergeResolvedSlot(primarySlot, fallbackSlot){
  const primaryName = normalizeName(primarySlot?.name);
  if(primaryName){
    return cloneSlot(primarySlot);
  }
  if(fallbackSlot){
    return cloneSlot(fallbackSlot);
  }
  return cloneSlot(primarySlot);
}

export function buildResolvedMatchMap(actualMatches, context){
  const baseById = context?.byId instanceof Map ? context.byId : new Map(actualMatches.map((match) => [match.id, match]));
  const resolvedById = new Map();

  const resolveMatch = (matchId) => {
    const normalizedMatchId = Number(matchId);
    if(!Number.isFinite(normalizedMatchId)) return null;
    if(resolvedById.has(normalizedMatchId)) return resolvedById.get(normalizedMatchId);

    const match = baseById.get(normalizedMatchId);
    if(!match) return null;

    const previous = context?.prevMap?.get(normalizedMatchId);
    const topFallback = previous?.topSource ? getWinnerSlot(resolveMatch(previous.topSource), baseById.get(previous.topSource)?.winner) : null;
    const bottomFallback = previous?.bottomSource ? getWinnerSlot(resolveMatch(previous.bottomSource), baseById.get(previous.bottomSource)?.winner) : null;

    const resolvedMatch = {
      ...match,
      top: mergeResolvedSlot(match.top, topFallback),
      bottom: mergeResolvedSlot(match.bottom, bottomFallback),
    };
    resolvedById.set(normalizedMatchId, resolvedMatch);
    return resolvedMatch;
  };

  actualMatches
    .slice()
    .sort((left, right) => left.id - right.id)
    .forEach((match) => {
      resolveMatch(match.id);
    });

  return resolvedById;
}

function compareMatches(left, right){
  const leftRound = ROUND_NUMBER[normalizeName(left?.round)] || 0;
  const rightRound = ROUND_NUMBER[normalizeName(right?.round)] || 0;
  if(leftRound !== rightRound) return leftRound - rightRound;
  return Number(left?.id || 0) - Number(right?.id || 0);
}

export function getAuthenticatedTournamentPlayer({ profileDiscordId, seedNameToDiscordMap }){
  const normalizedDiscordId = normalizeDiscordId(profileDiscordId);
  if(!normalizedDiscordId || !(seedNameToDiscordMap instanceof Map)) return null;

  for(const [playerName, discordId] of seedNameToDiscordMap.entries()){
    if(normalizeDiscordId(discordId) !== normalizedDiscordId) continue;
    return {
      discordId: normalizedDiscordId,
      name: normalizeName(playerName),
    };
  }

  return null;
}

export function getMatchOpponent(match, playerName){
  const normalizedPlayerName = normalizeName(playerName);
  if(!normalizedPlayerName || !match) return null;
  if(normalizeName(match.top?.name) === normalizedPlayerName) return cloneSlot(match.bottom);
  if(normalizeName(match.bottom?.name) === normalizedPlayerName) return cloneSlot(match.top);
  return null;
}

export function getNextMatchForTournamentPlayer({ playerName, actualMatches, context }){
  const normalizedPlayerName = normalizeName(playerName);
  if(!normalizedPlayerName || !Array.isArray(actualMatches) || actualMatches.length === 0){
    return null;
  }

  const resolvedById = buildResolvedMatchMap(actualMatches, context);
  const candidateMatches = [...resolvedById.values()]
    .filter((match) => normalizeName(match.top?.name) === normalizedPlayerName || normalizeName(match.bottom?.name) === normalizedPlayerName)
    .sort(compareMatches);

  if(candidateMatches.length === 0){
    return null;
  }

  const unresolvedMatch = candidateMatches.find((match) => !normalizeName(match.winner));
  if(!unresolvedMatch){
    return null;
  }
  const selectedMatch = unresolvedMatch;
  const opponent = getMatchOpponent(selectedMatch, normalizedPlayerName);

  return {
    match: selectedMatch,
    opponent,
    playerName: normalizedPlayerName,
    regionName: getRegionNameForMatch(selectedMatch),
  };
}

export function buildMatchPageUrl(matchId){
  const normalizedMatchId = Number(matchId);
  if(!Number.isFinite(normalizedMatchId)) return MATCH_PAGE_PATH;
  const url = new URL(MATCH_PAGE_PATH, globalThis.location?.origin || "https://nssgolf.com");
  url.searchParams.set(MATCH_QUERY_PARAM, String(normalizedMatchId));
  return `${url.pathname}${url.search}`;
}

export function formatRoundLabel(roundCode){
  return ROUND_LABEL_BY_CODE[normalizeName(roundCode)] || "MATCH";
}

export function getRegionNameForMatch(match){
  return REGION_NAME_BY_ID[Number(match?.region)] || "";
}

export function shouldShowRegionLabel(roundCode){
  const normalizedRoundCode = normalizeName(roundCode);
  return normalizedRoundCode !== "R4" && normalizedRoundCode !== "Final" && normalizedRoundCode !== "final";
}

export function formatMatchCardOpponentLabel(opponent){
  const seed = opponent?.seed == null ? "" : String(opponent.seed);
  const name = normalizeName(opponent?.name) || "TBD";
  return [seed, name].filter(Boolean).join(" ").toUpperCase();
}

export function isUserParticipantInMatch(userDiscordId, matchData, getDiscordIdForPlayerName){
  const normalizedUserDiscordId = normalizeDiscordId(userDiscordId);
  if(!normalizedUserDiscordId || !matchData || typeof getDiscordIdForPlayerName !== "function"){
    return false;
  }

  const topDiscordId = normalizeDiscordId(getDiscordIdForPlayerName(matchData.top?.name));
  const bottomDiscordId = normalizeDiscordId(getDiscordIdForPlayerName(matchData.bottom?.name));
  return normalizedUserDiscordId === topDiscordId || normalizedUserDiscordId === bottomDiscordId;
}

export function getMatchIdFromSearch(search){
  const searchParams = new URLSearchParams(search || "");
  const matchId = Number(searchParams.get(MATCH_QUERY_PARAM));
  return Number.isFinite(matchId) ? matchId : null;
}

export function buildMatchRealtimeChannelName(matchId){
  return `${MATCH_REALTIME_CHANNEL_PREFIX}:${Number(matchId)}`;
}
