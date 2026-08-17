import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js?v=20260817-singleton";
import {
  addPlayerToFirstBlankRow,
  buildEditorTables,
  buildUpdates,
  isEditorRowVisible,
  proLeagueViewKey,
} from "/admin/tournament-results-core.mjs?v=20260817-proleague-editor";
import { SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON, SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE } from "/config.js";
import { getProLeagueTeamStyle, proLeagueTeamLogoSrc } from "/proleague/team-presentation.mjs?v=20260817-editor";

const DEFAULT_WORKER_URL = "https://small-mud-2771.nextweekmedia.workers.dev/admin/tournament-results";
const runtimeConfig = globalThis.NSSGOLF_TOURNAMENT_EDITOR_CONFIG || {};
const workerUrl = String(runtimeConfig.workerUrl || DEFAULT_WORKER_URL).trim();
const eventKey = new URL(globalThis.location.href).searchParams.get("eventKey")?.trim() || "";
const supabase = createBrowserSupabaseClient();

const accessPanel = document.getElementById("editorAccessPanel");
const editorPanel = document.getElementById("editorPanel");
const loginButton = document.getElementById("editorLoginBtn");
const accessStatus = document.getElementById("editorAccessStatus");
const pageTitle = document.getElementById("editorTitle");
const pageCopy = document.getElementById("editorCopy");
const backLink = document.getElementById("editorBackLink");
const archiveButton = document.getElementById("editorArchiveBtn");
const saveButton = document.getElementById("editorSaveBtn");
const resetButton = document.getElementById("editorResetBtn");
const dirtyCount = document.getElementById("editorDirtyCount");
const editorStatus = document.getElementById("editorStatus");
const viewTabs = document.getElementById("editorViewTabs");
const tablesMount = document.getElementById("editorTables");
const periodControls = document.getElementById("editorPeriodControls");
const seasonSelect = document.getElementById("editorSeasonSelect");
const stageWrap = document.getElementById("editorStageWrap");
const stageSelect = document.getElementById("editorStageSelect");

const state = {
  session: null,
  event: null,
  tables: [],
  currentValues: new Map(),
  activeGroupKey: "",
  activeViewKey: "",
  saving: false,
};

function setAccessStatus(message, tone = ""){
  accessStatus.textContent = message || "";
  accessStatus.className = `editor-status ${tone}`.trim();
}

function setEditorStatus(message, tone = ""){
  editorStatus.textContent = message || "";
  editorStatus.className = `editor-status ${tone}`.trim();
}

function errorMessage(data, fallback){
  return typeof data?.error === "string" && data.error.trim() ? data.error : fallback;
}

function showAccessPanel({ message, tone = "", canSignIn = false }){
  editorPanel.hidden = true;
  accessPanel.hidden = false;
  loginButton.hidden = !canSignIn;
  setAccessStatus(message, tone);
}

async function requestHeaders(){
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session || null;
  if(error || !session?.access_token) throw new Error("Your session has expired. Sign in again.");
  state.session = session;
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

function updateActions(){
  const count = dirtyCells().length;
  const locked = !state.event?.canEdit || state.saving;
  dirtyCount.textContent = count ? `${count} unsaved ${count === 1 ? "cell" : "cells"}` : "No unsaved changes";
  dirtyCount.classList.toggle("has-changes", count > 0);
  saveButton.disabled = locked || count === 0;
  resetButton.disabled = state.saving || count === 0;
  archiveButton.disabled = state.saving || count > 0;
  archiveButton.title = count > 0 ? "Save or reset changes before changing archive status." : "";

  tablesMount.querySelectorAll("input[data-score-range]").forEach((input) => {
    const range = input.dataset.scoreRange;
    input.disabled = locked;
    input.closest("td")?.classList.toggle("is-dirty", state.currentValues.get(range) !== input.dataset.initialValue);
  });
  tablesMount.querySelectorAll("button[data-add-player-table]").forEach((button) => {
    const table = state.tables.find((candidate) => candidate.key === button.dataset.addPlayerTable);
    button.disabled = locked || !table?.rows.some((row) => row.isAddPlayerSlot && !isEditorRowVisible(row, state.currentValues));
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
  return String(row.nameCell ? (state.currentValues.get(row.nameCell.range) ?? row.nameCell.initialValue) : row.playerName).trim();
}

function appendPlayerCell(rowEl, row){
  const cell = document.createElement("td");
  cell.className = "editor-player-cell";
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
  const name = document.createElement("span");
  name.textContent = playerName || "—";
  cell.appendChild(name);
  rowEl.appendChild(cell);
}

function appendScoreCell(rowEl, scoreCell, playerLabel, weekSeparator = false){
  const cell = document.createElement("td");
  cell.className = "editor-score-cell";
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
  input.value = scoreCell.initialValue;
  input.dataset.initialValue = scoreCell.initialValue;
  input.dataset.scoreRange = scoreCell.range;
  input.setAttribute("aria-label", `${playerLabel}, ${scoreCell.label}, sheet row ${scoreCell.row}`);
  input.disabled = !state.event.canEdit;
  cell.appendChild(input);
  rowEl.appendChild(cell);
}

function createTable(table){
  const section = document.createElement("section");
  section.className = "editor-table-section";
  section.setAttribute("aria-labelledby", `editor-table-${table.key}`);

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

  const headerRow = document.createElement("tr");
  const leadingHeaders = [
    ...(!table.hideContext ? ["Match / source"] : []),
    ...(!table.hideSeed ? ["Seed"] : []),
    "Player",
  ];
  leadingHeaders.forEach((label) => {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = label;
    headerRow.appendChild(header);
  });
  for(let round = 1; round <= table.maxRoundCount; round += 1){
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = table.rows[0]?.roundScores[round - 1]?.label || `R${round}`;
    if(table.roundLabelStyle === "week-round" && round % 2 === 0 && round < table.maxRoundCount){
      header.classList.add("editor-week-separator");
    }
    headerRow.appendChild(header);
  }
  if(table.hasSuddenDeath){
    const header = document.createElement("th");
    header.scope = "col";
    header.className = "editor-sudden-death";
    header.textContent = "SD";
    headerRow.appendChild(header);
  }
  if(table.hasResult){
    const resultHeader = document.createElement("th");
    resultHeader.scope = "col";
    resultHeader.textContent = "Result";
    headerRow.appendChild(resultHeader);
  }

  const thead = document.createElement("thead");
  thead.appendChild(headerRow);
  const tbody = document.createElement("tbody");

  table.rows.filter((row) => isEditorRowVisible(row, state.currentValues)).forEach((row) => {
    const rowEl = document.createElement("tr");
    rowEl.dataset.sourceRow = String(row.sourceRow);
    if(!playerNameForRow(row) && !row.editableCells.some((cell) => cell.initialValue)) rowEl.classList.add("is-empty-player");
    if(!table.hideContext) appendTextCell(rowEl, contextLabel(row), "editor-context-cell");
    if(!table.hideSeed) appendTextCell(rowEl, row.seed, "editor-seed-cell");
    appendPlayerCell(rowEl, row);
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
  section.append(heading, scroll);
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

function editorGroups(){
  const groups = [];
  const seen = new Set();
  state.tables.forEach((table) => {
    if(!table.groupKey || seen.has(table.groupKey)) return;
    seen.add(table.groupKey);
    groups.push({ key: table.groupKey, label: table.groupLabel || table.groupKey });
  });
  return groups;
}

function showEditorGroup(groupKey){
  state.activeGroupKey = groupKey;
  viewTabs.querySelectorAll("[role='tab']").forEach((tab) => {
    const selected = tab.dataset.groupKey === groupKey;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  tablesMount.querySelectorAll(".editor-table-section").forEach((section) => {
    section.hidden = Boolean(groupKey) && section.dataset.groupKey !== groupKey;
  });
}

function renderEditorTabs(){
  if(state.event?.eventKey === "proleague"){
    viewTabs.hidden = true;
    viewTabs.replaceChildren();
    return;
  }
  const groups = editorGroups();
  viewTabs.hidden = groups.length < 2;
  viewTabs.replaceChildren(...groups.map((group) => {
    const button = document.createElement("button");
    button.className = "editor-view-tab";
    button.type = "button";
    button.role = "tab";
    button.dataset.groupKey = group.key;
    button.textContent = group.label;
    button.addEventListener("click", () => showEditorGroup(group.key));
    return button;
  }));

  const activeGroup = groups.some((group) => group.key === state.activeGroupKey)
    ? state.activeGroupKey
    : (groups[0]?.key || "");
  showEditorGroup(activeGroup);
}

function proLeagueViews(){
  return Array.isArray(state.event?.views) ? state.event.views : [];
}

function activeProLeagueView(){
  return proLeagueViews().find((view) => view.key === state.activeViewKey) || null;
}

function syncProLeagueUrls(view){
  if(!view) return;
  const editorParams = new URLSearchParams(globalThis.location.search);
  editorParams.set("eventKey", "proleague");
  editorParams.set("season", String(view.seasonValue));
  if(view.stageValue === null || view.stageValue === undefined || view.stageValue === "") editorParams.delete("stage");
  else editorParams.set("stage", String(view.stageValue));
  globalThis.history.replaceState(null, "", `${globalThis.location.pathname}?${editorParams}`);

  const publicParams = new URLSearchParams({ season: String(view.seasonValue) });
  if(view.stageValue !== null && view.stageValue !== undefined && view.stageValue !== ""){
    publicParams.set("stage", String(view.stageValue));
  }
  backLink.href = `/proleague/index.html?${publicParams}`;
}

function renderPeriodControls(){
  const views = proLeagueViews();
  periodControls.hidden = state.event?.eventKey !== "proleague" || !views.length;
  if(periodControls.hidden) return;

  const activeView = activeProLeagueView() || views[0];
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
  pageTitle.textContent = `${state.event.displayName} results`;
  pageCopy.textContent = state.event.archived
    ? "This tournament is archived. Unarchive it to edit scores."
    : state.event.eventKey === "proleague"
      ? "Edit scores below. Add player uses an existing blank individual-player row in Google Sheets."
      : "Edit score cells below. Player names, seeds, context, and formula cells remain read-only.";
  backLink.href = state.event.routePath || "/";
  archiveButton.textContent = state.event.archived ? "Unarchive tournament" : "Archive tournament";
  archiveButton.classList.toggle("is-danger", !state.event.archived);
  const sections = state.tables.map(createTable);
  sections.forEach((section, index) => {
    section.dataset.groupKey = state.tables[index].groupKey;
  });
  tablesMount.replaceChildren(...sections);
  renderPeriodControls();
  renderEditorTabs();
  updateActions();
}

function initialProLeagueViewKey(){
  const params = new URL(globalThis.location.href).searchParams;
  const season = params.get("season") || SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON;
  const fallbackStage = Number(season) >= 6
    ? (String(season) === String(SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON) ? SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE : 1)
    : null;
  return proLeagueViewKey(season, params.get("stage") || fallbackStage);
}

async function loadEditor(requestedViewKey = eventKey === "proleague" ? initialProLeagueViewKey() : ""){
  if(!eventKey){
    showAccessPanel({ message: "Missing tournament event key.", tone: "error" });
    return;
  }

  showAccessPanel({ message: "Checking admin access…" });
  const { data, error } = await supabase.auth.getSession();
  state.session = data?.session || null;
  if(error || !state.session?.access_token){
    showAccessPanel({ message: "Sign in with Discord to access tournament editing.", canSignIn: true });
    return;
  }

  try{
    const url = new URL(workerUrl);
    url.searchParams.set("eventKey", eventKey);
    if(requestedViewKey) url.searchParams.set("viewKey", requestedViewKey);
    const response = await fetch(url, { headers: await requestHeaders(), cache: "no-store" });
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
    state.tables = buildEditorTables(payload.event, payload.valueRanges);
    state.currentValues = new Map(allEditableCells().map((cell) => [cell.range, cell.initialValue]));
    setEditorStatus("");
    renderEditor();
  }catch{
    showAccessPanel({ message: "Unable to reach the tournament editor service.", tone: "error" });
  }
}

async function changeProLeagueView(view){
  if(!view || view.key === state.activeViewKey) return;
  if(dirtyCells().length && !globalThis.confirm("Discard unsaved changes and change the Pro League period?")){
    renderPeriodControls();
    return;
  }
  await loadEditor(view.key);
}

tablesMount.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-score-range]");
  if(!input) return;
  state.currentValues.set(input.dataset.scoreRange, input.value);
  setEditorStatus("");
  updateActions();
});

resetButton.addEventListener("click", () => {
  allEditableCells().forEach((cell) => state.currentValues.set(cell.range, cell.initialValue));
  renderEditor();
  setEditorStatus("Unsaved changes reset.");
});

saveButton.addEventListener("click", async () => {
  if(state.saving || !state.event?.canEdit) return;
  const updates = buildUpdates(state.tables, state.currentValues);
  if(!updates.length) return;
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
    tablesMount.querySelectorAll("input[data-score-range]").forEach((input) => {
      input.dataset.initialValue = input.value;
    });
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
  const playerName = globalThis.prompt("Player name");
  if(playerName === null) return;
  try{
    const row = addPlayerToFirstBlankRow(table, playerName, state.currentValues);
    if(!row){
      setEditorStatus("No blank individual-player rows remain in this period.", "error");
      return;
    }
    renderEditor();
    tablesMount.querySelector(`tr[data-source-row="${row.sourceRow}"] input[data-score-range]`)?.focus();
    setEditorStatus(`${playerName.trim()} added to sheet row ${row.sourceRow}. Save changes to write the name and scores.`);
  }catch(error){
    setEditorStatus(error?.message || "Unable to add player.", "error");
  }
});

seasonSelect.addEventListener("change", () => {
  const views = proLeagueViews().filter((view) => String(view.seasonValue) === seasonSelect.value);
  const preferredStage = seasonSelect.value === String(SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON)
    ? String(SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE)
    : "1";
  const view = views.find((candidate) => String(candidate.stageValue) === preferredStage) || views[0];
  void changeProLeagueView(view);
});

stageSelect.addEventListener("change", () => {
  const view = proLeagueViews().find((candidate) => (
    String(candidate.seasonValue) === seasonSelect.value
    && String(candidate.stageValue) === stageSelect.value
  ));
  void changeProLeagueView(view);
});

archiveButton.addEventListener("click", async () => {
  if(state.saving || dirtyCells().length) return;
  const nextArchived = !state.event.archived;
  const action = nextArchived ? "archive" : "unarchive";
  if(!globalThis.confirm(`${action[0].toUpperCase()}${action.slice(1)} ${state.event.displayName}?`)) return;

  state.saving = true;
  updateActions();
  setEditorStatus(`${action[0].toUpperCase()}${action.slice(1)}ing…`);
  const { data, error } = await supabase.rpc("set_tournament_result_archived", {
    p_event_key: state.event.eventKey,
    p_archived: nextArchived,
  });
  state.saving = false;
  if(error || !data?.[0]){
    setEditorStatus(error?.message || `Unable to ${action} tournament.`, "error");
    updateActions();
    return;
  }

  state.event.archived = Boolean(data[0].archived);
  state.event.canEdit = Boolean(data[0].can_edit);
  state.event.archivedAt = data[0].archived_at || null;
  renderEditor();
  setEditorStatus(`Tournament ${state.event.archived ? "archived" : "unarchived"}.`, "success");
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
  if(!dirtyCells().length) return;
  event.preventDefault();
  event.returnValue = "";
});

void loadEditor();
