import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js?v=20260817-singleton";
import {
  addedPlayerRowSaveState,
  bracketRoundLabel,
  buildEditorTables,
  buildUpdates,
  editorMatchups,
  editorPlayerName,
  editorPlayerOptions,
  isEditorRowSelected,
  isEditorRowVisible,
  matchupHasBye,
  nextBlankPlayerRow,
  orderEditorRowsByPlayerSelection,
  playerFilterBackspaceState,
  proLeagueViewKey,
  superLeagueDivisionClass,
  superLeagueViewKey,
} from "/admin/tournament-results-core.mjs?v=20260817-player-order";
import { SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON, SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE, SUPER_LEAGUE_SEASON } from "/config.js";
import { getProLeagueTeamStyle, proLeagueTeamLogoSrc } from "/proleague/team-presentation.mjs?v=20260817-editor";

const DEFAULT_WORKER_URL = "https://small-mud-2771.nextweekmedia.workers.dev/admin/tournament-results";
const runtimeConfig = globalThis.NSSGOLF_TOURNAMENT_EDITOR_CONFIG || {};
const workerUrl = String(runtimeConfig.workerUrl || DEFAULT_WORKER_URL).trim();
const eventKey = new URL(globalThis.location.href).searchParams.get("eventKey")?.trim() || "";
const supabase = createBrowserSupabaseClient();

const accessPanel = document.getElementById("editorAccessPanel");
const accessSpinner = document.getElementById("editorAccessSpinner");
const editorPanel = document.getElementById("editorPanel");
const loginButton = document.getElementById("editorLoginBtn");
const accessStatus = document.getElementById("editorAccessStatus");
const pageTitle = document.getElementById("editorTitle");
const saveButton = document.getElementById("editorSaveBtn");
const resetButton = document.getElementById("editorResetBtn");
const dirtyCount = document.getElementById("editorDirtyCount");
const viewTabs = document.getElementById("editorViewTabs");
const tablesMount = document.getElementById("editorTables");
const periodControls = document.getElementById("editorPeriodControls");
const seasonSelect = document.getElementById("editorSeasonSelect");
const seasonLabel = document.getElementById("editorSeasonLabel");
const stageWrap = document.getElementById("editorStageWrap");
const stageSelect = document.getElementById("editorStageSelect");
const playerFilter = document.getElementById("editorPlayerFilter");
const playerFilterField = document.getElementById("editorPlayerFilterField");
const playerFilterEntry = document.getElementById("editorPlayerFilterEntry");
const playerFilterChips = document.getElementById("editorPlayerFilterChips");
const playerFilterInput = document.getElementById("editorPlayerFilterInput");
const playerFilterOptions = document.getElementById("editorPlayerFilterOptions");
const playerFilterClear = document.getElementById("editorPlayerFilterClear");

const state = {
  event: null,
  tables: [],
  currentValues: new Map(),
  activeGroupKey: "",
  activeViewKey: "",
  selectedPlayers: new Map(),
  armedPlayerFilter: "",
  addedPlayerRows: new Set(),
  saving: false,
};

let editorMessage = "";
let editorMessageTone = "";
let editorMessageTimer = 0;

const EVENT_ACCENT_RGB = {
  masters:"250,204,21",
  championship:"190,242,100",
  proleague:"125,211,252",
  superleague:"209,118,255",
  worldopen:"93,255,156",
  lightningcup:"246,255,106",
  noptational:"129,140,248",
  worldcup:"96,165,250",
};
const LIGHTNING_CUP_ACCENT_RGB = {
  "wii-plaza":"250,204,21",
  "wuhu-island":"168,85,247",
  "wedge-island":"125,211,252",
  "spocco-square":"249,115,22",
  finals:"234,179,8",
};

function applyEditorTheme(groupKey = ""){
  const accent = state.event?.eventKey === "lightningcup"
    ? LIGHTNING_CUP_ACCENT_RGB[groupKey] || EVENT_ACCENT_RGB.lightningcup
    : EVENT_ACCENT_RGB[state.event?.eventKey] || "125,211,252";
  document.documentElement.style.setProperty("--region-accent-rgb", accent);
}

function setAccessStatus(message, tone = ""){
  accessStatus.textContent = message || "";
  accessStatus.className = `editor-status ${tone}`.trim();
}

function setEditorStatus(message, tone = ""){
  clearTimeout(editorMessageTimer);
  editorMessage = message || "";
  editorMessageTone = tone;
  updateActions();
  if(editorMessage && tone === "success"){
    editorMessageTimer = setTimeout(() => {
      editorMessage = "";
      editorMessageTone = "";
      updateActions();
    }, 2500);
  }
}

function errorMessage(data, fallback){
  return typeof data?.error === "string" && data.error.trim() ? data.error : fallback;
}

function showAccessPanel({ message = "", tone = "", canSignIn = false, loading = false }){
  editorPanel.hidden = true;
  accessPanel.hidden = false;
  accessPanel.classList.toggle("is-loading", loading);
  accessSpinner.hidden = !loading;
  accessStatus.hidden = loading;
  loginButton.hidden = loading || !canSignIn;
  if(!loading) setAccessStatus(message, tone);
}

async function requestHeaders(){
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session || null;
  if(error || !session?.access_token) throw new Error("Your session has expired. Sign in again.");
  return {
    Accept: "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

function allEditableCells(){
  return state.tables.flatMap((table) => table.rows.flatMap((row) => row.editableCells));
}

function dirtyCells(){
  return allEditableCells().filter((cell) => state.currentValues.get(cell.range) !== cell.initialValue);
}

function hasUnsavedWork(){
  return dirtyCells().length > 0 || state.addedPlayerRows.size > 0;
}

function updateActions(){
  const count = dirtyCells().length;
  const addedCount = state.addedPlayerRows.size;
  const locked = !state.event?.canEdit || state.saving;
  const cellText = count ? `${count} unsaved ${count === 1 ? "cell" : "cells"}` : "";
  const rowText = addedCount ? `${addedCount} new player ${addedCount === 1 ? "row" : "rows"}` : "";
  dirtyCount.textContent = editorMessage || [cellText, rowText].filter(Boolean).join(" · ") || "No unsaved changes";
  dirtyCount.classList.toggle("has-changes", !editorMessage && (count > 0 || addedCount > 0));
  dirtyCount.classList.toggle("error", editorMessageTone === "error");
  dirtyCount.classList.toggle("success", editorMessageTone === "success");
  saveButton.disabled = locked || (!count && !addedCount);
  resetButton.disabled = state.saving || (!count && !addedCount);

  tablesMount.querySelectorAll("input[data-score-range]").forEach((input) => {
    const range = input.dataset.scoreRange;
    input.disabled = locked;
    input.closest("td")?.classList.toggle("is-dirty", state.currentValues.get(range) !== input.dataset.initialValue);
  });
  tablesMount.querySelectorAll("input[data-player-name-range]").forEach((input) => {
    const range = input.dataset.playerNameRange;
    input.disabled = locked;
    input.closest("td")?.classList.toggle("is-dirty", state.currentValues.get(range) !== input.dataset.initialValue);
  });
  tablesMount.querySelectorAll("button[data-add-player-table]").forEach((button) => {
    const table = state.tables.find((candidate) => candidate.key === button.dataset.addPlayerTable);
    button.disabled = locked || !table || !nextBlankPlayerRow(table, state.currentValues, state.addedPlayerRows);
  });
}

function contextLabel(row){
  return row.context.length ? row.context.join(" · ") : `Sheet row ${row.sourceRow}`;
}

function appendTextCell(rowEl, value, className = ""){
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = value || "—";
  rowEl.appendChild(cell);
}

function playerNameForRow(row){
  return editorPlayerName(row, state.currentValues);
}

function worldOpenRemainingPlayers(table, row){
  const used = new Set(table.rows
    .filter((candidate) => candidate !== row)
    .map((candidate) => playerNameForRow(candidate).toLowerCase())
    .filter(Boolean));
  const current = playerNameForRow(row).toLowerCase();
  return table.playerOptions.filter((name) => name.toLowerCase() === current || !used.has(name.toLowerCase()));
}

function appendPlayerCell(rowEl, row, className = "", table = null){
  const cell = document.createElement("td");
  cell.className = "editor-player-cell";
  if(className) cell.classList.add(className);
  if(state.event?.eventKey === "proleague") cell.classList.add("is-pro-league");
  const playerName = playerNameForRow(row);
  if(row.nameCell && state.currentValues.get(row.nameCell.range) !== row.nameCell.initialValue){
    cell.classList.add("is-dirty");
  }
  const style = getProLeagueTeamStyle(row.teamName);
  if(row.teamName) cell.classList.add("has-team-style");
  if(style){
    cell.style.background = style.bg;
    cell.style.color = style.fg;
  }
  if(row.teamName){
    const logo = document.createElement("img");
    logo.className = "editor-team-logo";
    logo.src = proLeagueTeamLogoSrc(row.teamName);
    logo.alt = `${row.teamName} logo`;
    logo.loading = "lazy";
    logo.addEventListener("error", () => logo.remove());
    cell.appendChild(logo);
  }
  if(state.addedPlayerRows.has(row.key) || (state.event?.eventKey === "worldopen" && row.nameCell)){
    const input = document.createElement("input");
    input.className = "editor-player-name-input";
    input.type = state.event?.eventKey === "worldopen" ? "search" : "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Player name";
    input.value = playerName;
    input.dataset.initialValue = row.nameCell.initialValue;
    input.dataset.playerNameRange = row.nameCell.range;
    input.setAttribute("aria-label", `Player name, sheet row ${row.sourceRow}`);
    if(state.event?.eventKey === "worldopen" && table){
      const list = document.createElement("datalist");
      list.id = `world-open-options-${row.key}`;
      list.replaceChildren(...worldOpenRemainingPlayers(table, row).map((optionName) => {
        const option = document.createElement("option");
        option.value = optionName;
        return option;
      }));
      input.setAttribute("list", list.id);
      input.dataset.worldOpenPlayer = "true";
      input.dataset.tableKey = table.key;
      input.dataset.rowKey = row.key;
      input.setAttribute("aria-description", "Search players remaining in this round's Field column");
      cell.append(input, list);
    }else{
      cell.appendChild(input);
    }
  }else{
    const name = document.createElement("span");
    name.textContent = playerName || "—";
    cell.appendChild(name);
  }
  rowEl.appendChild(cell);
}

function appendScoreCell(rowEl, scoreCell, playerLabel, weekSeparator = false){
  const cell = document.createElement("td");
  cell.className = "editor-score-cell";
  if(scoreCell?.type === "result") cell.classList.add("is-result");
  if(scoreCell?.type === "sudden-death") cell.classList.add("editor-sudden-death");
  if(weekSeparator) cell.classList.add("editor-week-separator");
  if(!scoreCell){
    cell.classList.add("is-unavailable");
    cell.textContent = "—";
    rowEl.appendChild(cell);
    return;
  }

  const input = document.createElement("input");
  input.className = "editor-score-input";
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = state.currentValues.get(scoreCell.range) ?? scoreCell.initialValue;
  input.dataset.initialValue = scoreCell.initialValue;
  input.dataset.scoreRange = scoreCell.range;
  input.setAttribute("aria-label", `${playerLabel}, ${scoreCell.label}, sheet row ${scoreCell.row}`);
  input.disabled = !state.event.canEdit;
  cell.appendChild(input);
  rowEl.appendChild(cell);
}

function appendHeaderCell(rowEl, label, className = ""){
  const header = document.createElement("th");
  header.scope = "col";
  header.textContent = label;
  if(className) header.classList.add(className);
  rowEl.appendChild(header);
}

function appendBracketPlayerHeaders(headerRow, table, playerNumber, showSeed = false){
  if(showSeed) appendHeaderCell(headerRow, "Seed", playerNumber === 2 ? "editor-matchup-separator" : "");
  appendHeaderCell(headerRow, `Player ${playerNumber}`, playerNumber === 2 && !showSeed ? "editor-matchup-separator" : "");
  for(let round = 1; round <= table.maxRoundCount; round += 1){
    appendHeaderCell(headerRow, table.rows[0]?.roundScores[round - 1]?.label || `R${round}`);
  }
  const formulaHeaders = table.rows.find((row) => row.playerSlot === playerNumber && row.formulaCells.length)?.formulaCells || [];
  for(let formula = 0; formula < table.maxFormulaCount; formula += 1){
    appendHeaderCell(headerRow, formulaHeaders[formula]?.label || "");
  }
  if(table.hasSuddenDeath) appendHeaderCell(headerRow, "SD", "editor-sudden-death");
  if(table.hasResult) appendHeaderCell(headerRow, "Score");
}

function appendFormulaCell(rowEl, formulaCell){
  const cell = document.createElement("td");
  cell.className = "editor-formula-cell";
  cell.textContent = formulaCell?.initialValue || "—";
  rowEl.appendChild(cell);
}

function appendBracketPlayerCells(rowEl, table, row, playerNumber, showSeed = false){
  const separator = playerNumber === 2 ? "editor-matchup-separator" : "";
  if(!row){
    if(showSeed) appendTextCell(rowEl, "", `editor-seed-cell ${separator}`.trim());
    appendTextCell(rowEl, "", `editor-player-cell ${showSeed ? "" : separator}`.trim());
    for(let round = 0; round < table.maxRoundCount; round += 1) appendScoreCell(rowEl, null, `Player ${playerNumber}`);
    for(let formula = 0; formula < table.maxFormulaCount; formula += 1) appendFormulaCell(rowEl, null);
    if(table.hasSuddenDeath) appendScoreCell(rowEl, null, `Player ${playerNumber}`);
    if(table.hasResult) appendScoreCell(rowEl, null, `Player ${playerNumber}`);
    return;
  }

  if(showSeed) appendTextCell(rowEl, row.seed, `editor-seed-cell ${separator}`.trim());
  appendPlayerCell(rowEl, row, showSeed ? "" : separator, table);
  const playerLabel = playerNameForRow(row) || `Player slot ${row.playerSlot}`;
  for(let round = 0; round < table.maxRoundCount; round += 1){
    appendScoreCell(rowEl, row.roundScores[round], playerLabel);
  }
  for(let formula = 0; formula < table.maxFormulaCount; formula += 1){
    appendFormulaCell(rowEl, row.formulaCells[formula]);
  }
  if(table.hasSuddenDeath) appendScoreCell(rowEl, row.suddenDeath, playerLabel);
  if(table.hasResult) appendScoreCell(rowEl, row.result, playerLabel);
}

function createBracketMatchupTable(table, visibleRows){
  const section = document.createElement("section");
  section.className = "editor-table-section";
  section.dataset.groupKey = table.groupKey;
  section.setAttribute("aria-label", table.groupLabel || table.label);

  const scroll = document.createElement("div");
  scroll.className = "editor-table-scroll";
  const tableEl = document.createElement("table");
  tableEl.className = "editor-table is-bracket-matchups";
  if(state.event?.eventKey === "championship") tableEl.classList.add("is-championship-matchups");
  const isSuperLeague = state.event?.eventKey === "superleague";
  const isSeason = isSuperLeague && table.key.endsWith("-season");
  const isPromotions = isSuperLeague && table.key.endsWith("-promotions");
  const isWinners = isSuperLeague && table.key.endsWith("-qualifier-winners");
  const showSeed = (table.matchupLayout && !table.hideSeed) || (isSuperLeague && !isSeason);
  if(isSuperLeague){
    tableEl.classList.add("is-superleague-matchups");
    if(isSeason) tableEl.classList.add("is-superleague-season");
    if(isPromotions) tableEl.classList.add("is-superleague-promotions");
    if(isWinners) tableEl.classList.add("is-superleague-winners");
  }
  const headerRow = document.createElement("tr");
  if(table.hideContext){
    // The active tab already supplies the round or region label.
  }else if(isSeason || isPromotions){
    appendHeaderCell(headerRow, isPromotions ? "Round" : "Week");
    appendHeaderCell(headerRow, "Division");
  }else{
    appendHeaderCell(headerRow, !isSuperLeague || isWinners ? "Round" : "Match / source");
  }
  appendBracketPlayerHeaders(headerRow, table, 1, showSeed);
  appendBracketPlayerHeaders(headerRow, table, 2, showSeed);
  const thead = document.createElement("thead");
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  editorMatchups(visibleRows).filter((matchup) => (
    !isSuperLeague || (!matchupHasBye(matchup, state.currentValues) && matchup.players.some((row) => (
      playerNameForRow(row)
      || row.seed
      || row.context.some((value) => value.trim())
      || row.editableCells.some((cell) => cell.initialValue)
    )))
  ) && matchup.players.some((row) => (
    playerNameForRow(row)
    || row.seed
    || row.context.some((value) => value.trim())
    || row.editableCells.some((cell) => String(cell.initialValue).trim())
  ))).forEach((matchup) => {
    const rowEl = document.createElement("tr");
    rowEl.dataset.sourceRow = String(matchup.sourceRow);
    const firstPlayer = matchup.players[0];
    if(table.hideContext){
      // No leading context cell for tab-scoped matchup tables.
    }else if(isSeason || isPromotions){
      if(isSeason) rowEl.classList.add(superLeagueDivisionClass(firstPlayer.context[1]));
      appendTextCell(rowEl, firstPlayer.context[0], "editor-context-cell editor-period-cell");
      appendTextCell(rowEl, firstPlayer.context[1], "editor-context-cell editor-division-cell");
    }else{
      const context = isWinners
        ? firstPlayer.context[1]
        : state.event?.eventKey === "lightningcup" ? bracketRoundLabel(firstPlayer) : contextLabel(firstPlayer);
      appendTextCell(rowEl, context, "editor-context-cell");
    }
    appendBracketPlayerCells(rowEl, table, matchup.players.find((row) => row.playerSlot === 1), 1, showSeed);
    appendBracketPlayerCells(rowEl, table, matchup.players.find((row) => row.playerSlot === 2), 2, showSeed);
    tbody.appendChild(rowEl);
  });

  tableEl.append(thead, tbody);
  scroll.appendChild(tableEl);
  section.appendChild(scroll);
  return section;
}

function visibleRowsForTable(table){
  const isMatchupTable = table.matchupLayout || ["masters", "championship", "superleague"].includes(state.event?.eventKey);
  const rows = table.rows.filter((row) => (
    (isEditorRowVisible(row, state.currentValues) || state.addedPlayerRows.has(row.key))
    && (state.addedPlayerRows.has(row.key) || isEditorRowSelected(
      row,
      state.currentValues,
      state.selectedPlayers.keys(),
      isMatchupTable ? table.rows : [],
    ))
  ));
  return state.event?.eventKey === "proleague" && state.selectedPlayers.size
    ? orderEditorRowsByPlayerSelection(rows, state.currentValues, state.selectedPlayers.keys())
    : rows;
}

function createTable(table, rows = null){
  const isMatchupTable = table.matchupLayout || ["masters", "championship", "superleague"].includes(state.event?.eventKey);
  const visibleRows = rows || visibleRowsForTable(table);
  if(state.selectedPlayers.size && !visibleRows.length) return null;
  if(isMatchupTable){
    return createBracketMatchupTable(table, visibleRows);
  }

  const section = document.createElement("section");
  section.className = "editor-table-section";
  section.dataset.groupKey = table.groupKey;
  const showHeading = !table.groupKey && (state.event?.eventKey !== "proleague" || table.label !== "Player scores");
  section.setAttribute(showHeading ? "aria-labelledby" : "aria-label", showHeading ? `editor-table-${table.key}` : table.label);

  const heading = document.createElement("div");
  heading.className = "editor-table-heading";
  const title = document.createElement("h2");
  title.id = `editor-table-${table.key}`;
  title.textContent = table.label;
  const meta = document.createElement("span");
  meta.textContent = table.sheetName;
  heading.append(title, meta);

  const scroll = document.createElement("div");
  scroll.className = "editor-table-scroll";
  const tableEl = document.createElement("table");
  tableEl.className = "editor-table";
  if(state.event?.eventKey === "proleague") tableEl.classList.add("is-pro-league");

  const headerRow = document.createElement("tr");
  const hasHeaderGroups = table.headerGroups.length > 0;
  if(hasHeaderGroups) headerRow.className = "editor-header-group-row";
  const leadingHeaders = [
    ...(!table.hideContext ? ["Match / source"] : []),
    ...(!table.hideSeed ? ["Seed"] : []),
    "Player",
  ];
  leadingHeaders.forEach((label) => {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = label;
    if(hasHeaderGroups) header.rowSpan = 2;
    headerRow.appendChild(header);
  });
  if(hasHeaderGroups){
    table.headerGroups.forEach((group) => {
      const header = document.createElement("th");
      header.scope = "colgroup";
      header.colSpan = group.span;
      header.textContent = group.label;
      headerRow.appendChild(header);
    });
  }
  const roundHeaderRow = hasHeaderGroups ? document.createElement("tr") : headerRow;
  if(hasHeaderGroups) roundHeaderRow.className = "editor-header-round-row";
  for(let round = 1; round <= table.maxRoundCount; round += 1){
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = table.rows[0]?.roundScores[round - 1]?.label || `R${round}`;
    if(table.roundLabelStyle === "week-round" && round % 2 === 0 && round < table.maxRoundCount){
      header.classList.add("editor-week-separator");
    }
    roundHeaderRow.appendChild(header);
  }
  if(table.hasSuddenDeath){
    const header = document.createElement("th");
    header.scope = "col";
    header.className = "editor-sudden-death";
    header.textContent = "SD";
    roundHeaderRow.appendChild(header);
  }
  if(table.hasResult){
    const resultHeader = document.createElement("th");
    resultHeader.scope = "col";
    resultHeader.textContent = "Result";
    roundHeaderRow.appendChild(resultHeader);
  }

  const thead = document.createElement("thead");
  thead.appendChild(headerRow);
  if(hasHeaderGroups) thead.appendChild(roundHeaderRow);
  const tbody = document.createElement("tbody");

  visibleRows.forEach((row) => {
    const rowEl = document.createElement("tr");
    rowEl.dataset.sourceRow = String(row.sourceRow);
    if(!playerNameForRow(row) && !row.editableCells.some((cell) => cell.initialValue)) rowEl.classList.add("is-empty-player");
    if(!table.hideContext) appendTextCell(rowEl, contextLabel(row), "editor-context-cell");
    if(!table.hideSeed) appendTextCell(rowEl, row.seed, "editor-seed-cell");
    appendPlayerCell(rowEl, row, "", table);
    const playerLabel = playerNameForRow(row) || `Player slot ${row.playerSlot}`;
    for(let round = 0; round < table.maxRoundCount; round += 1){
      appendScoreCell(
        rowEl,
        row.roundScores[round],
        playerLabel,
        table.roundLabelStyle === "week-round" && round % 2 === 1 && round < table.maxRoundCount - 1,
      );
    }
    if(table.hasSuddenDeath) appendScoreCell(rowEl, row.suddenDeath, playerLabel);
    if(table.hasResult) appendScoreCell(rowEl, row.result, playerLabel);
    tbody.appendChild(rowEl);
  });

  tableEl.append(thead, tbody);
  scroll.appendChild(tableEl);
  if(showHeading) section.appendChild(heading);
  section.appendChild(scroll);
  if(table.canAddPlayers){
    const addButton = document.createElement("button");
    addButton.className = "editor-button editor-add-player";
    addButton.type = "button";
    addButton.dataset.addPlayerTable = table.key;
    addButton.textContent = "Add player";
    section.appendChild(addButton);
  }
  return section;
}

function createWorldCupGroupStageSections(){
  const groupTables = state.tables.filter((table) => table.groupKey === "group-stage");
  const standings = groupTables.find((table) => table.key === "group-standings");
  const rounds = groupTables.filter((table) => /^group-games-\d+$/.test(table.key));
  if(!standings || !rounds.length) return [];

  const groupNames = [];
  const seen = new Set();
  groupTables.forEach((table) => table.rows.forEach((row) => {
    const name = row.context[0]?.trim();
    if(!/^Group\s+[A-Z]$/i.test(name || "") || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    groupNames.push(name);
  }));

  return groupNames.map((groupName) => {
    const section = document.createElement("section");
    section.className = "editor-table-section editor-worldcup-group";
    section.dataset.groupKey = "group-stage";
    section.setAttribute("aria-labelledby", `editor-worldcup-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);

    const title = document.createElement("h2");
    title.className = "editor-worldcup-group-title";
    title.id = section.getAttribute("aria-labelledby");
    title.textContent = groupName;

    const layout = document.createElement("div");
    layout.className = "editor-worldcup-group-layout";
    const tables = [standings, ...rounds].map((table, index) => {
      const groupRows = visibleRowsForTable(table).filter((row) => row.context[0]?.trim() === groupName);
      if(!groupRows.length) return null;
      const wrapper = document.createElement("div");
      wrapper.className = index === 0 ? "editor-worldcup-standings" : "editor-worldcup-round";
      if(index > 0){
        const roundTitle = document.createElement("h3");
        roundTitle.className = "editor-worldcup-round-title";
        roundTitle.textContent = `Round ${index}`;
        wrapper.appendChild(roundTitle);
      }
      const tableSection = createTable({ ...table, hideContext:true }, groupRows);
      if(tableSection) wrapper.appendChild(tableSection);
      return wrapper;
    }).filter(Boolean);
    if(!tables.length) return null;
    layout.append(...tables);
    section.append(title, layout);
    return section;
  }).filter(Boolean);
}

function renderTables(){
  const isWorldCup = state.event?.eventKey === "worldcup";
  const sections = isWorldCup
    ? [
        ...createWorldCupGroupStageSections(),
        ...state.tables.filter((table) => table.groupKey !== "group-stage").map((table) => createTable(table)).filter(Boolean),
      ]
    : state.tables.map((table) => createTable(table)).filter(Boolean);
  tablesMount.replaceChildren(...sections);
  renderEditorTabs();
  refreshWorldOpenPlayerInputs();
  updateActions();
}

function refreshWorldOpenPlayerInputs(){
  if(state.event?.eventKey !== "worldopen") return;
  tablesMount.querySelectorAll("input[data-world-open-player]").forEach((input) => {
    const table = state.tables.find((candidate) => candidate.key === input.dataset.tableKey);
    const row = table?.rows.find((candidate) => candidate.key === input.dataset.rowKey);
    const list = input.list;
    if(!table || !row || !list) return;
    list.replaceChildren(...worldOpenRemainingPlayers(table, row).map((optionName) => {
      const option = document.createElement("option");
      option.value = optionName;
      return option;
    }));
  });
}

function editorGroups(){
  const groups = [];
  const seen = new Set();
  state.tables.forEach((table) => {
    if(!table.groupKey || seen.has(table.groupKey)) return;
    seen.add(table.groupKey);
    groups.push({ key: table.groupKey, label: table.groupLabel || table.groupKey });
  });
  const order = state.event?.eventKey === "masters"
    ? ["bracket", "qualifiers"]
    : state.event?.eventKey === "superleague"
      ? ["season", "playoffs", "qualifier-winners", "qualifier-losers", "promotions"]
      : [];
  return order.length
    ? groups.sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key))
    : groups;
}

function syncMastersUrls(groupKey, historyMode = "replace"){
  if(state.event?.eventKey !== "masters") return;
  const view = groupKey === "qualifiers" ? "qualifiers" : "bracket";
  const editorUrl = new URL(globalThis.location.href);
  editorUrl.searchParams.set("view", view);
  const nextEditorUrl = `${editorUrl.pathname}${editorUrl.search}${editorUrl.hash}`;
  const currentEditorUrl = `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
  if(nextEditorUrl !== currentEditorUrl) globalThis.history[`${historyMode}State`](null, "", nextEditorUrl);

}

function syncSuperLeagueUrls(groupKey, historyMode = "replace"){
  if(state.event?.eventKey !== "superleague") return;
  const view = periodViews().find((candidate) => candidate.key === state.activeViewKey) || periodViews()[0];
  if(!view) return;
  const editorParams = new URLSearchParams({
    eventKey:"superleague",
    season:String(view.seasonValue),
    view:groupKey || "season",
  });
  globalThis.history[`${historyMode}State`](null, "", `${globalThis.location.pathname}?${editorParams}`);

}

function syncAdditionalEventUrls(groupKey, historyMode = "replace"){
  if(!["worldopen", "lightningcup", "noptational", "worldcup"].includes(state.event?.eventKey)) return;
  const editorUrl = new URL(globalThis.location.href);
  editorUrl.searchParams.set("view", groupKey);
  if(["worldopen", "noptational", "worldcup"].includes(state.event.eventKey)){
    const view = activePeriodView() || periodViews()[0];
    if(view?.seasonValue) editorUrl.searchParams.set("year", String(view.seasonValue));
  }
  const nextUrl = `${editorUrl.pathname}${editorUrl.search}${editorUrl.hash}`;
  const currentUrl = `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
  if(nextUrl !== currentUrl) globalThis.history[`${historyMode}State`](null, "", nextUrl);
}

function showEditorGroup(groupKey, historyMode = "replace"){
  state.activeGroupKey = groupKey;
  viewTabs.querySelectorAll("[role='tab']").forEach((tab) => {
    const selected = tab.dataset.groupKey === groupKey;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  tablesMount.querySelectorAll(".editor-table-section").forEach((section) => {
    section.hidden = Boolean(groupKey) && section.dataset.groupKey !== groupKey;
  });
  syncMastersUrls(groupKey, historyMode);
  syncSuperLeagueUrls(groupKey, historyMode);
  syncAdditionalEventUrls(groupKey, historyMode);
  applyEditorTheme(groupKey);
}

function renderEditorTabs(){
  viewTabs.classList.toggle("is-radix", state.event?.eventKey !== "proleague");
  if(state.event?.eventKey === "proleague"){
    viewTabs.hidden = true;
    viewTabs.replaceChildren();
    return;
  }
  const groups = editorGroups();
  viewTabs.style.setProperty("--editor-tab-columns", String(groups.length || 1));
  viewTabs.hidden = groups.length < 2;
  viewTabs.replaceChildren(...groups.map((group) => {
    const button = document.createElement("button");
    button.className = "editor-view-tab";
    button.type = "button";
    button.role = "tab";
    button.dataset.groupKey = group.key;
    button.textContent = group.label;
    button.addEventListener("click", () => showEditorGroup(group.key, "push"));
    return button;
  }));

  const activeGroup = groups.some((group) => group.key === state.activeGroupKey)
    ? state.activeGroupKey
    : (state.event?.eventKey === "masters" ? "bracket" : (groups[0]?.key || ""));
  showEditorGroup(activeGroup);
}

function periodViews(){
  return Array.isArray(state.event?.views) ? state.event.views : [];
}

function activePeriodView(){
  return periodViews().find((view) => view.key === state.activeViewKey) || null;
}

function hidePlayerFilterOptions(){
  playerFilterOptions.hidden = true;
  playerFilterInput.setAttribute("aria-expanded", "false");
}

function renderPlayerFilterOptions(){
  const query = playerFilterInput.value.trim().toLowerCase();
  const matches = query
    ? editorPlayerOptions(state.tables, state.currentValues)
      .filter((name) => name.toLowerCase().includes(query) && !state.selectedPlayers.has(name.toLowerCase()))
      .slice(0, 8)
    : [];
  playerFilterOptions.replaceChildren(...matches.map((name) => {
    const option = document.createElement("button");
    option.type = "button";
    option.role = "option";
    option.dataset.playerName = name;
    option.textContent = name;
    return option;
  }));
  playerFilterOptions.hidden = !matches.length;
  playerFilterInput.setAttribute("aria-expanded", String(matches.length > 0));
}

function updatePlayerFilterPlaceholder(){
  playerFilterInput.placeholder = (
    document.activeElement === playerFilterInput
    || playerFilterInput.value
    || state.selectedPlayers.size
  ) ? "" : "Filter by individual players";
}

function renderPlayerFilter(scrollToEnd = false){
  if(!state.selectedPlayers.has(state.armedPlayerFilter)) state.armedPlayerFilter = "";
  playerFilterChips.replaceChildren(...[...state.selectedPlayers.values()].map((name) => {
    const chip = document.createElement("span");
    chip.className = "editor-player-filter-chip";
    chip.classList.toggle("is-selected", name.toLowerCase() === state.armedPlayerFilter);
    chip.dataset.playerFilterToken = name;
    chip.append(name);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.removePlayer = name;
    remove.setAttribute("aria-label", `Remove ${name} filter`);
    remove.textContent = "×";
    chip.appendChild(remove);
    return chip;
  }));
  playerFilterClear.hidden = !state.selectedPlayers.size;
  updatePlayerFilterPlaceholder();
  renderPlayerFilterOptions();
  if(scrollToEnd) playerFilterEntry.scrollLeft = playerFilterEntry.scrollWidth;
}

function addPlayerFilter(name){
  const cleanName = String(name || "").trim();
  if(!cleanName) return;
  state.selectedPlayers.set(cleanName.toLowerCase(), cleanName);
  state.armedPlayerFilter = "";
  playerFilterInput.value = "";
  hidePlayerFilterOptions();
  renderPlayerFilter(true);
  renderTables();
  playerFilterInput.focus();
}

function removePlayerFilter(name){
  state.selectedPlayers.delete(String(name || "").trim().toLowerCase());
  state.armedPlayerFilter = "";
  renderPlayerFilter();
  renderTables();
}

function syncProLeagueUrls(view){
  if(!view) return;
  const editorParams = new URLSearchParams(globalThis.location.search);
  editorParams.set("eventKey", "proleague");
  editorParams.set("season", String(view.seasonValue));
  if(view.stageValue === null || view.stageValue === undefined || view.stageValue === "") editorParams.delete("stage");
  else editorParams.set("stage", String(view.stageValue));
  globalThis.history.replaceState(null, "", `${globalThis.location.pathname}?${editorParams}`);

}

function renderPeriodControls(){
  const isProLeague = state.event?.eventKey === "proleague";
  const isSuperLeague = state.event?.eventKey === "superleague";
  const isYearEvent = ["worldopen", "noptational", "worldcup"].includes(state.event?.eventKey);
  const views = periodViews();
  const hasPeriodSelects = (isProLeague || isSuperLeague || isYearEvent) && views.length;
  periodControls.hidden = false;
  playerFilter.hidden = false;
  periodControls.querySelector(".editor-period-selects").hidden = !hasPeriodSelects;
  if(!hasPeriodSelects) return;

  const activeView = activePeriodView() || views[0];
  seasonLabel.textContent = isYearEvent ? "Year" : "Season";
  const seasons = [];
  const seen = new Set();
  views.forEach((view) => {
    const value = String(view.seasonValue);
    if(seen.has(value)) return;
    seen.add(value);
    seasons.push({ value, label: view.seasonLabel || `Season ${value}` });
  });
  seasonSelect.replaceChildren(...seasons.map(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  seasonSelect.value = String(activeView.seasonValue);

  if(isSuperLeague || isYearEvent){
    stageWrap.hidden = true;
    if(isSuperLeague) syncSuperLeagueUrls(state.activeGroupKey);
    if(isYearEvent) syncAdditionalEventUrls(state.activeGroupKey);
    return;
  }

  const stages = views.filter((view) => String(view.seasonValue) === seasonSelect.value);
  const hasStages = stages.some((view) => view.stageValue !== null && view.stageValue !== undefined && view.stageValue !== "");
  stageWrap.hidden = !hasStages;
  stageSelect.replaceChildren(...stages.filter((view) => (
    hasStages && view.stageValue !== null && view.stageValue !== undefined && view.stageValue !== ""
  )).map((view) => {
    const option = document.createElement("option");
    option.value = String(view.stageValue);
    option.textContent = view.stageValue === "championship" ? "Championship" : `Stage ${view.stageValue}`;
    return option;
  }));
  if(hasStages) stageSelect.value = String(activeView.stageValue);
  syncProLeagueUrls(activeView);
}

function renderEditor(){
  accessPanel.hidden = true;
  editorPanel.hidden = false;
  editorPanel.dataset.eventKey = state.event.eventKey;
  pageTitle.textContent = `${state.event.displayName} results`;
  applyEditorTheme(state.activeGroupKey);
  renderPeriodControls();
  renderPlayerFilter();
  renderTables();
}

function initialProLeagueViewKey(){
  const params = new URL(globalThis.location.href).searchParams;
  const season = params.get("season") || SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON;
  const fallbackStage = Number(season) >= 6
    ? (String(season) === String(SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON) ? SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE : 1)
    : null;
  return proLeagueViewKey(season, params.get("stage") || fallbackStage);
}

function initialMastersGroupKey(){
  return new URL(globalThis.location.href).searchParams.get("view") === "qualifiers" ? "qualifiers" : "bracket";
}

function initialSuperLeagueGroupKey(){
  const view = new URL(globalThis.location.href).searchParams.get("view");
  if(view === "qualifiers") return "qualifier-winners";
  return ["season", "playoffs", "qualifier-winners", "qualifier-losers", "promotions"].includes(view)
    ? view
    : "season";
}

function initialSuperLeagueViewKey(){
  const season = new URL(globalThis.location.href).searchParams.get("season") || SUPER_LEAGUE_SEASON;
  return superLeagueViewKey(season) || "season-6";
}

function initialYearViewKey(){
  const year = new URL(globalThis.location.href).searchParams.get("year") || "";
  return /^20\d{2}$/.test(year) ? `${eventKey}-${year}` : "latest";
}

function initialAdditionalGroupKey(){
  return new URL(globalThis.location.href).searchParams.get("view")?.trim() || "";
}

async function loadEditor(requestedViewKey = eventKey === "proleague"
  ? initialProLeagueViewKey()
  : eventKey === "superleague"
    ? initialSuperLeagueViewKey()
    : ["worldopen", "noptational", "worldcup"].includes(eventKey) ? initialYearViewKey() : ""){
  if(!eventKey){
    showAccessPanel({ message: "Missing tournament event key.", tone: "error" });
    return;
  }

  showAccessPanel({ loading:true });

  try{
    const url = new URL(workerUrl);
    url.searchParams.set("eventKey", eventKey);
    if(requestedViewKey) url.searchParams.set("viewKey", requestedViewKey);
    const response = await fetch(url, { headers:{ Accept:"application/json" }, cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if(!response.ok){
      if(response.status === 401){
        showAccessPanel({ message: "Your session has expired. Sign in again.", tone: "error", canSignIn: true });
      }else if(response.status === 403){
        showAccessPanel({ message: "Discord admin access is required.", tone: "error" });
      }else{
        showAccessPanel({ message: errorMessage(payload, "Unable to load tournament results."), tone: "error" });
      }
      return;
    }

    state.event = payload.event;
    state.activeViewKey = payload.event.activeViewKey || requestedViewKey || "";
    state.activeGroupKey = eventKey === "masters"
      ? initialMastersGroupKey()
      : eventKey === "superleague" ? initialSuperLeagueGroupKey() : initialAdditionalGroupKey();
    state.tables = buildEditorTables(payload.event, payload.valueRanges);
    state.currentValues = new Map(allEditableCells().map((cell) => [cell.range, cell.initialValue]));
    state.selectedPlayers.clear();
    state.armedPlayerFilter = "";
    state.addedPlayerRows.clear();
    setEditorStatus("");
    renderEditor();
  }catch(error){
    console.error("Unable to load tournament editor.", error);
    showAccessPanel({ message: "Unable to reach the tournament editor service.", tone: "error" });
  }
}

async function changePeriodView(view){
  if(!view || view.key === state.activeViewKey) return;
  if(hasUnsavedWork() && !globalThis.confirm("Discard unsaved changes and change the tournament period?")){
    renderPeriodControls();
    return;
  }
  await loadEditor(view.key);
}

tablesMount.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-score-range], input[data-player-name-range]");
  if(!input) return;
  state.currentValues.set(input.dataset.scoreRange || input.dataset.playerNameRange, input.value);
  setEditorStatus("");
  if(input.dataset.worldOpenPlayer) refreshWorldOpenPlayerInputs();
  updateActions();
});

playerFilterInput.addEventListener("input", () => {
  updatePlayerFilterPlaceholder();
  if(state.armedPlayerFilter){
    state.armedPlayerFilter = "";
    renderPlayerFilter();
  }else{
    renderPlayerFilterOptions();
  }
});
playerFilterInput.addEventListener("focus", updatePlayerFilterPlaceholder);
playerFilterInput.addEventListener("blur", updatePlayerFilterPlaceholder);
playerFilterInput.addEventListener("keydown", (event) => {
  if(event.key === "Escape"){
    hidePlayerFilterOptions();
    return;
  }
  if(event.key === "Backspace" && !playerFilterInput.value){
    const nextState = playerFilterBackspaceState(state.selectedPlayers.keys(), state.armedPlayerFilter);
    if(!nextState.armedName && !nextState.removeName) return;
    event.preventDefault();
    if(nextState.removeName){
      removePlayerFilter(nextState.removeName);
    }else{
      state.armedPlayerFilter = nextState.armedName.toLowerCase();
      renderPlayerFilter(true);
    }
    return;
  }
  if(state.armedPlayerFilter){
    state.armedPlayerFilter = "";
    renderPlayerFilter();
  }
  if(event.key !== "Enter") return;
  const firstMatch = playerFilterOptions.querySelector("[data-player-name]");
  if(!firstMatch) return;
  event.preventDefault();
  addPlayerFilter(firstMatch.dataset.playerName);
});

playerFilterOptions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-player-name]");
  if(option) addPlayerFilter(option.dataset.playerName);
});

playerFilterChips.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-player]");
  if(remove){
    removePlayerFilter(remove.dataset.removePlayer);
    return;
  }
  const chip = event.target.closest("[data-player-filter-token]");
  if(!chip) return;
  state.armedPlayerFilter = chip.dataset.playerFilterToken.toLowerCase();
  renderPlayerFilter(true);
  playerFilterInput.focus();
});

playerFilterInput.addEventListener("pointerdown", () => {
  if(!state.armedPlayerFilter) return;
  state.armedPlayerFilter = "";
  renderPlayerFilter();
});

playerFilterClear.addEventListener("click", () => {
  state.selectedPlayers.clear();
  state.armedPlayerFilter = "";
  playerFilterInput.value = "";
  renderPlayerFilter();
  renderTables();
});

document.addEventListener("click", (event) => {
  if(playerFilterField.contains(event.target)) return;
  hidePlayerFilterOptions();
  if(state.armedPlayerFilter){
    state.armedPlayerFilter = "";
    renderPlayerFilter();
  }
});

resetButton.addEventListener("click", () => {
  allEditableCells().forEach((cell) => state.currentValues.set(cell.range, cell.initialValue));
  state.addedPlayerRows.clear();
  renderEditor();
  setEditorStatus("Unsaved changes reset.", "success");
});

function prepareAddedPlayerRowsForSave(){
  const blankRowKeys = [];
  for(const rowKey of [...state.addedPlayerRows]){
    const row = state.tables.flatMap((table) => table.rows).find((candidate) => candidate.key === rowKey);
    if(!row) continue;
    const name = editorPlayerName(row, state.currentValues);
    const saveState = addedPlayerRowSaveState(row, state.currentValues);
    if(saveState === "missing-name"){
      setEditorStatus("Enter a player name or remove that row's scores before saving.", "error");
      tablesMount.querySelector(`tr[data-source-row="${row.sourceRow}"] input[data-player-name-range]`)?.focus();
      return { valid: false, removedBlankRow: false };
    }
    if(saveState === "empty"){
      blankRowKeys.push(rowKey);
      continue;
    }
    const duplicate = state.tables
      .flatMap((table) => table.nameIsTeam ? [] : table.rows)
      .some((candidate) => candidate !== row && editorPlayerName(candidate, state.currentValues).toLowerCase() === name.toLowerCase());
    if(duplicate){
      setEditorStatus("That player is already listed in this period.", "error");
      tablesMount.querySelector(`tr[data-source-row="${row.sourceRow}"] input[data-player-name-range]`)?.focus();
      return { valid: false, removedBlankRow: false };
    }
  }
  blankRowKeys.forEach((rowKey) => state.addedPlayerRows.delete(rowKey));
  const removedBlankRow = blankRowKeys.length > 0;
  if(removedBlankRow) renderEditor();
  return { valid: true, removedBlankRow };
}

function validateWorldOpenPlayerNames(){
  if(state.event?.eventKey !== "worldopen") return true;
  for(const table of state.tables){
    const allowed = new Map(table.playerOptions.map((name) => [name.toLowerCase(), name]));
    const used = new Set();
    for(const row of table.rows){
      if(!row.nameCell) continue;
      const value = playerNameForRow(row);
      if(!value) continue;
      const key = value.toLowerCase();
      const canonical = allowed.get(key);
      if(!canonical){
        setEditorStatus("Select a player from this round's Field list.", "error");
        [...tablesMount.querySelectorAll("input[data-player-name-range]")]
          .find((input) => input.dataset.playerNameRange === row.nameCell.range)?.focus();
        return false;
      }
      if(used.has(key)){
        setEditorStatus(`${canonical} is already assigned in this round.`, "error");
        [...tablesMount.querySelectorAll("input[data-player-name-range]")]
          .find((input) => input.dataset.playerNameRange === row.nameCell.range)?.focus();
        return false;
      }
      used.add(key);
      state.currentValues.set(row.nameCell.range, canonical);
    }
  }
  return true;
}

saveButton.addEventListener("click", async () => {
  if(state.saving || !state.event?.canEdit) return;
  if(!validateWorldOpenPlayerNames()) return;
  const prepared = prepareAddedPlayerRowsForSave();
  if(!prepared.valid) return;
  const updates = buildUpdates(state.tables, state.currentValues);
  if(!updates.length){
    if(prepared.removedBlankRow) setEditorStatus("Empty player row removed.", "success");
    return;
  }
  const changedCellCount = dirtyCells().length;

  state.saving = true;
  updateActions();
  setEditorStatus("Saving…");
  try{
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { ...(await requestHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ eventKey: state.event.eventKey, updates }),
    });
    const payload = await response.json().catch(() => null);
    if(!response.ok) throw new Error(errorMessage(payload, "Unable to save tournament results."));

    allEditableCells().forEach((cell) => {
      cell.initialValue = state.currentValues.get(cell.range);
    });
    state.addedPlayerRows.clear();
    renderEditor();
    const savedCellCount = Number(payload.totalUpdatedCells) || changedCellCount;
    setEditorStatus(`${savedCellCount} ${savedCellCount === 1 ? "change" : "changes"} saved.`, "success");
  }catch(error){
    setEditorStatus(error?.message || "Unable to save tournament results.", "error");
  }finally{
    state.saving = false;
    updateActions();
  }
});

tablesMount.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-add-player-table]");
  if(!button || button.disabled) return;
  const table = state.tables.find((candidate) => candidate.key === button.dataset.addPlayerTable);
  const row = nextBlankPlayerRow(table, state.currentValues, state.addedPlayerRows);
  if(!row){
    setEditorStatus("No blank individual-player rows remain in this period.", "error");
    return;
  }
  state.addedPlayerRows.add(row.key);
  renderEditor();
  tablesMount.querySelector(`tr[data-source-row="${row.sourceRow}"] input[data-player-name-range]`)?.focus();
  setEditorStatus(`New player row added at sheet row ${row.sourceRow}.`, "success");
});

seasonSelect.addEventListener("change", () => {
  const views = periodViews().filter((view) => String(view.seasonValue) === seasonSelect.value);
  if(["superleague", "worldopen", "noptational", "worldcup"].includes(state.event?.eventKey)){
    void changePeriodView(views[0]);
    return;
  }
  const preferredStage = seasonSelect.value === String(SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON)
    ? String(SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE)
    : "1";
  const view = views.find((candidate) => String(candidate.stageValue) === preferredStage) || views[0];
  void changePeriodView(view);
});

stageSelect.addEventListener("change", () => {
  const view = periodViews().find((candidate) => (
    String(candidate.seasonValue) === seasonSelect.value
    && String(candidate.stageValue) === stageSelect.value
  ));
  void changePeriodView(view);
});

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: buildAuthRedirectTo(globalThis.location.href) },
  });
  if(error){
    loginButton.disabled = false;
    setAccessStatus(error.message || "Unable to start Discord sign-in.", "error");
  }
});

globalThis.addEventListener("beforeunload", (event) => {
  if(!hasUnsavedWork()) return;
  event.preventDefault();
  event.returnValue = "";
});

void loadEditor();
