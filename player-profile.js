import { createBrowserSupabaseClient } from "/auth/supabase-auth.js";
import {
  CURRENT_RANKED_LEAGUE_SEASON,
  RANKED_LEAGUE_TEAMUP_URL,
  RANKED_LEAGUE_WORKER_URL,
} from "/ranked-league-config.js";

const RECORD_GROUPS = [
  {
    title: "18-hole",
    roleIds: [
      "1466897504334516257",
      "1279498515776540796",
      "1279498415444856864",
      "1279498113886982225",
      "1279497781454569563",
      "1279497671815725137",
      "1279496346960789597",
    ],
  },
  {
    title: "9-hole",
    roleIds: [
      "1279496097328398438",
      "1279495906089111573",
      "1279495694578614455",
      "1279495547727909005",
    ],
  },
  {
    title: "Global",
    roleIds: [
      "1247012004028354620",
      "1095534496570425354",
      "1077315124613890139",
      "1279487297246462064",
    ],
  },
];

const TRACKED_ROLE_IDS = RECORD_GROUPS.flatMap(group => group.roleIds);
const VERIFIED_ROLE_ID = "1463770823277154569";
const PLAYER_PROFILE_ROLE_IDS = [...new Set([...TRACKED_ROLE_IDS, VERIFIED_ROLE_ID])];
const supabase = createBrowserSupabaseClient();
const rootEl = document.getElementById("player-root");
const statusEl = document.getElementById("player-status");
const RANKED_LEADERBOARD_SNAPSHOT_PATH = "/get_leaderboard_snapshot";
const PROLEAGUE_WORKER_URL = "https://small-mud-2771.nextweekmedia.workers.dev/";
const PROLEAGUE_SHEET_ID = "1qIM0HKhx9Y-3eCJCFzBqrbATwiPrK3C1ynATwZzRC1o";
const SUPERLEAGUE_SHEET_ID = "1BbT8t6erCVdx-Bdshv_hax9r9JSRzU1WygjWxW3vPkY";
const SUPERLEAGUE_SHEET_NAME = "Season 6";
const SUPERLEAGUE_DISCORD_IDS_SHEET = "Discord IDs";
const NOPTATIONAL_SHEET_ID = "1T7kmgUtimrOW3LaTw2hYLMFvO600SjmUDLTecL6gY00";
const NOPTATIONAL_SHEET_NAME = "Round Scores (2026)";
const NOPTATIONAL_SHEET_RANGE = `'${NOPTATIONAL_SHEET_NAME}'!A1:J250`;
const PROLEAGUE_MAX_SEASON_TO_CHECK = 7;
const PROLEAGUE_MANUAL_INITIAL_PERIOD = { enabled: true, season: 7, stage: 2 };
const PROLEAGUE_PLAYER_STANDINGS_A1 = "AE4:AH101";
const PROLEAGUE_LOOKUP_RANGE_A1 = "A3:S250";
const PROLEAGUE_DETECT_R1 = "L5:S63";
const PROLEAGUE_DETECT_R2 = "L66:S101";
const PROLEAGUE_CH_ROSTER = "B3:H23";
const PROLEAGUE_CH_SEMIS_BLOCK = "O3:P9";
const PROLEAGUE_CH_FINALS_TOP = "R4:S4";
const PROLEAGUE_CH_FINALS_BOTTOM = "R8:S8";
const PROLEAGUE_CH_CHAMPION_CELL = "U6:U6";
const SUPERLEAGUE_DIVISIONS = [
  { title: "Division 1", range: "B3:G10" },
  { title: "Division 2", range: "B13:G20" },
  { title: "Division 3", range: "B23:G30" },
];
const SUPERLEAGUE_SCHEDULE_RANGE = "I2:AB85";
const SUPERLEAGUE_PLAYOFF_RANGE = "I87:AB92";
const PROLEAGUE_LEGACY_SEASON_CONFIG = {
  5: { sheet: "Season 5", rosters: "A3:S63", teamRank: "U4:X15" },
  4: { sheet: "Season 4", rosters: "A3:S53", teamRank: "U4:X13" },
  3: { sheet: "Season 3", rosters: "A3:S48", teamRank: "U4:X12" },
  2: { sheet: "Season 2", rosters: "A3:S43", teamRank: "U4:X11" },
  1: { sheet: "Season 1", rosters: "A3:S38", teamRank: "U4:X10" },
};
const PROLEAGUE_STAGED_FORMAT = { rosters: "A3:S63", teamRank: "U4:X15" };
const PROLEAGUE_TEAM_STYLES = {
  "ANIMALS": { bg: "#2b2020", fg: "#ffffff" },
  "TERRIFIC TIGERS": { bg: "#fe6d01", fg: "#000000" },
  "BREAKERS": { bg: "#f1c232", fg: "#1c4487" },
  "DAGGERS": { bg: "#ea9999", fg: "#1d2244" },
  "SNIPERS": { bg: "#275318", fg: "#ffe6cd" },
  "MCSTROKERS": { bg: "#4d94d8", fg: "#ffffff" },
  "INFERNIX": { bg: "#f6b26b", fg: "#000000" },
  "INFERNIX*": { bg: "#f6b26b", fg: "#000000" },
  "DOUBLE-EAGLES": { bg: "#1c4487", fg: "#ffffff" },
  "PHANTOM TROUPE": { bg: "#674ea7", fg: "#ffffff" },
  "ASTERISM": { bg: "#ba2636", fg: "#ffffff" },
  "CARROTS": { bg: "#ff9966", fg: "#000000" },
  "SPOCCO COWS": { bg: "#78206e", fg: "#ffffff" },
  "BURGERS": { bg: "#7e5444", fg: "#ffffff" },
  "TREEMEISTERS": { bg: "#2d6316", fg: "#ffffff" },
  "FLAG SMOKERS": { bg: "#03384B", fg: "#ffffff" },
  "REVERIE": { bg: "#d9d2e9", fg: "#00367a" },
};
const NOPTATIONAL_COURSES = [
  { key: "classic", name: "Classic", minimum: -12, columns: [1, 2] },
  { key: "resort", name: "Resort", minimum: -10, columns: [3, 4] },
  { key: "specials", name: "Specials", minimum: -3, columns: [5, 6, 7] },
  { key: "eighteen", name: "18 Holes", minimum: -22, columns: [8, 9] },
];
const NOPTATIONAL_SCORE_COLUMNS = [
  { course: "classic", title: "Classic R1", column: 1 },
  { course: "classic", title: "Classic R2", column: 2 },
  { course: "resort", title: "Resort R1", column: 3 },
  { course: "resort", title: "Resort R2", column: 4 },
  { course: "specials", title: "Specials R1", column: 5 },
  { course: "specials", title: "Specials R2", column: 6 },
  { course: "specials", title: "Specials R3", column: 7 },
  { course: "eighteen", title: "18 Holes R1", column: 8 },
  { course: "eighteen", title: "18 Holes R2", column: 9 },
];
const proLeaguePeriodCache = new Map();
const proLeagueChampCache = new Map();
let superLeagueDiscordIdMapPromise = null;
let proLeagueDetectionPromise = null;
let proLeagueCurrentSeason = 7;
let proLeagueCurrentStage = 1;
let proLeagueAvailableSeasons = [1, 2, 3, 4, 5];
let proLeagueStageDataBySeason = new Map();

function cleanRoleName(name){
  const clean = String(name || "")
    .replace(/^[^A-Za-z0-9\-−–—]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "Record title unavailable";
}

function getDiscordIdFromLocation(){
  const pathSegment = String(window.location.pathname || "")
    .split("/")
    .filter(Boolean)[0] || "";
  if(/^\d+$/.test(pathSegment)) return pathSegment;

  const queryId = new URLSearchParams(window.location.search).get("id") || "";
  if(/^\d+$/.test(queryId)) return queryId;

  return "";
}

function normalizeDiscordPlayerId(value){
  return String(value || "").trim().replace(/[^\d]/g, "");
}

function parseCurrentRankedLeagueSeasonNumber(){
  const match = String(CURRENT_RANKED_LEAGUE_SEASON || "").trim().match(/^Season_(\d+)$/);
  if(!match) return null;
  const season = Number(match[1]);
  return Number.isInteger(season) && season > 0 ? season : null;
}

function rankedSeasonLabel(season){
  const number = Number(season);
  return Number.isInteger(number) && number > 0 ? String(number) : "";
}

function avatarUrlFor(member){
  return member?.server_avatar_url || member?.avatar_url || "/logos/golf.png";
}

function displayNameFor(member){
  return member?.display_name || member?.username || member?.discord_user_id || "Player";
}

function formatLongDate(value){
  if(!value) return "";
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function isRecordRole(name){
  return /record/i.test(String(name || ""));
}

function normalizeUnderParValue(value){
  const matches = String(value || "").match(/[-−–—]\s*\d+/g);
  if(!matches?.length) return "";
  const score = matches[matches.length - 1];
  return `-${score.replace(/[-−–—\s]/g, "")}`;
}

function normalizePointValue(value){
  const source = String(value || "");
  const pointMatch = source.match(/(\d+)\s*(?:\+)?\s*(?:points?|pts?|game)/i);
  const fallbackMatch = source.match(/\d+/);
  const points = pointMatch?.[1] || fallbackMatch?.[0] || "";
  return points ? `${points}pts` : "";
}

function displayRecordValue(role){
  if(role.groupTitle === "18-hole" || role.groupTitle === "9-hole"){
    return normalizeUnderParValue(role.name) || role.name;
  }

  if(role.groupTitle === "Global"){
    return normalizePointValue(role.name) || role.name;
  }

  return role.name;
}

function asFiniteNumber(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asWholeNumber(value){
  const number = asFiniteNumber(value);
  return number == null ? null : Math.max(0, Math.trunc(number));
}

function isRankedEntryLike(value){
  return !!value && typeof value === "object" && (
    value.player_id != null ||
    value.playerId != null ||
    value.discord_id != null ||
    value.discordId != null
  );
}

function parseRankedPayload(payload){
  if(typeof payload !== "string") return payload;
  try{
    return JSON.parse(payload);
  }catch{
    return null;
  }
}

function extractRankedEntriesFromPayload(payload){
  const parsedPayload = parseRankedPayload(payload);

  if(Array.isArray(parsedPayload)){
    if(parsedPayload.some(isRankedEntryLike)) return parsedPayload;
  }
  if(!parsedPayload || typeof parsedPayload !== "object"){
    return [];
  }

  const prioritized = [
    parsedPayload.entries,
    parsedPayload.leaderboard,
    parsedPayload.rankings,
    parsedPayload.rows,
    parsedPayload.players,
    parsedPayload.data,
  ];
  for(const candidate of prioritized){
    if(Array.isArray(candidate) && candidate.some(isRankedEntryLike)){
      return candidate;
    }
  }

  const queue = [parsedPayload];
  const visited = new Set();
  while(queue.length){
    const node = queue.shift();
    if(!node || typeof node !== "object") continue;
    if(visited.has(node)) continue;
    visited.add(node);

    if(Array.isArray(node)){
      if(node.some(isRankedEntryLike)) return node;
      node.forEach((child) => {
        if(child && typeof child === "object") queue.push(child);
      });
      continue;
    }

    Object.values(node).forEach((child) => {
      if(Array.isArray(child) || (child && typeof child === "object")){
        queue.push(child);
      }
    });
  }
  return [];
}

function normalizeRankedPlayerEntry(row, season){
  const matches = asWholeNumber(row?.matches) ?? 0;
  const placementWins = asWholeNumber(row?.count_placement_1) ?? 0;
  const rawWins = asWholeNumber(row?.wins);
  const wins = rawWins != null && rawWins !== 0 ? rawWins : placementWins;
  const rawWinRate = asFiniteNumber(row?.win_rate ?? row?.winRate);
  let winRate = rawWinRate != null && rawWinRate !== 0 ? rawWinRate : 0;

  if((rawWinRate == null || rawWinRate === 0) && placementWins > 0 && matches > 0){
    winRate = (placementWins / matches) * 100;
  }

  return {
    season,
    seasonLabel: rankedSeasonLabel(season),
    rank: asWholeNumber(row?.rank),
    elo: asWholeNumber(row?.elo),
    wins,
    matches,
    winRate,
  };
}

function getRankedEntryForPlayer(payload, discordId, season){
  const normalizedDiscordId = normalizeDiscordPlayerId(discordId);
  if(!normalizedDiscordId) return null;

  const entries = extractRankedEntriesFromPayload(payload);
  const row = entries.find((entry) => {
    const playerId = normalizeDiscordPlayerId(
      entry?.player_id ?? entry?.playerId ?? entry?.discord_id ?? entry?.discordId
    );
    return playerId === normalizedDiscordId;
  });

  return row ? normalizeRankedPlayerEntry(row, season) : null;
}

async function loadArchivedRankedLeagueRows(discordId){
  const currentSeasonNumber = parseCurrentRankedLeagueSeasonNumber();
  if(!currentSeasonNumber || currentSeasonNumber <= 1) return [];

  const { data, error } = await supabase
    .from("ranked")
    .select("season,payload")
    .gte("season", 1)
    .lt("season", currentSeasonNumber)
    .order("season", { ascending: true });

  if(error) throw error;

  return (data || [])
    .map((row) => {
      const season = Number(row?.season);
      if(!Number.isInteger(season) || season < 1 || season >= currentSeasonNumber) return null;
      return getRankedEntryForPlayer(row?.payload, discordId, season);
    })
    .filter(Boolean);
}

async function loadCurrentRankedLeagueRow(discordId){
  const currentSeasonNumber = parseCurrentRankedLeagueSeasonNumber();
  if(!currentSeasonNumber) return null;

  const response = await fetch(`${RANKED_LEAGUE_WORKER_URL}${RANKED_LEADERBOARD_SNAPSHOT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leaderboard_name: CURRENT_RANKED_LEAGUE_SEASON }),
  });

  if(!response.ok){
    throw new Error(`Ranked League snapshot request failed (${response.status})`);
  }

  const payload = await response.json();
  return getRankedEntryForPlayer(payload, discordId, currentSeasonNumber);
}

async function loadRankedLeagueRows(discordId){
  const [archivedResult, currentResult] = await Promise.allSettled([
    loadArchivedRankedLeagueRows(discordId),
    loadCurrentRankedLeagueRow(discordId),
  ]);

  if(archivedResult.status === "rejected"){
    console.error("Unable to load archived Ranked League data", archivedResult.reason);
  }
  if(currentResult.status === "rejected"){
    console.error("Unable to load current Ranked League data", currentResult.reason);
  }

  const archivedRows = archivedResult.status === "fulfilled" ? archivedResult.value : [];
  const currentRow = currentResult.status === "fulfilled" ? currentResult.value : null;
  return [...archivedRows, currentRow]
    .filter(Boolean)
    .sort((left, right) => left.season - right.season);
}

function formatRankedInteger(value){
  return Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "—";
}

function formatRankedPlainInteger(value){
  return Number.isFinite(value) ? String(Math.trunc(value)) : "—";
}

function formatRankedPercent(value){
  const percent = Number.isFinite(value) ? value : 0;
  return `${percent.toFixed(1)}%`;
}

function renderRankedLeagueSection(rankedRows){
  if(!rankedRows.length) return null;

  const section = document.createElement("section");
  section.className = "profile-section ranked-league-section";
  section.setAttribute("aria-labelledby", "ranked-league-title");

  const title = document.createElement("h2");
  title.className = "profile-section-title ranked-league-title";
  title.id = "ranked-league-title";
  title.textContent = "Ranked League";

  const tableWrap = document.createElement("div");
  tableWrap.className = "ranked-table-wrap";

  const table = document.createElement("table");
  table.className = "ranked-table";

  const colgroup = document.createElement("colgroup");
  [
    "ranked-col-season",
    "ranked-col-rank",
    "ranked-col-elo",
    "ranked-col-wins",
    "ranked-col-matches",
    "ranked-col-win-rate",
  ].forEach((className) => {
    const col = document.createElement("col");
    col.className = className;
    colgroup.appendChild(col);
  });

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Season", "Rank", "Elo", "Wins", "Matches", "Win %"].forEach((label) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  rankedRows.forEach((row) => {
    const tr = document.createElement("tr");

    const season = document.createElement("th");
    season.scope = "row";
    season.textContent = row.seasonLabel;
    tr.appendChild(season);

    [
      { value: formatRankedPlainInteger(row.rank) },
      { value: formatRankedPlainInteger(row.elo), className: "ranked-cell-elo" },
      { value: formatRankedInteger(row.wins) },
      { value: formatRankedInteger(row.matches) },
      { value: formatRankedPercent(row.winRate) },
    ].forEach(({ value, className }) => {
      const td = document.createElement("td");
      if(className) td.className = className;
      td.textContent = value;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.append(colgroup, thead, tbody);
  tableWrap.appendChild(table);

  const link = document.createElement("a");
  link.className = "ranked-teamup-link";
  link.href = RANKED_LEAGUE_TEAMUP_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Detailed data available at TeamUp →";

  section.append(title, tableWrap, link);
  return section;
}

function escapeHtml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function proLeagueAliasKey(value){
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function proLeagueTeamStyle(name){
  const key = String(name || "").trim().toUpperCase();
  return PROLEAGUE_TEAM_STYLES[key] || null;
}

function normalizeProLeagueValues(resp){
  if(!resp) return [];
  if(resp.error){
    throw new Error(resp.error.message || "Google Sheets request failed.");
  }
  if(Array.isArray(resp)) return resp;
  if(Array.isArray(resp.values)) return resp.values;
  if(Array.isArray(resp.data?.values)) return resp.data.values;
  if(Array.isArray(resp.result?.values)) return resp.result.values;
  return [];
}

async function fetchSheetRange(sheetId, range){
  const payload = { sheetId, range };

  try{
    const response = await fetch(PROLEAGUE_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if(response.ok) return normalizeProLeagueValues(await response.json());
  }catch(error){
    if(error?.message && !/Failed to fetch|NetworkError|Load failed/i.test(error.message)){
      throw error;
    }
  }

  const url = new URL(PROLEAGUE_WORKER_URL);
  url.searchParams.set("sheetId", sheetId);
  url.searchParams.set("range", range);
  const response = await fetch(url.toString());
  if(!response.ok){
    const text = await response.text().catch(() => "");
    throw new Error(`Sheet request failed (${response.status}). ${text}`.trim());
  }
  return normalizeProLeagueValues(await response.json());
}

async function fetchProLeagueRange(range){
  return fetchSheetRange(PROLEAGUE_SHEET_ID, range);
}

async function fetchSuperLeagueRange(a1, sheetName = SUPERLEAGUE_SHEET_NAME){
  return fetchSheetRange(SUPERLEAGUE_SHEET_ID, `'${sheetName}'!${a1}`);
}

function normalizeSuperLeagueNameKey(value){
  return String(value ?? "").trim().toUpperCase();
}

function superLeagueNumOrZero(value){
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : 0;
}

function formatSuperLeagueDiff(value){
  const number = superLeagueNumOrZero(value);
  if(number > 0) return `+${number}`;
  if(number < 0) return `${number}`;
  return "0";
}

function superLeagueSeasonLabel(){
  const label = String(SUPERLEAGUE_SHEET_NAME || "").trim();
  const match = label.match(/Season\s+\d+/i);
  return match ? match[0].replace(/^season/i, "Season") : label || "Season";
}

function normalizeSuperLeagueDivisionValue(value){
  const text = String(value ?? "").trim();
  const match = text.match(/(\d+)/);
  return match ? match[1] : text;
}

function superLeagueDivisionClassFromLabel(label){
  const normalized = String(label ?? "").toLowerCase();
  if(normalized.includes("1")) return "division-1";
  if(normalized.includes("2")) return "division-2";
  if(normalized.includes("3")) return "division-3";
  return "";
}

function compareSuperLeaguePctDesc(aWins, aLosses, bWins, bLosses){
  const aTotal = aWins + aLosses;
  const bTotal = bWins + bLosses;
  if(aTotal === 0 && bTotal === 0) return 0;
  if(aTotal === 0) return bWins > 0 ? 1 : -1;
  if(bTotal === 0) return aWins > 0 ? -1 : 1;

  const left = aWins * bTotal;
  const right = bWins * aTotal;
  if(left === right) return 0;
  return left > right ? -1 : 1;
}

function compareSuperLeagueRoundDiffDesc(aWins, aLosses, bWins, bLosses){
  const aDiff = aWins - aLosses;
  const bDiff = bWins - bLosses;
  return aDiff !== bDiff ? bDiff - aDiff : 0;
}

function getSuperLeagueHeadToHeadOutcome(headToHeadMap, playerA, playerB){
  const aKey = normalizeSuperLeagueNameKey(playerA);
  const bKey = normalizeSuperLeagueNameKey(playerB);
  if(!aKey || !bKey) return null;

  const aVs = headToHeadMap.get(aKey);
  if(aVs?.has(bKey)) return aVs.get(bKey);

  const bVs = headToHeadMap.get(bKey);
  if(bVs?.has(aKey)) return bVs.get(aKey) === 1 ? -1 : 1;
  return null;
}

function buildSuperLeagueHeadToHeadByDivision(scheduleRows){
  const byDivision = new Map();

  (scheduleRows || []).forEach((row = []) => {
    const division = normalizeSuperLeagueDivisionValue(row[1]);
    const p1Name = String(row[3] ?? "").trim();
    const p2Name = String(row[12] ?? "").trim();
    const p1Result = String(row[10] ?? "").trim().toUpperCase();
    const p2Result = String(row[19] ?? "").trim().toUpperCase();

    if(!division || !p1Name || !p2Name) return;
    if(!((p1Result === "W" && p2Result === "L") || (p1Result === "L" && p2Result === "W"))) return;

    if(!byDivision.has(division)) byDivision.set(division, new Map());
    const divisionMap = byDivision.get(division);

    const p1Key = normalizeSuperLeagueNameKey(p1Name);
    const p2Key = normalizeSuperLeagueNameKey(p2Name);
    if(!divisionMap.has(p1Key)) divisionMap.set(p1Key, new Map());
    if(!divisionMap.has(p2Key)) divisionMap.set(p2Key, new Map());

    const p1Won = p1Result === "W";
    divisionMap.get(p1Key).set(p2Key, p1Won ? 1 : -1);
    divisionMap.get(p2Key).set(p1Key, p1Won ? -1 : 1);
  });

  return byDivision;
}

function computeSuperLeagueHeadToHeadPct(row, group, headToHeadMap){
  let wins = 0;
  let losses = 0;

  group.forEach((other) => {
    if(other.playerKey === row.playerKey) return;
    const outcome = getSuperLeagueHeadToHeadOutcome(headToHeadMap, row.playerKey, other.playerKey);
    if(outcome === 1) wins += 1;
    if(outcome === -1) losses += 1;
  });

  const played = wins + losses;
  return played === 0 ? null : wins / played;
}

function rankSuperLeagueDivisionRows(rows, divisionTitle, headToHeadByDivision){
  const divisionKey = normalizeSuperLeagueDivisionValue(divisionTitle);
  const headToHeadMap = headToHeadByDivision.get(divisionKey) || new Map();
  const withKeys = rows.map((row) => ({ ...row, playerKey: normalizeSuperLeagueNameKey(row.player) }));

  withKeys.sort((a, b) => compareSuperLeaguePctDesc(a.matchesWon, a.matchesLost, b.matchesWon, b.matchesLost));

  const ranked = [];
  for(let i = 0; i < withKeys.length;){
    const group = [withKeys[i]];
    let j = i + 1;
    while(
      j < withKeys.length &&
      compareSuperLeaguePctDesc(
        withKeys[i].matchesWon,
        withKeys[i].matchesLost,
        withKeys[j].matchesWon,
        withKeys[j].matchesLost,
      ) === 0
    ){
      group.push(withKeys[j]);
      j += 1;
    }

    if(group.length === 2){
      const h2h = getSuperLeagueHeadToHeadOutcome(headToHeadMap, group[0].playerKey, group[1].playerKey);
      if(h2h === -1){
        group.reverse();
        group[0].tied = false;
        group[1].tied = false;
      }else if(h2h === 1){
        group[0].tied = false;
        group[1].tied = false;
      }else{
        const gamesCmp = compareSuperLeagueRoundDiffDesc(group[0].gamesWon, group[0].gamesLost, group[1].gamesWon, group[1].gamesLost);
        if(gamesCmp > 0) group.reverse();
        if(gamesCmp !== 0){
          group[0].tied = false;
          group[1].tied = false;
        }else if(group[0].diff !== group[1].diff){
          if(group[0].diff > group[1].diff) group.reverse();
          group[0].tied = false;
          group[1].tied = false;
        }else{
          group[0].tied = true;
          group[1].tied = true;
        }
      }
    }else if(group.length > 2){
      const withHeadToHead = group.map((row) => ({
        ...row,
        headToHeadPct: computeSuperLeagueHeadToHeadPct(row, group, headToHeadMap),
      }));
      const uniqueHeadToHeadPcts = new Set(withHeadToHead.map((row) => row.headToHeadPct));
      const canUseHeadToHead = !(uniqueHeadToHeadPcts.size === 1 && uniqueHeadToHeadPcts.has(null));

      withHeadToHead.sort((a, b) => {
        if(canUseHeadToHead){
          const aPct = a.headToHeadPct;
          const bPct = b.headToHeadPct;
          if(aPct !== bPct){
            if(aPct === null) return 1;
            if(bPct === null) return -1;
            return bPct - aPct;
          }
        }
        const gamesCmp = compareSuperLeagueRoundDiffDesc(a.gamesWon, a.gamesLost, b.gamesWon, b.gamesLost);
        if(gamesCmp !== 0) return gamesCmp;
        if(a.diff !== b.diff) return a.diff - b.diff;
        return a.sourceOrder - b.sourceOrder;
      });

      for(let k = 0; k < withHeadToHead.length; k += 1){
        const current = withHeadToHead[k];
        const prev = withHeadToHead[k - 1];
        if(!prev){
          current.tied = false;
          continue;
        }
        const sameHeadToHead = current.headToHeadPct === prev.headToHeadPct;
        const sameGames = compareSuperLeagueRoundDiffDesc(current.gamesWon, current.gamesLost, prev.gamesWon, prev.gamesLost) === 0;
        const sameDiff = current.diff === prev.diff;
        current.tied = sameHeadToHead && sameGames && sameDiff;
        if(current.tied) prev.tied = true;
      }
      group.splice(0, group.length, ...withHeadToHead);
    }else{
      group[0].tied = false;
    }

    ranked.push(...group);
    i = j;
  }

  let displayRank = 1;
  ranked.forEach((row, index) => {
    if(index > 0){
      const prev = ranked[index - 1];
      const samePrimary = compareSuperLeaguePctDesc(row.matchesWon, row.matchesLost, prev.matchesWon, prev.matchesLost) === 0;
      const sameGames = compareSuperLeagueRoundDiffDesc(row.gamesWon, row.gamesLost, prev.gamesWon, prev.gamesLost) === 0;
      if(!(row.tied && prev.tied && samePrimary && sameGames && row.diff === prev.diff)){
        displayRank = index + 1;
      }
    }
    row.rank = row.tied ? `T${displayRank}` : String(displayRank);
  });

  const rankCounts = new Map();
  ranked.forEach((row) => {
    const rankValue = String(row.rank ?? "").trim();
    const rankNumber = rankValue.startsWith("T") ? rankValue.slice(1) : rankValue;
    if(!rankNumber) return;
    rankCounts.set(rankNumber, (rankCounts.get(rankNumber) || 0) + 1);
  });
  ranked.forEach((row) => {
    const rankValue = String(row.rank ?? "").trim();
    if(!rankValue.startsWith("T")) return;
    const rankNumber = rankValue.slice(1);
    if(rankCounts.get(rankNumber) === 1) row.rank = rankNumber;
  });

  return ranked;
}

function mapSuperLeagueRows(values){
  return (values || []).map((row = [], index) => {
    const player = String(row[0] ?? "").trim();
    const matchesWon = superLeagueNumOrZero(row[1]);
    const matchesLost = superLeagueNumOrZero(row[2]);
    const gamesWon = superLeagueNumOrZero(row[3]);
    const gamesLost = superLeagueNumOrZero(row[4]);
    const diff = superLeagueNumOrZero(row[5]);
    return {
      player,
      matchesWon,
      matchesLost,
      gamesWon,
      gamesLost,
      diff,
      sourceOrder: index,
      matches: `${matchesWon}-${matchesLost}`,
      games: `${gamesWon}-${gamesLost}`,
      diffText: formatSuperLeagueDiff(diff),
    };
  }).filter((row) => row.player !== "");
}

function isSuperLeagueMatchComplete(matchup){
  if(!matchup) return false;
  return matchup.p1.result === "W" || matchup.p2.result === "W";
}

function getSuperLeagueMatchWinnerKey(matchup){
  if(!isSuperLeagueMatchComplete(matchup)) return "";
  if(matchup.p1.result === "W") return normalizeSuperLeagueNameKey(matchup.p1.name);
  if(matchup.p2.result === "W") return normalizeSuperLeagueNameKey(matchup.p2.name);
  if(matchup.p1.result === "L") return normalizeSuperLeagueNameKey(matchup.p2.name);
  if(matchup.p2.result === "L") return normalizeSuperLeagueNameKey(matchup.p1.name);
  return "";
}

function getSuperLeagueMatchLoserKey(matchup){
  if(!isSuperLeagueMatchComplete(matchup)) return "";
  if(matchup.p1.result === "L") return normalizeSuperLeagueNameKey(matchup.p1.name);
  if(matchup.p2.result === "L") return normalizeSuperLeagueNameKey(matchup.p2.name);
  if(matchup.p1.result === "W") return normalizeSuperLeagueNameKey(matchup.p2.name);
  if(matchup.p2.result === "W") return normalizeSuperLeagueNameKey(matchup.p1.name);
  return "";
}

function deriveSuperLeaguePlayoffMetadata(matchups){
  if(!Array.isArray(matchups) || matchups.length < 6) return null;
  const championship = matchups[2];
  const thirdPlace = matchups[3];
  const oneOffs = [
    { matchup: matchups[4], label: "Division 1/2 Playoff" },
    { matchup: matchups[5], label: "Division 2/3 Playoff" },
  ];
  const championshipComplete = isSuperLeagueMatchComplete(championship);
  const thirdPlaceComplete = isSuperLeagueMatchComplete(thirdPlace);
  const d1FinalRanks = new Map();

  if(championshipComplete && thirdPlaceComplete){
    const topFour = [
      getSuperLeagueMatchWinnerKey(championship),
      getSuperLeagueMatchLoserKey(championship),
      getSuperLeagueMatchWinnerKey(thirdPlace),
      getSuperLeagueMatchLoserKey(thirdPlace),
    ].filter(Boolean);
    if(topFour.length === 4 && new Set(topFour).size === 4){
      d1FinalRanks.set(topFour[0], 1);
      d1FinalRanks.set(topFour[1], 2);
      d1FinalRanks.set(topFour[2], 3);
      d1FinalRanks.set(topFour[3], 4);
    }
  }

  return { championship, thirdPlace, oneOffs, championshipComplete, thirdPlaceComplete, d1FinalRanks };
}

function applySuperLeagueDivisionOnePlayoffOverrides(rows, metadata){
  if(!metadata || !(metadata.championshipComplete && metadata.thirdPlaceComplete)) return;
  if(metadata.d1FinalRanks.size !== 4) return;

  const rankOrder = [];
  rows.forEach((row, index) => {
    const playoffRank = metadata.d1FinalRanks.get(row.playerKey);
    if(!playoffRank) return;
    row._forcedRank = playoffRank;
    rankOrder.push({ row, playoffRank, index });
  });
  if(!rankOrder.length) return;

  rankOrder.sort((a, b) => a.playoffRank - b.playoffRank || a.index - b.index);
  const orderedRows = rankOrder.map((entry) => entry.row);
  const remainingRows = rows.filter((row) => !row._forcedRank);
  rows.splice(0, rows.length, ...orderedRows, ...remainingRows);
  rows.forEach((row, index) => {
    if(row._forcedRank){
      row.rank = String(row._forcedRank);
      row.tied = false;
    }else{
      row.rank = String(index + 1);
      row.tied = false;
    }
  });
}

function applySuperLeaguePlayoffStatTotals(baseRows, metadata){
  const rows = baseRows.map((row) => ({ ...row }));
  if(!metadata) return rows;

  const statDeltas = new Map();
  const addResult = (playerKey, matchWon, matchLost, gamesWon, gamesLost) => {
    if(!playerKey) return;
    if(!statDeltas.has(playerKey)){
      statDeltas.set(playerKey, { matchesWon: 0, matchesLost: 0, gamesWon: 0, gamesLost: 0, diff: 0 });
    }
    const totals = statDeltas.get(playerKey);
    totals.matchesWon += matchWon;
    totals.matchesLost += matchLost;
    totals.gamesWon += gamesWon;
    totals.gamesLost += gamesLost;
    totals.diff += gamesWon - gamesLost;
  };

  const addMatch = (matchup) => {
    if(!isSuperLeagueMatchComplete(matchup)) return;
    const p1Key = normalizeSuperLeagueNameKey(matchup.p1.name);
    const p2Key = normalizeSuperLeagueNameKey(matchup.p2.name);
    const p1Games = superLeagueNumOrZero(matchup.p1.gamesWon);
    const p2Games = superLeagueNumOrZero(matchup.p2.gamesWon);
    const p1Win = matchup.p1.result === "W";
    const p2Win = matchup.p2.result === "W";
    addResult(p1Key, p1Win ? 1 : 0, p1Win ? 0 : 1, p1Games, p2Games);
    addResult(p2Key, p2Win ? 1 : 0, p2Win ? 0 : 1, p2Games, p1Games);
  };

  addMatch(metadata.championship);
  addMatch(metadata.thirdPlace);
  metadata.oneOffs.forEach((entry) => addMatch(entry.matchup));

  rows.forEach((row) => {
    const delta = statDeltas.get(normalizeSuperLeagueNameKey(row.player));
    if(!delta) return;
    row.matchesWon += delta.matchesWon;
    row.matchesLost += delta.matchesLost;
    row.gamesWon += delta.gamesWon;
    row.gamesLost += delta.gamesLost;
    row.diff += delta.diff;
    row.matches = `${row.matchesWon}-${row.matchesLost}`;
    row.games = `${row.gamesWon}-${row.gamesLost}`;
    row.diffText = formatSuperLeagueDiff(row.diff);
  });

  return rows;
}

function parseSuperLeaguePlayoffRows(values){
  return (values || []).map((row = []) => ({
    p1: {
      seed: String(row[2] ?? "").trim(),
      name: String(row[3] ?? "").trim(),
      rounds: [row[4], row[5], row[6]],
      gamesWon: row[7],
      result: String(row[10] ?? "").trim().toUpperCase(),
    },
    p2: {
      seed: String(row[11] ?? "").trim(),
      name: String(row[12] ?? "").trim(),
      rounds: [row[13], row[14], row[15]],
      gamesWon: row[16],
      result: String(row[19] ?? "").trim().toUpperCase(),
    },
  }));
}

function parseSuperLeagueScheduleRows(values){
  const byWeek = new Map();
  (values || []).forEach((row = []) => {
    const week = String(row[0] ?? "").trim();
    const division = String(row[1] ?? "").trim();
    const p1Name = String(row[3] ?? "").trim();
    const p2Name = String(row[12] ?? "").trim();
    if(!week || !division || (!p1Name && !p2Name)) return;

    const matchup = {
      division,
      p1: {
        name: p1Name,
        rounds: [row[4], row[5], row[6]],
        gamesWon: row[7],
        result: String(row[10] ?? "").trim().toUpperCase(),
      },
      p2: {
        name: p2Name,
        rounds: [row[13], row[14], row[15]],
        gamesWon: row[16],
        result: String(row[19] ?? "").trim().toUpperCase(),
      },
    };

    if(!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(matchup);
  });

  const weekSort = (a, b) => {
    const aNumber = Number(a);
    const bNumber = Number(b);
    if(Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  };

  return Array.from(byWeek.keys())
    .sort(weekSort)
    .map((week) => ({ week, matchups: byWeek.get(week) || [] }));
}

function superLeagueNumericScore(value){
  const text = String(value ?? "").trim();
  if(text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function isSuperLeagueRoundWinner(roundA, roundB){
  const a = superLeagueNumericScore(roundA);
  const b = superLeagueNumericScore(roundB);
  if(a === null || b === null) return { a: false, b: false };
  if(a < b) return { a: true, b: false };
  if(b < a) return { a: false, b: true };
  return { a: true, b: true };
}

function formatSuperLeagueStatValue(value, placeholder = "-"){
  const text = String(value ?? "").trim();
  return text === "" ? placeholder : escapeHtml(text);
}

function isSuperLeagueQfPlayerName(name){
  return /^QF\b/i.test(String(name ?? "").trim());
}

function formatSuperLeagueResultChip(value, isWin){
  return `<span class="${isWin ? "result-win" : "result-loss"}">${escapeHtml(value)}</span>`;
}

function getSuperLeagueRoundCellHtml(playerScore, opponentScore, side){
  const score = side === "player" ? playerScore : opponentScore;
  const safeScore = formatSuperLeagueStatValue(score, "-");
  if(side !== "player") return `<span>${safeScore}</span>`;

  const winners = isSuperLeagueRoundWinner(playerScore, opponentScore);
  if(winners.a && !winners.b) return `<span class="score-win">${safeScore}</span>`;
  if(!winners.a && winners.b) return `<span class="score-loss">${safeScore}</span>`;
  return `<span>${safeScore}</span>`;
}

function formatSuperLeagueRoundPair(roundCell){
  return `<span class="round-pair">${roundCell.player}<span class="round-sep">|</span>${roundCell.opponent}</span>`;
}

function getSuperLeaguePlayerWeekResult(playerName, weekData){
  const playerKey = normalizeSuperLeagueNameKey(playerName);
  const matchup = (weekData?.matchups || []).find((match) => (
    normalizeSuperLeagueNameKey(match.p1.name) === playerKey ||
    normalizeSuperLeagueNameKey(match.p2.name) === playerKey
  ));
  if(!matchup) return null;

  const isP1 = normalizeSuperLeagueNameKey(matchup.p1.name) === playerKey;
  const playerSide = isP1 ? matchup.p1 : matchup.p2;
  const opponentSide = isP1 ? matchup.p2 : matchup.p1;
  const isWin = playerSide.result === "W";
  const hasRecordedResult = [
    playerSide.result,
    playerSide.gamesWon,
    opponentSide.gamesWon,
    ...playerSide.rounds,
    ...opponentSide.rounds,
  ].some((value) => String(value ?? "").trim() !== "");

  const round3NotPlayed =
    String(playerSide.rounds[2] ?? "").trim() === "" &&
    String(opponentSide.rounds[2] ?? "").trim() === "" &&
    (superLeagueNumOrZero(playerSide.gamesWon) === 2 || superLeagueNumOrZero(opponentSide.gamesWon) === 2);

  const resultHtml = hasRecordedResult
    ? formatSuperLeagueResultChip(isWin ? "W" : "L", isWin)
    : '<span class="result-pending">-</span>';
  const gamesRecord = `${formatSuperLeagueStatValue(playerSide.gamesWon, "-")}-${formatSuperLeagueStatValue(opponentSide.gamesWon, "-")}`;
  const gamesHtml = hasRecordedResult
    ? formatSuperLeagueResultChip(gamesRecord, isWin)
    : '<span class="result-pending">-</span>';

  return {
    opponent: opponentSide.name || "TBD",
    resultHtml,
    gamesHtml,
    roundCells: [0, 1, 2].map((index) => {
      if(index === 2 && round3NotPlayed){
        return { player: '<span class="score-dash">-</span>', opponent: '<span class="score-dash">-</span>' };
      }
      return {
        player: getSuperLeagueRoundCellHtml(playerSide.rounds[index], opponentSide.rounds[index], "player"),
        opponent: getSuperLeagueRoundCellHtml(playerSide.rounds[index], opponentSide.rounds[index], "opponent"),
      };
    }),
  };
}

async function loadSuperLeagueDiscordIdMaps(){
  if(superLeagueDiscordIdMapPromise) return superLeagueDiscordIdMapPromise;

  superLeagueDiscordIdMapPromise = (async () => {
    const rows = await fetchSuperLeagueRange("A:B", SUPERLEAGUE_DISCORD_IDS_SHEET);
    const nameByDiscordId = new Map();
    const discordIdByName = new Map();
    (rows || []).forEach((row = []) => {
      const discordId = normalizeDiscordPlayerId(row[0]);
      const playerName = String(row[1] ?? "").trim();
      if(!discordId || !playerName) return;
      nameByDiscordId.set(discordId, playerName);
      discordIdByName.set(normalizeSuperLeagueNameKey(playerName), discordId);
    });
    return { nameByDiscordId, discordIdByName };
  })();

  return superLeagueDiscordIdMapPromise;
}

async function loadSuperLeaguePlayerName(discordId){
  try{
    const maps = await loadSuperLeagueDiscordIdMaps();
    return maps.nameByDiscordId.get(normalizeDiscordPlayerId(discordId)) || "";
  }catch(error){
    console.error("Unable to load Super League Discord ID map", error);
    return "";
  }
}

async function loadSuperLeaguePlayerData(playerName){
  const loaded = await Promise.all([
    ...SUPERLEAGUE_DIVISIONS.map((division) => fetchSuperLeagueRange(division.range)),
    fetchSuperLeagueRange(SUPERLEAGUE_SCHEDULE_RANGE),
    fetchSuperLeagueRange(SUPERLEAGUE_PLAYOFF_RANGE),
    loadSuperLeagueDiscordIdMaps(),
  ]);

  const divisionRows = loaded.slice(0, SUPERLEAGUE_DIVISIONS.length);
  const scheduleRows = loaded[SUPERLEAGUE_DIVISIONS.length] || [];
  const playoffRows = loaded[SUPERLEAGUE_DIVISIONS.length + 1] || [];
  const idMaps = loaded[SUPERLEAGUE_DIVISIONS.length + 2] || { discordIdByName: new Map() };
  const headToHeadByDivision = buildSuperLeagueHeadToHeadByDivision(scheduleRows);
  const playoffMatchups = parseSuperLeaguePlayoffRows(playoffRows);
  const playoffMetadata = deriveSuperLeaguePlayoffMetadata(playoffMatchups);
  const targetKey = normalizeSuperLeagueNameKey(playerName);

  let profile = null;
  SUPERLEAGUE_DIVISIONS.forEach((division, index) => {
    const baseRows = mapSuperLeagueRows(divisionRows[index] || []);
    const rowsWithPlayoffs = applySuperLeaguePlayoffStatTotals(baseRows, playoffMetadata);
    const rows = rankSuperLeagueDivisionRows(rowsWithPlayoffs, division.title, headToHeadByDivision);
    if(normalizeSuperLeagueDivisionValue(division.title) === "1"){
      applySuperLeagueDivisionOnePlayoffOverrides(rows, playoffMetadata);
    }
    const row = rows.find((candidate) => normalizeSuperLeagueNameKey(candidate.player) === targetKey);
    if(!row) return;
    profile = {
      name: row.player,
      divisionTitle: division.title,
      divisionClass: superLeagueDivisionClassFromLabel(division.title),
      stats: {
        rank: row.rank || "-",
        matches: row.matches || "-",
        games: row.games || "-",
        diff: row.diffText || "-",
      },
    };
  });

  if(!profile) return null;

  const scheduleWeeks = parseSuperLeagueScheduleRows(scheduleRows);
  const rows = [];
  for(let week = 1; week <= 7; week += 1){
    const weekData = scheduleWeeks.find((entry) => Number(entry.week) === week);
    rows.push({ label: String(week), result: weekData ? getSuperLeaguePlayerWeekResult(playerName, weekData) : null });
  }

  if(playoffMetadata){
    const playoffEntries = [
      { label: "Division 1 Championship", matchup: playoffMetadata.championship },
      { label: "Division 1 3rd Place", matchup: playoffMetadata.thirdPlace },
      ...playoffMetadata.oneOffs.map((entry) => ({ label: entry.label, matchup: entry.matchup })),
    ];
    playoffEntries.forEach((entry) => {
      const result = entry.matchup ? getSuperLeaguePlayerWeekResult(playerName, { matchups: [entry.matchup] }) : null;
      if(!result) return;
      rows.push({ section: entry.label });
      rows.push({ label: "-", result });
    });
  }

  return { ...profile, rows, discordIdByName: idMaps.discordIdByName || new Map() };
}

function proLeagueRowHasAnyValue(row){
  return Array.isArray(row) && row.some(cell => String(cell ?? "").trim() !== "");
}

function proLeagueToNum(value){
  const text = String(value ?? "").trim();
  if(!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function proLeagueFmtScore(value){
  if(value === null || value === undefined) return "-";
  const text = String(value).trim();
  if(!text) return "-";
  const number = Number(text);
  if(!Number.isFinite(number)) return text;
  if(number === 0 || Object.is(number, -0)) return "E";
  return number > 0 ? `+${number}` : String(number);
}

function proLeagueRankClass(rank){
  return rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "";
}

function parseNoptationalScore(value){
  const raw = String(value ?? "").trim();
  if(!raw) return null;
  if(/^e$/i.test(raw)) return 0;
  const cleaned = raw.replace(/[^\d.+-]/g, "");
  if(!cleaned || cleaned === "+" || cleaned === "-") return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function formatNoptationalScore(value){
  if(value === null || value === undefined || value === "") return "-";
  const number = typeof value === "number" ? value : parseNoptationalScore(value);
  if(number === null) return String(value);
  if(number === 0 || Object.is(number, -0)) return "E";
  return number > 0 ? `+${number}` : String(number);
}

function parseNoptationalPlayerCell(value){
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  return {
    display: lines[0] || "",
    username: lines[1] || "",
  };
}

function normalizeNoptationalUsername(value){
  return String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function scoreNoptationalCourse(row, course){
  const attempts = course.columns.map((column) => ({
    column,
    value: row?.[column] ?? "",
    score: parseNoptationalScore(row?.[column]),
  }));
  const numeric = attempts.filter(attempt => attempt.score !== null);
  if(!numeric.length){
    return { attempts, best: null, roundTotal: 0, roundCount: 0, hasScore: false, madeCut: null };
  }
  const best = Math.min(...numeric.map(attempt => attempt.score));
  return {
    attempts,
    best,
    roundTotal: numeric.reduce((sum, attempt) => sum + attempt.score, 0),
    roundCount: numeric.length,
    hasScore: true,
    madeCut: best <= course.minimum,
  };
}

function buildNoptationalPlayers(values){
  return (values || []).slice(1).map((row, index) => {
    const { display, username } = parseNoptationalPlayerCell(row?.[0]);
    if(!display) return null;

    const courseResults = {};
    let cutCourse = null;
    let total = 0;
    let countedCount = 0;

    NOPTATIONAL_COURSES.forEach((course) => {
      const result = scoreNoptationalCourse(row, course);
      courseResults[course.key] = result;
      total += result.roundTotal;
      countedCount += result.roundCount;

      if(!cutCourse && result.hasScore && !result.madeCut){
        cutCourse = course;
      }
    });

    return {
      id: `noptational-${index}`,
      display,
      username,
      usernameKey: normalizeNoptationalUsername(username),
      row,
      courseResults,
      cutCourse,
      total,
      countedCount,
      rank: null,
    };
  }).filter(Boolean);
}

function compareNoptationalPlayers(a, b){
  if(a.total !== b.total) return a.total - b.total;
  if(a.countedCount !== b.countedCount) return b.countedCount - a.countedCount;
  return a.display.localeCompare(b.display, undefined, { sensitivity: "base" });
}

function rankNoptationalContenders(players){
  const sorted = [...players].sort(compareNoptationalPlayers);
  let previousTotal = null;
  let previousRank = 0;
  sorted.forEach((player, index) => {
    if(index === 0 || player.total !== previousTotal){
      previousRank = index + 1;
      previousTotal = player.total;
    }
    player.rank = previousRank;
  });
  return sorted;
}

async function loadNoptationalPlayer(member){
  const values = await fetchSheetRange(NOPTATIONAL_SHEET_ID, NOPTATIONAL_SHEET_RANGE);
  const players = buildNoptationalPlayers(values);
  const playersWithScores = players.filter(player => player.countedCount > 0);
  rankNoptationalContenders(playersWithScores.filter(player => !player.cutCourse));

  const usernameKey = normalizeNoptationalUsername(member?.username);
  const displayKey = String(displayNameFor(member)).trim().toLowerCase();
  return players.find(player => usernameKey && player.usernameKey === usernameKey)
    || players.find(player => String(player.display || "").trim().toLowerCase() === displayKey)
    || null;
}

function renderNoptationalPlayerTable(player){
  const state = player.cutCourse ? "cut" : player.countedCount ? "active" : "no-scores";
  const rankText = state === "cut" ? "Cut" : state === "no-scores" ? "-" : String(player.rank ?? "-");
  const totalText = player.countedCount ? formatNoptationalScore(player.total) : "-";
  const scoreCells = NOPTATIONAL_SCORE_COLUMNS.map((scoreColumn) => {
    const value = player.row?.[scoreColumn.column] ?? "";
    return `<td title="${escapeHtml(scoreColumn.title)}">${escapeHtml(formatNoptationalScore(value))}</td>`;
  }).join("");

  const table = document.createElement("div");
  table.className = "tournament-history";
  table.innerHTML = `
    <h3 class="tournament-title">Noptational</h3>
    <div class="tournament-table-wrap">
      <table class="tournament-table noptational-player-table">
        <thead>
          <tr>
            <th rowspan="2">Rank</th>
            <th rowspan="2">Total</th>
            ${NOPTATIONAL_COURSES.map(course => `<th colspan="${course.columns.length}">${escapeHtml(course.name)}</th>`).join("")}
          </tr>
          <tr>
            ${NOPTATIONAL_COURSES.map(course => course.columns.map((column, index) => `<th>${index + 1}</th>`).join("")).join("")}
          </tr>
        </thead>
        <tbody>
          <tr class="${state === "cut" ? "is-cut" : state === "no-scores" ? "is-no-scores" : ""}">
            <td>${escapeHtml(rankText)}</td>
            <td>${escapeHtml(totalText)}</td>
            ${scoreCells}
          </tr>
        </tbody>
      </table>
    </div>
  `;
  return table;
}

function renderSuperLeagueOpponent(result, discordIdByName){
  const opponent = String(result?.opponent || "TBD").trim();
  const qfClass = isSuperLeagueQfPlayerName(opponent) ? " qf-player" : "";
  const discordId = discordIdByName?.get(normalizeSuperLeagueNameKey(opponent)) || "";
  if(discordId && !/^TBD$/i.test(opponent) && !isSuperLeagueQfPlayerName(opponent)){
    return `<a class="opponent-name${qfClass}" href="/player.html?id=${encodeURIComponent(discordId)}">${escapeHtml(opponent)}</a>`;
  }
  return `<span class="opponent-name${qfClass}">${escapeHtml(opponent || "TBD")}</span>`;
}

function renderSuperLeagueWeeklyRow(row, discordIdByName){
  if(row.section){
    return `<tr class="weekly-section-row"><td colspan="7">${escapeHtml(row.section)}</td></tr>`;
  }

  if(!row.result){
    return `
      <tr>
        <td class="weekly-col-week">${escapeHtml(row.label)}</td>
        <td class="weekly-col-opponent"><span class="opponent-name">-</span></td>
        <td class="weekly-col-result"><span class="result-pending">-</span></td>
        <td class="weekly-col-games"><span class="result-pending">-</span></td>
        <td class="weekly-col-round"><span class="score-dash">-</span></td>
        <td class="weekly-col-round"><span class="score-dash">-</span></td>
        <td class="weekly-col-round"><span class="score-dash">-</span></td>
      </tr>
    `;
  }

  return `
    <tr>
      <td class="weekly-col-week">${escapeHtml(row.label)}</td>
      <td class="weekly-col-opponent">${renderSuperLeagueOpponent(row.result, discordIdByName)}</td>
      <td class="weekly-col-result">${row.result.resultHtml}</td>
      <td class="weekly-col-games">${row.result.gamesHtml}</td>
      <td class="weekly-col-round">${formatSuperLeagueRoundPair(row.result.roundCells[0])}</td>
      <td class="weekly-col-round">${formatSuperLeagueRoundPair(row.result.roundCells[1])}</td>
      <td class="weekly-col-round">${formatSuperLeagueRoundPair(row.result.roundCells[2])}</td>
    </tr>
  `;
}

function renderSuperLeaguePlayerPanel(data){
  const panel = document.createElement("div");
  panel.className = "superleague-history";
  panel.innerHTML = `
    <div class="superleague-player-panel">
      <div class="superleague-player-head">
        <h3 class="superleague-player-name">${escapeHtml(superLeagueSeasonLabel())}</h3>
        <span class="superleague-player-divider" aria-hidden="true">|</span>
        <p class="superleague-player-division ${escapeHtml(data.divisionClass)}">${escapeHtml(data.divisionTitle)}</p>
      </div>
      <div class="superleague-player-meta">
        <div class="superleague-player-meta-cell">
          <p class="superleague-player-meta-label">Rank</p>
          <p class="superleague-player-meta-value">${escapeHtml(data.stats?.rank || "-")}</p>
        </div>
        <div class="superleague-player-meta-cell">
          <p class="superleague-player-meta-label">W-L</p>
          <p class="superleague-player-meta-value">${escapeHtml(data.stats?.matches || "-")}</p>
        </div>
        <div class="superleague-player-meta-cell">
          <p class="superleague-player-meta-label">Rounds</p>
          <p class="superleague-player-meta-value">${escapeHtml(data.stats?.games || "-")}</p>
        </div>
        <div class="superleague-player-meta-cell">
          <p class="superleague-player-meta-label">Diff.</p>
          <p class="superleague-player-meta-value">${escapeHtml(data.stats?.diff || "-")}</p>
        </div>
      </div>
      <div class="superleague-weekly-wrap">
        <table class="superleague-weekly">
          <thead>
            <tr>
              <th class="weekly-col-week">Week</th>
              <th class="weekly-col-opponent">Opponent</th>
              <th class="weekly-col-result">Result</th>
              <th class="weekly-col-games">Rounds</th>
              <th class="weekly-col-round">R1</th>
              <th class="weekly-col-round">R2</th>
              <th class="weekly-col-round">R3</th>
            </tr>
          </thead>
          <tbody>
            ${(data.rows || []).map((row) => renderSuperLeagueWeeklyRow(row, data.discordIdByName)).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  return panel;
}

function createProfileSummary(label){
  const summary = document.createElement("summary");
  summary.className = "proleague-summary";
  summary.innerHTML = `
    <span class="proleague-summary-title">
      <span>${escapeHtml(label)}</span>
      <span class="proleague-summary-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m6 9 6 6 6-6"></path>
        </svg>
      </span>
    </span>
  `;
  return summary;
}

function isProLeagueStagedSeason(season){
  return Number(season) >= 6;
}

function proLeagueSheetNameForPeriod(season, stage){
  const seasonNumber = Number(season);
  if(!isProLeagueStagedSeason(seasonNumber)) return `Season ${seasonNumber}`;
  if(stage === "championship") return `Season ${seasonNumber}, Championship`;
  return `Season ${seasonNumber}, Stage ${Number(stage)}`;
}

function proLeaguePeriodConfig(season, stage){
  const seasonNumber = Number(season);
  if(!isProLeagueStagedSeason(seasonNumber)){
    const legacy = PROLEAGUE_LEGACY_SEASON_CONFIG[seasonNumber];
    return legacy ? { sheet: legacy.sheet, rosters: legacy.rosters, teamRank: legacy.teamRank } : null;
  }
  if(stage === "championship"){
    return { sheet: proLeagueSheetNameForPeriod(seasonNumber, "championship") };
  }
  return {
    sheet: proLeagueSheetNameForPeriod(seasonNumber, stage),
    rosters: PROLEAGUE_STAGED_FORMAT.rosters,
    teamRank: PROLEAGUE_STAGED_FORMAT.teamRank,
  };
}

function proLeagueNormalizeStandings(rows){
  return (rows || [])
    .filter(proLeagueRowHasAnyValue)
    .map((row) => {
      const arr = Array.isArray(row) ? row : [];
      const rank = arr[0];
      const name = arr.length >= 2 ? arr[arr.length - 2] : "";
      const score = arr.length >= 1 ? arr[arr.length - 1] : "";
      if(!rank || !name) return null;
      return {
        rank: Number(rank),
        name: String(name).trim(),
        score: String(score ?? "").trim() !== "" ? Number(score) : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank);
}

function pickProLeagueTop3RoundIndices(rounds){
  const played = (rounds || [])
    .map((value, index) => ({ value, index }))
    .filter(item => item.value !== null && item.value !== undefined && Number.isFinite(item.value));
  if(!played.length) return new Set();

  const chosen = played.map(item => item.value).slice().sort((a, b) => a - b).slice(0, Math.min(3, played.length));
  const needed = new Map();
  for(const value of chosen) needed.set(value, (needed.get(value) || 0) + 1);

  const picked = new Set();
  for(const item of played){
    const remaining = needed.get(item.value) || 0;
    if(remaining > 0){
      picked.add(item.index);
      needed.set(item.value, remaining - 1);
    }
    if(picked.size >= chosen.length) break;
  }
  return picked;
}

function parseProLeagueTeamRosters(values){
  const cleaned = (values || []).filter(proLeagueRowHasAnyValue);
  const byPlayer = new Map();
  const playerTeamByName = new Map();
  if(!cleaned.length) return { byPlayer, playerTeamByName };

  const rows = cleaned.slice(1);
  for(let i = 0; i < rows.length; i += 5){
    const teamName = String(rows[i]?.[2] ?? "").trim();
    if(!teamName) continue;

    const playerRows = [rows[i + 1], rows[i + 2], rows[i + 3], rows[i + 4]].filter(Boolean);
    for(const playerRow of playerRows){
      const name = String(playerRow?.[2] ?? "").trim();
      if(!name) continue;
      const stat = {
        name,
        stageScore: proLeagueToNum(playerRow?.[3]),
        best: [proLeagueToNum(playerRow?.[4]), proLeagueToNum(playerRow?.[5]), proLeagueToNum(playerRow?.[6])],
        weekTotals: [proLeagueToNum(playerRow?.[7]), proLeagueToNum(playerRow?.[8]), proLeagueToNum(playerRow?.[9]), proLeagueToNum(playerRow?.[10])],
        rounds: Array.from({ length: 8 }, (_, index) => proLeagueToNum(playerRow?.[11 + index])),
      };
      byPlayer.set(name, stat);
      playerTeamByName.set(name, teamName);
    }
  }
  return { byPlayer, playerTeamByName };
}

function parseProLeagueLookupStats(values){
  const cleaned = (values || []).filter(proLeagueRowHasAnyValue);
  const byPlayer = new Map();
  if(!cleaned.length) return byPlayer;

  for(const row of cleaned.slice(1)){
    const name = String(row?.[2] ?? "").trim();
    if(!name) continue;
    const overallRank = proLeagueToNum(row?.[0]);
    if(overallRank === null) continue;
    byPlayer.set(name, {
      name,
      stageScore: proLeagueToNum(row?.[3]),
      best: [proLeagueToNum(row?.[4]), proLeagueToNum(row?.[5]), proLeagueToNum(row?.[6])],
      weekTotals: [proLeagueToNum(row?.[7]), proLeagueToNum(row?.[8]), proLeagueToNum(row?.[9]), proLeagueToNum(row?.[10])],
      rounds: Array.from({ length: 8 }, (_, index) => proLeagueToNum(row?.[11 + index])),
    });
  }
  return byPlayer;
}

function parseProLeagueChampionshipRoster(values){
  const cleaned = values || [];
  const teams = [];
  const rows = cleaned.slice(1);
  for(let i = 0; i < rows.length; i += 5){
    const teamName = String(rows[i]?.[0] ?? "").trim();
    const players = [];
    for(let k = 1; k <= 4; k += 1){
      players.push({ name: String(rows[i + k]?.[0] ?? "").trim() });
    }
    if(teamName) teams.push({ name: teamName, players });
  }
  return teams;
}

function parseProLeagueManualFinals(block){
  const pick = (index) => {
    const row = block?.[index] || [];
    return { team: String(row?.[0] ?? "").trim(), score: proLeagueToNum(row?.[1]) };
  };
  const top = pick(0);
  const bottom = pick(1);
  return { t1: top.team, s1: top.score, t2: bottom.team, s2: bottom.score };
}

function parseProLeagueManualSemis(block){
  const pick = (index) => String(block?.[index]?.[0] ?? "").trim();
  return { s1: pick(0), s2: pick(4), s3: pick(6), s4: pick(2) };
}

function proLeaguePeriodKey(season, stage){
  if(!isProLeagueStagedSeason(season)) return `S${season}`;
  return `S${season}-${stage === "championship" ? "championship" : `stage${stage}`}`;
}

async function getProLeaguePeriodHistoryData(season, stage){
  const key = proLeaguePeriodKey(season, stage);
  if(proLeaguePeriodCache.has(key)) return proLeaguePeriodCache.get(key);

  const config = proLeaguePeriodConfig(season, stage);
  if(!config || !config.rosters || !config.teamRank) throw new Error("Unknown Pro League season/stage.");
  const sheet = config.sheet;

  const [teamRows, rosterRows, lookupRows, playerRows] = await Promise.all([
    fetchProLeagueRange(`'${sheet}'!${config.teamRank}`),
    fetchProLeagueRange(`'${sheet}'!${config.rosters}`),
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_LOOKUP_RANGE_A1}`),
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_PLAYER_STANDINGS_A1}`),
  ]);

  const teamList = proLeagueNormalizeStandings(teamRows);
  const playerList = proLeagueNormalizeStandings(playerRows);
  const parsed = parseProLeagueTeamRosters(rosterRows);
  const lookupMap = parseProLeagueLookupStats(lookupRows);
  const playerStatsMap = new Map();
  for(const [name, stat] of lookupMap.entries()) playerStatsMap.set(name, stat);
  for(const [name, stat] of parsed.byPlayer.entries()) playerStatsMap.set(name, stat);

  const data = {
    teamMap: new Map(teamList.map(team => [team.name, team])),
    playerMap: new Map(playerList.map(player => [player.name, player])),
    playerToTeam: parsed.playerTeamByName,
    playerStatsMap,
  };
  proLeaguePeriodCache.set(key, data);
  return data;
}

async function getProLeagueChampionshipData(season){
  const seasonNumber = Number(season);
  const key = `S${seasonNumber}-championship`;
  if(proLeagueChampCache.has(key)) return proLeagueChampCache.get(key);

  const sheet = proLeagueSheetNameForPeriod(seasonNumber, "championship");
  const [rosterRows, semisBlock, finalsTopRows, finalsBottomRows, championCell] = await Promise.all([
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_CH_ROSTER}`).catch(() => []),
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_CH_SEMIS_BLOCK}`).catch(() => []),
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_CH_FINALS_TOP}`).catch(() => []),
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_CH_FINALS_BOTTOM}`).catch(() => []),
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_CH_CHAMPION_CELL}`).catch(() => []),
  ]);

  const data = {
    rosterTeams: parseProLeagueChampionshipRoster(rosterRows),
    semis: parseProLeagueManualSemis(semisBlock),
    finals: parseProLeagueManualFinals([...(finalsTopRows || []), ...(finalsBottomRows || [])]),
    championName: String(championCell?.[0]?.[0] ?? "").trim(),
  };
  proLeagueChampCache.set(key, data);
  return data;
}

function proLeagueAnyNonBlank(values){
  return (values || []).some(row => (row || []).some(cell => String(cell ?? "").trim() !== ""));
}

async function hasProLeagueRoundsDataForStage(season, stage){
  const sheet = proLeagueSheetNameForPeriod(season, stage);
  const [r1, r2] = await Promise.all([
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_DETECT_R1}`).catch(() => []),
    fetchProLeagueRange(`'${sheet}'!${PROLEAGUE_DETECT_R2}`).catch(() => []),
  ]);
  return proLeagueAnyNonBlank(r1) || proLeagueAnyNonBlank(r2);
}

function nextProLeagueStagePeriod(season, stage){
  const seasonNumber = Number(season);
  const stageNumber = Number(stage);
  if(stageNumber < 3) return { season: seasonNumber, stage: stageNumber + 1 };
  return { season: seasonNumber + 1, stage: 1 };
}

async function ensureProLeagueDetection(){
  if(proLeagueDetectionPromise) return proLeagueDetectionPromise;
  proLeagueDetectionPromise = (async () => {
    proLeagueStageDataBySeason = new Map();
    let currentSeason = 5;
    let currentStage = 1;
    let season = 6;
    let stage = 1;

    while(season <= PROLEAGUE_MAX_SEASON_TO_CHECK){
      const ok = await hasProLeagueRoundsDataForStage(season, stage).catch(() => false);
      if(!ok) break;
      proLeagueStageDataBySeason.set(season, Math.max(proLeagueStageDataBySeason.get(season) || 0, stage));
      currentSeason = season;
      currentStage = stage;
      const next = nextProLeagueStagePeriod(season, stage);
      season = next.season;
      stage = next.stage;
    }

    proLeagueCurrentSeason = currentSeason >= 6 ? currentSeason : 5;
    proLeagueCurrentStage = currentSeason >= 6 ? currentStage : 1;
    const manualSeason = PROLEAGUE_MANUAL_INITIAL_PERIOD?.enabled ? Number(PROLEAGUE_MANUAL_INITIAL_PERIOD.season) : NaN;
    const maxSeason = Math.max(proLeagueCurrentSeason, 5, Number.isFinite(manualSeason) ? manualSeason : 0);
    proLeagueAvailableSeasons = Array.from({ length: maxSeason }, (_, index) => index + 1);
    for(let i = 6; i <= maxSeason; i += 1){
      if(!proLeagueStageDataBySeason.has(i)) proLeagueStageDataBySeason.set(i, 3);
    }
  })();
  return proLeagueDetectionPromise;
}

function findProLeagueMapValueByAlias(map, aliasKeys){
  for(const [name, value] of map.entries()){
    if(aliasKeys.has(proLeagueAliasKey(name))) return value;
  }
  return null;
}

function findProLeagueChampionshipRosterTeam(championshipData, aliasKeys){
  return (championshipData.rosterTeams || []).find(team =>
    (team.players || []).some(player => aliasKeys.has(proLeagueAliasKey(player?.name)))
  ) || null;
}

async function loadProLeagueAliases(discordId){
  const { data, error } = await supabase
    .from("player_league_aliases")
    .select("league_player_name")
    .eq("league_key", "shotgun_pro_league")
    .eq("discord_user_id", discordId)
    .eq("active", true)
    .order("league_player_name", { ascending: true });

  if(error){
    console.error("Unable to load Pro League aliases", error);
    return [];
  }
  return [...new Set((data || []).map(row => String(row?.league_player_name || "").trim()).filter(Boolean))];
}

async function loadProLeagueSummariesForAliases(aliasNames){
  const aliases = (aliasNames || []).map(name => String(name || "").trim()).filter(Boolean);
  if(!aliases.length) return [];
  const aliasKeys = new Set(aliases.map(proLeagueAliasKey).filter(Boolean));

  await ensureProLeagueDetection();

  const periods = [];
  const maxSeason = Math.max(...proLeagueAvailableSeasons);
  for(let season = 1; season <= maxSeason; season += 1){
    if(!isProLeagueStagedSeason(season)){
      periods.push({ season, stage: null });
      continue;
    }
    const maxStage = season === proLeagueCurrentSeason
      ? Number(proLeagueCurrentStage || 1)
      : Number(proLeagueStageDataBySeason.get(season) || 3);
    for(let stage = 1; stage <= maxStage; stage += 1){
      periods.push({ season, stage });
    }
    periods.push({ season, stage: "championship" });
  }

  const summaries = [];
  const loadErrors = [];
  for(const period of periods){
    const isChampionship = period.stage === "championship";
    if(isChampionship && isProLeagueStagedSeason(period.season)){
      const championshipData = await getProLeagueChampionshipData(period.season).catch((error) => {
        loadErrors.push(error);
        return null;
      });
      if(!championshipData?.championName) continue;
      const rosterTeam = findProLeagueChampionshipRosterTeam(championshipData, aliasKeys);
      if(!rosterTeam) continue;

      const finalsTeams = new Set([championshipData.finals?.t1, championshipData.finals?.t2].filter(Boolean));
      const rosterName = String(rosterTeam.name || "").trim();
      const championName = String(championshipData.championName || "").trim();
      let champResult = "semi-finalist";
      if(finalsTeams.has(rosterName)) champResult = "runner-up";
      if(rosterName && championName && rosterName === championName) champResult = "champion";

      summaries.push({
        season: period.season,
        stage: "championship",
        teamName: rosterTeam.name || null,
        teamRank: null,
        teamScore: null,
        playerRank: null,
        playerScore: null,
        stats: null,
        isChampionship: true,
        champResult,
      });
      continue;
    }

    const data = await getProLeaguePeriodHistoryData(period.season, period.stage).catch((error) => {
      loadErrors.push(error);
      return null;
    });
    if(!data) continue;

    const teamName = findProLeagueMapValueByAlias(data.playerToTeam, aliasKeys) || null;
    const teamStanding = teamName ? (data.teamMap.get(teamName) || null) : null;
    const playerStanding = findProLeagueMapValueByAlias(data.playerMap, aliasKeys);
    const stats = findProLeagueMapValueByAlias(data.playerStatsMap, aliasKeys);
    if(!teamName && !playerStanding && !stats) continue;

    summaries.push({
      season: period.season,
      stage: period.stage,
      teamName,
      teamRank: teamStanding?.rank ?? null,
      teamScore: teamStanding?.score ?? null,
      playerRank: playerStanding?.rank ?? null,
      playerScore: (playerStanding?.score ?? stats?.stageScore) ?? null,
      stats: stats || null,
      isChampionship: false,
    });
  }
  if(!summaries.length && loadErrors.length){
    throw loadErrors[0];
  }
  return summaries;
}

function proLeagueStageWeight(stage){
  if(stage === "championship") return 4;
  if(stage === null || stage === undefined) return 4;
  const number = Number(stage);
  return Number.isFinite(number) ? number : 0;
}

function proLeagueStageHeaderText(season, stage){
  const seasonNumber = Number(season);
  if(!isProLeagueStagedSeason(seasonNumber)) return "Season";
  if(stage === "championship") return "Championship";
  return `Stage ${Number(stage)}`;
}

function renderProLeagueRoundsTable(stats){
  const rounds = stats?.rounds || [];
  const highlightIdx = pickProLeagueTop3RoundIndices(rounds);
  const table = document.createElement("table");
  table.className = "stage-rounds";
  table.innerHTML = `
    <thead>
      <tr>
        <th>1-1</th><th class="sep-right">1-2</th>
        <th>2-1</th><th class="sep-right">2-2</th>
        <th>3-1</th><th class="sep-right">3-2</th>
        <th>4-1</th><th>4-2</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        ${Array.from({ length: 8 }, (_, index) => {
          const isSep = index === 1 || index === 3 || index === 5;
          const className = `${highlightIdx.has(index) ? "counted" : ""} ${isSep ? "sep-right" : ""}`.trim();
          return `<td class="${className}">${escapeHtml(proLeagueFmtScore(rounds[index] ?? null))}</td>`;
        }).join("")}
      </tr>
    </tbody>
  `;
  return table;
}

function renderProLeagueSeasonPerformance(summaries){
  const container = document.createElement("div");
  container.className = "proleague-history";
  container.innerHTML = `<div class="season-title">Season Performance</div>`;

  const bySeason = new Map();
  for(const summary of summaries || []){
    if(!bySeason.has(summary.season)) bySeason.set(summary.season, []);
    bySeason.get(summary.season).push(summary);
  }

  const seasons = [...bySeason.keys()].sort((a, b) => b - a);
  for(const season of seasons){
    const box = document.createElement("div");
    box.className = "season-entry";

    const head = document.createElement("div");
    head.className = "season-entry-head";
    head.innerHTML = `<div class="season-entry-name">${escapeHtml(`Season ${season}`)}</div>`;
    box.appendChild(head);

    const entries = bySeason.get(season).slice().sort((a, b) => proLeagueStageWeight(b.stage) - proLeagueStageWeight(a.stage));
    for(const entry of entries){
      const stageBlock = document.createElement("div");
      stageBlock.className = "stage-block";

      if(isProLeagueStagedSeason(season)){
        const stageHeader = document.createElement("div");
        stageHeader.className = "stage-header";
        stageHeader.textContent = proLeagueStageHeaderText(season, entry.stage);
        stageBlock.appendChild(stageHeader);
      }

      const teamRow = document.createElement("div");
      teamRow.className = "btn-row";

      if(entry.teamName){
        const style = proLeagueTeamStyle(entry.teamName) || {};
        const teamChip = document.createElement("div");
        teamChip.className = "chip team";
        teamChip.style.setProperty("--team-bg", style.bg || "rgba(255,255,255,0.06)");
        teamChip.style.setProperty("--team-fg", style.fg || "rgba(255,255,255,0.92)");
        teamChip.textContent = String(entry.teamName).toUpperCase();
        teamRow.appendChild(teamChip);
      }else{
        const soloChip = document.createElement("div");
        soloChip.className = "chip solo";
        soloChip.textContent = "SOLO PLAYER";
        teamRow.appendChild(soloChip);
      }

      if(!entry.isChampionship){
        if(entry.teamRank != null){
          const rankChip = document.createElement("div");
          rankChip.className = `chip rank ${proLeagueRankClass(entry.teamRank)}`.trim();
          rankChip.textContent = `#${entry.teamRank} TEAM`;
          teamRow.appendChild(rankChip);
        }
        if(entry.teamScore != null){
          const scoreChip = document.createElement("div");
          scoreChip.className = "chip score";
          scoreChip.textContent = proLeagueFmtScore(entry.teamScore);
          teamRow.appendChild(scoreChip);
        }
      }else if(entry.champResult){
        const champChip = document.createElement("div");
        const champClass = entry.champResult === "champion" ? "gold" : entry.champResult === "runner-up" ? "silver" : "blue";
        champChip.className = `chip rank ${champClass}`.trim();
        champChip.textContent = String(entry.champResult).toUpperCase();
        teamRow.appendChild(champChip);
      }
      stageBlock.appendChild(teamRow);

      if(!entry.isChampionship){
        const playerRow = document.createElement("div");
        playerRow.className = "btn-row";
        if(entry.playerRank != null){
          const rankChip = document.createElement("div");
          rankChip.className = `chip rank ${proLeagueRankClass(entry.playerRank)}`.trim();
          rankChip.textContent = `#${entry.playerRank} OVERALL`;
          playerRow.appendChild(rankChip);
        }
        if(entry.playerScore != null){
          const scoreChip = document.createElement("div");
          scoreChip.className = "chip score";
          scoreChip.textContent = proLeagueFmtScore(entry.playerScore);
          playerRow.appendChild(scoreChip);
        }
        if(playerRow.children.length) stageBlock.appendChild(playerRow);
      }

      if(!entry.isChampionship && entry.stats && Array.isArray(entry.stats.rounds)){
        stageBlock.appendChild(renderProLeagueRoundsTable(entry.stats));
      }

      box.appendChild(stageBlock);
    }

    container.appendChild(box);
  }
  return container;
}

function renderProLeagueSection(aliasNames){
  if(!aliasNames.length) return null;

  const section = document.createElement("section");
  section.className = "profile-section proleague-section";

  const details = document.createElement("details");
  details.className = "proleague-details";

  const summary = createProfileSummary("Shotgun Pro League");

  const content = document.createElement("div");
  content.className = "proleague-content";
  content.innerHTML = `<div class="proleague-loading">Loading Shotgun Pro League data...</div>`;

  details.append(summary, content);
  section.appendChild(details);

  let loaded = false;
  details.addEventListener("toggle", async () => {
    if(!details.open || loaded) return;
    loaded = true;
    try{
      const summaries = await loadProLeagueSummariesForAliases(aliasNames);
      content.innerHTML = "";
      if(!summaries.length){
        content.innerHTML = `<p class="profile-muted proleague-empty">No Shotgun Pro League history found.</p>`;
        return;
      }
      content.appendChild(renderProLeagueSeasonPerformance(summaries));
    }catch(error){
      console.error("Unable to load Pro League player history", error);
      content.innerHTML = `<div class="proleague-error">Unable to load Shotgun Pro League data.</div>`;
    }
  });

  return section;
}

function renderSuperLeagueSection(playerName){
  if(!playerName) return null;

  const section = document.createElement("section");
  section.className = "profile-section proleague-section superleague-section";

  const details = document.createElement("details");
  details.className = "proleague-details";

  const summary = createProfileSummary("Super League");

  const content = document.createElement("div");
  content.className = "proleague-content";
  content.innerHTML = `<div class="proleague-loading">Loading Super League data...</div>`;

  details.append(summary, content);
  section.appendChild(details);

  let loaded = false;
  details.addEventListener("toggle", async () => {
    if(!details.open || loaded) return;
    loaded = true;
    try{
      const data = await loadSuperLeaguePlayerData(playerName);
      content.innerHTML = "";
      if(!data){
        content.innerHTML = `<p class="profile-muted proleague-empty">No Super League results found.</p>`;
        return;
      }
      content.appendChild(renderSuperLeaguePlayerPanel(data));
    }catch(error){
      console.error("Unable to load Super League player history", error);
      content.innerHTML = `<div class="proleague-error">Unable to load Super League data.</div>`;
    }
  });

  return section;
}

function renderTournamentsSection(member){
  const section = document.createElement("section");
  section.className = "profile-section proleague-section tournaments-section";

  const details = document.createElement("details");
  details.className = "proleague-details";

  const summary = createProfileSummary("Tournaments");

  const content = document.createElement("div");
  content.className = "proleague-content";
  content.innerHTML = `<div class="proleague-loading">Loading tournament data...</div>`;

  details.append(summary, content);
  section.appendChild(details);

  let loaded = false;
  details.addEventListener("toggle", async () => {
    if(!details.open || loaded) return;
    loaded = true;
    try{
      const player = await loadNoptationalPlayer(member);
      content.innerHTML = "";
      if(!player){
        content.innerHTML = `<p class="profile-muted proleague-empty">No tournaments found.</p>`;
        return;
      }
      content.appendChild(renderNoptationalPlayerTable(player));
    }catch(error){
      console.error("Unable to load Noptational player history", error);
      content.innerHTML = `<div class="proleague-error">Unable to load tournament data.</div>`;
    }
  });

  return section;
}

function appendRecordValue(target, value){
  const cleanValue = String(value || "");
  const pointsMatch = cleanValue.match(/^(\d+)(pts)$/i);
  if(!pointsMatch){
    target.textContent = cleanValue;
    return;
  }

  const number = document.createElement("span");
  number.className = "profile-record-number";
  number.textContent = pointsMatch[1];

  const suffix = document.createElement("span");
  suffix.className = "profile-record-suffix";
  suffix.textContent = pointsMatch[2].toLowerCase();

  target.append(number, suffix);
}

function getTopRoleByGroup(trackedRoles){
  const rolesByGroup = new Map();
  for(const role of trackedRoles){
    if(!rolesByGroup.has(role.groupTitle)){
      rolesByGroup.set(role.groupTitle, role);
    }
  }
  return [...rolesByGroup.values()];
}

function setStatus(message){
  if(!statusEl) return;
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
}

function renderNotFound(){
  document.title = "Page Not Found | NSS Golf";
  rootEl.innerHTML = "";

  const card = document.createElement("section");
  card.className = "profile-card";

  const title = document.createElement("h1");
  title.className = "headline";
  title.textContent = "Page Not Found";

  const copy = document.createElement("p");
  copy.className = "profile-muted";
  copy.textContent = "That page could not be found.";

  const actions = document.createElement("div");
  actions.className = "profile-actions";

  const home = document.createElement("a");
  home.className = "btn";
  home.href = "/index.html";
  home.textContent = "Home";

  const records = document.createElement("a");
  records.className = "btn";
  records.href = "/records.html";
  records.textContent = "Records";

  actions.append(home, records);
  card.append(title, copy, actions);
  rootEl.appendChild(card);
  setStatus("");
}

function createVerifiedIcon(){
  const icon = document.createElement("span");
  icon.className = "player-verified-icon";
  icon.setAttribute("aria-label", "Verified");
  icon.title = "Verified";
  icon.innerHTML = `
    <svg class="lucide lucide-badge-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"></path>
      <path d="m9 12 2 2 4-4"></path>
    </svg>
  `;
  return icon;
}

function renderProfile(member, trackedRoles, rankedRows = [], proLeagueAliases = [], superLeaguePlayerName = "", isVerified = false){
  document.title = `${displayNameFor(member)} | NSS Golf`;
  rootEl.innerHTML = "";

  const card = document.createElement("section");
  card.className = "profile-card";
  card.setAttribute("aria-labelledby", "player-name");

  const header = document.createElement("div");
  header.className = "profile-header";

  const avatar = document.createElement("img");
  avatar.className = "profile-avatar";
  avatar.src = avatarUrlFor(member);
  avatar.alt = "";
  avatar.decoding = "async";
  avatar.referrerPolicy = "no-referrer";

  const headingWrap = document.createElement("div");
  headingWrap.className = "profile-heading";

  const name = document.createElement("h1");
  name.className = "player-name-title";
  name.id = "player-name";
  const nameText = document.createElement("span");
  nameText.className = "player-name-text";
  nameText.textContent = displayNameFor(member);
  name.appendChild(nameText);
  if(isVerified){
    name.appendChild(createVerifiedIcon());
  }

  const sinceDate = formatLongDate(member.joined_at);
  const memberSince = document.createElement("p");
  memberSince.className = "profile-muted";
  memberSince.textContent = sinceDate ? `Joined ${sinceDate}` : "Joined date unavailable";

  headingWrap.append(name, memberSince);
  header.append(avatar, headingWrap);
  card.appendChild(header);

  const bestRoles = getTopRoleByGroup(trackedRoles);
  if(bestRoles.length){
    const recordsSection = document.createElement("section");
    recordsSection.className = "profile-section";

    const recordsTitle = document.createElement("h2");
    recordsTitle.className = "profile-section-title";
    recordsTitle.textContent = "Qualified Personal Bests";
    recordsSection.appendChild(recordsTitle);

    const list = document.createElement("ul");
    list.className = "profile-record-list";
    list.dataset.count = String(bestRoles.length);

    for(const role of bestRoles){
      const item = document.createElement("li");
      item.className = "profile-record-item";
      if(isRecordRole(role.name)){
        item.classList.add("is-record");
      }

      const groupName = document.createElement("span");
      groupName.className = "profile-record-group";
      groupName.textContent = role.groupTitle;

      const roleName = document.createElement("span");
      roleName.className = "profile-record-name";
      appendRecordValue(roleName, displayRecordValue(role));

      item.append(groupName, roleName);
      list.appendChild(item);
    }

    recordsSection.appendChild(list);

    if(bestRoles.some(role => isRecordRole(role.name))){
      const recordKey = document.createElement("p");
      recordKey.className = "profile-record-key";

      const star = document.createElement("span");
      star.className = "profile-record-key-star";
      star.setAttribute("aria-label", "Gold star");
      star.textContent = "★";

      recordKey.append(star, document.createTextNode(" = RECORD"));
      recordsSection.appendChild(recordKey);
    }

    card.appendChild(recordsSection);
  }

  const rankedSection = renderRankedLeagueSection(rankedRows);
  if(rankedSection){
    card.appendChild(rankedSection);
  }

  const proLeagueSection = renderProLeagueSection(proLeagueAliases);
  if(proLeagueSection){
    card.appendChild(proLeagueSection);
  }

  const superLeagueSection = renderSuperLeagueSection(superLeaguePlayerName);
  if(superLeagueSection){
    card.appendChild(superLeagueSection);
  }

  card.appendChild(renderTournamentsSection(member));

  rootEl.appendChild(card);
  setStatus("");
}

async function loadPlayerProfile(){
  const discordId = getDiscordIdFromLocation();
  if(!discordId){
    renderNotFound();
    return;
  }

  setStatus("Loading player...");

  const [membersRes, linksRes, rankedRows, proLeagueAliases, superLeaguePlayerName] = await Promise.all([
    supabase
      .from("discord_guild_members")
      .select("discord_user_id,username,display_name,avatar_url,server_avatar_url,joined_at,is_current_member")
      .eq("discord_user_id", discordId)
      .eq("is_current_member", true)
      .limit(1),
    supabase
      .from("discord_member_roles")
      .select("role_id,discord_user_id")
      .eq("discord_user_id", discordId)
      .in("role_id", PLAYER_PROFILE_ROLE_IDS),
    loadRankedLeagueRows(discordId),
    loadProLeagueAliases(discordId),
    loadSuperLeaguePlayerName(discordId),
  ]);

  if(membersRes.error) throw membersRes.error;
  if(linksRes.error) throw linksRes.error;

  const member = (membersRes.data || [])[0];
  if(!member){
    renderNotFound();
    return;
  }

  const heldRoleIds = new Set((linksRes.data || []).map(row => row.role_id).filter(Boolean));
  let rolesById = new Map();

  if(heldRoleIds.size){
    const rolesRes = await supabase
      .from("discord_roles")
      .select("role_id,name")
      .in("role_id", [...heldRoleIds]);

    if(rolesRes.error) throw rolesRes.error;
    rolesById = new Map((rolesRes.data || []).map(role => [role.role_id, role]));
  }

  const trackedRoles = [];
  for(const group of RECORD_GROUPS){
    for(const roleId of group.roleIds){
      if(!heldRoleIds.has(roleId)) continue;
      const role = rolesById.get(roleId);
      trackedRoles.push({
        groupTitle: group.title,
        roleId,
        name: cleanRoleName(role?.name),
      });
    }
  }

  renderProfile(member, trackedRoles, rankedRows, proLeagueAliases, superLeaguePlayerName, heldRoleIds.has(VERIFIED_ROLE_ID));
}

loadPlayerProfile().catch(error => {
  console.error(error);
  setStatus(`Unable to load player: ${error?.message || "Unknown error"}`);
});
