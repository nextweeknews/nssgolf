import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js";
import { buildEditorTables, buildUpdates } from "/admin/tournament-results-core.mjs?v=20260816-step10";

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
const tablesMount = document.getElementById("editorTables");

const state = {
  session: null,
  event: null,
  tables: [],
  currentValues: new Map(),
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

function allScoreCells(){
  return state.tables.flatMap((table) => table.rows.flatMap((row) => row.editableCells));
}

function dirtyCells(){
  return allScoreCells().filter((cell) => state.currentValues.get(cell.range) !== cell.initialValue);
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

function appendScoreCell(rowEl, scoreCell, playerLabel){
  const cell = document.createElement("td");
  cell.className = "editor-score-cell";
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
  ["Match / source", "Seed", "Player"].forEach((label) => {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = label;
    headerRow.appendChild(header);
  });
  for(let round = 1; round <= table.maxRoundCount; round += 1){
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = `R${round}`;
    headerRow.appendChild(header);
  }
  if(table.hasSuddenDeath){
    const header = document.createElement("th");
    header.scope = "col";
    header.className = "editor-sudden-death";
    header.textContent = "SD";
    headerRow.appendChild(header);
  }
  const resultHeader = document.createElement("th");
  resultHeader.scope = "col";
  resultHeader.textContent = "Result";
  headerRow.appendChild(resultHeader);

  const thead = document.createElement("thead");
  thead.appendChild(headerRow);
  const tbody = document.createElement("tbody");

  table.rows.forEach((row) => {
    const rowEl = document.createElement("tr");
    rowEl.dataset.sourceRow = String(row.sourceRow);
    if(!row.playerName && !row.editableCells.some((cell) => cell.initialValue)) rowEl.classList.add("is-empty-player");
    appendTextCell(rowEl, contextLabel(row), "editor-context-cell");
    appendTextCell(rowEl, row.seed, "editor-seed-cell");
    appendTextCell(rowEl, row.playerName, "editor-player-cell");
    const playerLabel = row.playerName || `Player slot ${row.playerSlot}`;
    for(let round = 0; round < table.maxRoundCount; round += 1){
      appendScoreCell(rowEl, row.roundScores[round], playerLabel);
    }
    if(table.hasSuddenDeath) appendScoreCell(rowEl, row.suddenDeath, playerLabel);
    appendScoreCell(rowEl, row.result, playerLabel);
    tbody.appendChild(rowEl);
  });

  tableEl.append(thead, tbody);
  scroll.appendChild(tableEl);
  section.append(heading, scroll);
  return section;
}

function renderEditor(){
  accessPanel.hidden = true;
  editorPanel.hidden = false;
  pageTitle.textContent = `${state.event.displayName} results`;
  pageCopy.textContent = state.event.archived
    ? "This tournament is archived. Unarchive it to edit scores."
    : "Edit score cells below. Player names, seeds, context, and formula cells remain read-only.";
  backLink.href = state.event.routePath || "/";
  archiveButton.textContent = state.event.archived ? "Unarchive tournament" : "Archive tournament";
  archiveButton.classList.toggle("is-danger", !state.event.archived);
  tablesMount.replaceChildren(...state.tables.map(createTable));
  updateActions();
}

async function loadEditor(){
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
    state.tables = buildEditorTables(payload.event, payload.valueRanges);
    state.currentValues = new Map(allScoreCells().map((cell) => [cell.range, cell.initialValue]));
    setEditorStatus("");
    renderEditor();
  }catch{
    showAccessPanel({ message: "Unable to reach the tournament editor service.", tone: "error" });
  }
}

tablesMount.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-score-range]");
  if(!input) return;
  state.currentValues.set(input.dataset.scoreRange, input.value);
  setEditorStatus("");
  updateActions();
});

resetButton.addEventListener("click", () => {
  allScoreCells().forEach((cell) => state.currentValues.set(cell.range, cell.initialValue));
  tablesMount.querySelectorAll("input[data-score-range]").forEach((input) => {
    input.value = input.dataset.initialValue;
  });
  setEditorStatus("Unsaved changes reset.");
  updateActions();
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

    allScoreCells().forEach((cell) => {
      cell.initialValue = state.currentValues.get(cell.range);
    });
    tablesMount.querySelectorAll("input[data-score-range]").forEach((input) => {
      input.dataset.initialValue = input.value;
    });
    const savedCellCount = Number(payload.totalUpdatedCells) || changedCellCount;
    setEditorStatus(`${savedCellCount} score ${savedCellCount === 1 ? "cell" : "cells"} saved.`, "success");
  }catch(error){
    setEditorStatus(error?.message || "Unable to save tournament results.", "error");
  }finally{
    state.saving = false;
    updateActions();
  }
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
