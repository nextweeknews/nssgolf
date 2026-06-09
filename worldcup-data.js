export const WORLD_CUP_SHEET_ID = "1hmxKPrk4LH7U0kK60N6yghYB898GyTG0Erg3NtsGWXk";
export const WORLD_CUP_YEARS = [2025, 2024];
export const WORLD_CUP_WORKER_URL = "https://small-mud-2771.nextweekmedia.workers.dev/";

const TEAM_FLAG_CODES = {
  Australia: "au",
  Canada: "ca",
  China: "cn",
  England: "gb-eng",
  Europe: "eu",
  France: "fr",
  Germany: "de",
  "Hong Kong": "hk",
  India: "in",
  Ireland: "ie",
  Italy: "it",
  Jamaica: "jm",
  Japan: "jp",
  Mexico: "mx",
  Montenegro: "me",
  Netherlands: "nl",
  ROW: "un",
  Scotland: "gb-sct",
  "South Korea": "kr",
  Taiwan: "tw",
  USA: "us",
};

const BRACKET_ROUND_LABELS = {
  R24: "Round of 24",
  R16: "Round of 16",
  QF: "Quarterfinals",
  SF: "Semifinals",
  F: "Final",
  Final: "Final",
  "3rd": "Third Place",
};

function clean(value){
  return String(value ?? "").trim();
}

function rowValue(row, index){
  return clean(Array.isArray(row) ? row[index] : "");
}

export function normalizeWorldCupValues(resp){
  if(!resp) return [];
  if(resp.error) throw new Error(resp.error.message || "Google Sheets request failed.");
  if(Array.isArray(resp)) return resp;
  if(Array.isArray(resp.values)) return resp.values;
  if(Array.isArray(resp.data?.values)) return resp.data.values;
  if(Array.isArray(resp.result?.values)) return resp.result.values;
  return [];
}

export function normalizeWorldCupDiscordId(value){
  const text = clean(value);
  const mentionMatch = text.match(/^<@!?(\d+)>$/);
  const raw = mentionMatch ? mentionMatch[1] : text;
  return /^\d{5,}$/.test(raw) ? raw : "";
}

export function worldCupSheetName(year){
  return `World Cup ${year}`;
}

export function worldCupRange(year){
  return `'${worldCupSheetName(year)}'!A1:X120`;
}

async function readWorkerResponse(response){
  const text = await response.text();
  let payload = null;
  try{
    payload = text ? JSON.parse(text) : null;
  }catch{
    if(!response.ok) throw new Error(`Worker request failed (${response.status}).`);
    throw new Error("Worker returned an unreadable response.");
  }
  if(!response.ok){
    const message = payload?.error?.message || payload?.message || text;
    throw new Error(`Worker request failed (${response.status}). ${message}`.trim());
  }
  return normalizeWorldCupValues(payload);
}

function parseGvizResponse(text){
  const match = String(text || "").match(/google\.visualization\.Query\.setResponse\((.*)\);?\s*$/s);
  if(!match) throw new Error("Unable to parse Google Sheets response.");
  const payload = JSON.parse(match[1]);
  const rows = payload?.table?.rows ?? [];
  return rows.map(row => (row.c ?? []).map(cell => cell?.v ?? ""));
}

async function fetchWorldCupValuesGviz(year, sheetId){
  const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  url.searchParams.set("sheet", worldCupSheetName(year));
  url.searchParams.set("range", "A1:X120");
  const response = await fetch(url.toString());
  if(!response.ok){
    const text = await response.text().catch(() => "");
    throw new Error(`Google Sheets request failed (${response.status}). ${text}`.trim());
  }
  return parseGvizResponse(await response.text());
}

export async function fetchWorldCupValues(year, options = {}){
  const workerUrl = options.workerUrl || WORLD_CUP_WORKER_URL;
  const sheetId = options.sheetId || WORLD_CUP_SHEET_ID;
  const range = worldCupRange(year);
  const payload = { sheetId, range };
  let lastError = null;

  try{
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await readWorkerResponse(response);
  }catch(error){
    lastError = error;
    if(error?.message && !/Failed to fetch|NetworkError|Load failed/i.test(error.message)){
      throw error;
    }
  }

  try{
    const url = new URL(workerUrl);
    url.searchParams.set("sheetId", sheetId);
    url.searchParams.set("range", range);
    return await readWorkerResponse(await fetch(url.toString()));
  }catch(error){
    lastError = error;
    if(error?.message && !/Failed to fetch|NetworkError|Load failed/i.test(error.message)){
      throw error;
    }
  }

  try{
    return await fetchWorldCupValuesGviz(year, sheetId);
  }catch(error){
    throw lastError || error;
  }
}

export function baseWorldCupTeamName(teamName){
  const cleanName = clean(teamName).replace(/\s+/g, " ");
  return cleanName.replace(/\s+[A-G]$/i, "");
}

export function worldCupFlagCodeForTeam(teamName){
  if(/^bye$/i.test(clean(teamName))) return "";
  const base = baseWorldCupTeamName(teamName);
  return TEAM_FLAG_CODES[base] || TEAM_FLAG_CODES[clean(teamName)] || "xx";
}

export function worldCupFlagForTeam(teamName){
  return worldCupFlagCodeForTeam(teamName);
}

export function worldCupTeamParts(teamName){
  const name = clean(teamName);
  return {
    name,
    flagCode: name ? worldCupFlagCodeForTeam(name) : "",
  };
}

export function worldCupTeamLabel(teamName){
  return clean(teamName);
}

export function worldCupRoundLabel(round){
  const key = clean(round);
  return BRACKET_ROUND_LABELS[key] || key || "Round";
}

export function parseWorldCupScore(value){
  const text = clean(value);
  if(!text) return null;
  if(/^w$/i.test(text)) return { kind: "win", label: "W", number: null };
  if(/^f$/i.test(text)) return { kind: "forfeit", label: "F", number: null };
  const number = Number(text);
  if(Number.isFinite(number)) return { kind: "number", label: text, number };
  return { kind: "text", label: text, number: null };
}

function compareTeamName(left, right){
  return clean(left).localeCompare(clean(right), undefined, { sensitivity: "base" }) === 0;
}

export function getWorldCupMatchSide(match, teamName){
  if(compareTeamName(match?.team1, teamName)) return "team1";
  if(compareTeamName(match?.team2, teamName)) return "team2";
  return "";
}

export function getWorldCupMatchOutcome(match, teamName){
  const side = getWorldCupMatchSide(match, teamName);
  if(!side) return null;

  const otherSide = side === "team1" ? "team2" : "team1";
  const team = match[side];
  const opponent = match[otherSide];
  const teamScore = parseWorldCupScore(match[side === "team1" ? "score1" : "score2"]);
  const opponentScore = parseWorldCupScore(match[side === "team1" ? "score2" : "score1"]);
  const opponentIsBye = /^bye$/i.test(opponent);

  let outcome = "pending";
  if(opponentIsBye){
    outcome = "bye";
  }else if(teamScore?.kind === "win" || opponentScore?.kind === "forfeit"){
    outcome = "win";
  }else if(teamScore?.kind === "forfeit" || opponentScore?.kind === "win"){
    outcome = "loss";
  }else if(teamScore?.kind === "number" && opponentScore?.kind === "number"){
    if(teamScore.number > opponentScore.number) outcome = "win";
    if(teamScore.number < opponentScore.number) outcome = "loss";
    if(teamScore.number === opponentScore.number) outcome = "tie";
  }

  return {
    side,
    team,
    opponent,
    outcome,
    teamScore: teamScore?.label || "",
    opponentScore: opponentScore?.label || "",
    score: opponentIsBye ? "BYE" : `${teamScore?.label || "-"}-${opponentScore?.label || "-"}`,
  };
}

function parseRosters(rows){
  const teams = new Map();
  const players = [];

  rows.slice(1).forEach((row, index) => {
    const team = rowValue(row, 0);
    const playerName = rowValue(row, 1);
    if(!team || !playerName) return;
    const discordId = normalizeWorldCupDiscordId(rowValue(row, 2));
    const player = { team, playerName, discordId, rowIndex: index + 1 };
    players.push(player);
    if(!teams.has(team)) teams.set(team, { name: team, flag: worldCupFlagForTeam(team), players: [] });
    teams.get(team).players.push(player);
  });

  return {
    players,
    teams: [...teams.values()],
    teamMap: teams,
  };
}

function parseGroupBlock(rows, startIndex, year){
  const groupName = rowValue(rows[startIndex], 4);
  const recordHeader = year === 2024 ? "W-L-SDL" : "W-L-T";
  const standings = [];
  for(let offset = 1; offset <= 4; offset += 1){
    const row = rows[startIndex + offset] || [];
    const team = rowValue(row, 4);
    if(!team) continue;
    standings.push({
      rank: standings.length + 1,
      team,
      points: rowValue(row, 5),
      differential: rowValue(row, 6),
      record: rowValue(row, 7),
    });
  }

  const games = [];
  [9, 12, 15].forEach((columnStart, blockIndex) => {
    [[0, 1], [3, 4]].forEach(([topOffset, bottomOffset], pairIndex) => {
      const topRow = rows[startIndex + topOffset] || [];
      const bottomRow = rows[startIndex + bottomOffset] || [];
      const team1 = rowValue(topRow, columnStart);
      const team2 = rowValue(bottomRow, columnStart);
      if(!team1 && !team2) return;
      games.push({
        id: `${groupName}-${blockIndex + 1}-${pairIndex + 1}`,
        group: groupName,
        block: blockIndex + 1,
        team1,
        score1: rowValue(topRow, columnStart + 1),
        team2,
        score2: rowValue(bottomRow, columnStart + 1),
      });
    });
  });

  return { name: groupName, recordHeader, standings, games };
}

function parseGroups(rows, year){
  const groups = [];
  rows.forEach((row, index) => {
    const label = rowValue(row, 4);
    if(/^Group\s+[A-Z]$/i.test(label)){
      groups.push(parseGroupBlock(rows, index, year));
    }
  });
  return groups;
}

function parseBracket(rows){
  return rows.slice(1).map((row) => {
    const idText = rowValue(row, 18);
    const round = rowValue(row, 19);
    const team1 = rowValue(row, 20);
    const team2 = rowValue(row, 22);
    if(!idText && !round && !team1 && !team2) return null;
    return {
      id: Number(idText) || null,
      round,
      team1,
      score1: rowValue(row, 21),
      team2,
      score2: rowValue(row, 23),
    };
  }).filter(Boolean);
}

export function parseWorldCupSheet(values, options = {}){
  const year = Number(options.year) || null;
  const rows = Array.isArray(values) ? values : [];
  const roster = parseRosters(rows);
  const groups = parseGroups(rows, year);
  const bracket = parseBracket(rows);
  const groupByTeam = new Map();
  groups.forEach((group) => {
    group.standings.forEach((standing) => {
      groupByTeam.set(standing.team, { group, standing });
    });
  });

  return {
    year,
    rows,
    rosters: roster.teams,
    rosterPlayers: roster.players,
    rosterTeamMap: roster.teamMap,
    groups,
    bracket,
    groupByTeam,
  };
}

export function findWorldCupTeamNamesForDiscordId(data, discordId){
  const cleanDiscordId = normalizeWorldCupDiscordId(discordId);
  if(!cleanDiscordId) return [];
  return [...new Set((data?.rosterPlayers || [])
    .filter(player => normalizeWorldCupDiscordId(player.discordId) === cleanDiscordId)
    .map(player => player.team)
    .filter(Boolean))];
}

export function worldCupMatchesForTeam(data, teamName){
  const groupEntry = data?.groupByTeam?.get(teamName) || null;
  const groupMatches = (groupEntry?.group?.games || [])
    .filter(match => getWorldCupMatchSide(match, teamName))
    .map(match => ({ ...match, stage: "Group Stage", round: groupEntry.group.name }));
  const bracketMatches = (data?.bracket || [])
    .filter(match => getWorldCupMatchSide(match, teamName))
    .map(match => ({ ...match, stage: "Bracket Stage", round: worldCupRoundLabel(match.round) }));
  return { groupEntry, groupMatches, bracketMatches };
}
