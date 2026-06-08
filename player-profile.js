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

function renderProfile(member, trackedRoles, rankedRows = [], proLeagueAliases = [], isVerified = false){
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

  const [membersRes, linksRes, rankedRows, proLeagueAliases] = await Promise.all([
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

  renderProfile(member, trackedRoles, rankedRows, proLeagueAliases, heldRoleIds.has(VERIFIED_ROLE_ID));
}

loadPlayerProfile().catch(error => {
  console.error(error);
  setStatus(`Unable to load player: ${error?.message || "Unknown error"}`);
});
