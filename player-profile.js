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
const supabase = createBrowserSupabaseClient();
const rootEl = document.getElementById("player-root");
const statusEl = document.getElementById("player-status");
const RANKED_LEADERBOARD_SNAPSHOT_PATH = "/get_leaderboard_snapshot";

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

function renderProfile(member, trackedRoles, rankedRows = []){
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
  name.textContent = displayNameFor(member);

  const sinceDate = formatLongDate(member.joined_at);
  const memberSince = document.createElement("p");
  memberSince.className = "profile-muted";
  memberSince.textContent = sinceDate ? `Member since ${sinceDate}` : "Member since unavailable";

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

  const [membersRes, linksRes, rankedRows] = await Promise.all([
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
      .in("role_id", TRACKED_ROLE_IDS),
    loadRankedLeagueRows(discordId),
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

  renderProfile(member, trackedRoles, rankedRows);
}

loadPlayerProfile().catch(error => {
  console.error(error);
  setStatus(`Unable to load player: ${error?.message || "Unknown error"}`);
});
