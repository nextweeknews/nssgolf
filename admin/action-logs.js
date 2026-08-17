import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js?v=20260817-singleton";
import { actionLogCellCount, actionLogChangeRows, actionLogTimestamp, addUndoChangeContext } from "/admin/action-logs-core.mjs?v=20260817-compact-change-values";
import { RESULT_EVENTS } from "/admin/dashboard-core.mjs?v=20260818-admin-mobile";

const WORKER_URL = "https://small-mud-2771.nextweekmedia.workers.dev/admin/tournament-action-logs";
const supabase = createBrowserSupabaseClient();

const accessPanel = document.getElementById("logsAccessPanel");
const accessSpinner = document.getElementById("logsAccessSpinner");
const accessStatus = document.getElementById("logsAccessStatus");
const loginButton = document.getElementById("logsLoginBtn");
const logsPanel = document.getElementById("logsPanel");
const logsStatus = document.getElementById("logsStatus");
const logsList = document.getElementById("actionLogList");

let busy = false;
let actorProfiles = new Map();
const eventColors = new Map(RESULT_EVENTS.map((event) => [event.key, event.color]));

function setStatus(element, message, tone = ""){
  element.textContent = message || "";
  element.className = `editor-status ${tone}`.trim();
}

function actionButtonContent(iconPaths, label){
  return `<svg class="editor-button-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths}</svg><span class="editor-button-label">${label}</span>`;
}

function showAccess(message = "", tone = "", canSignIn = false, loading = false){
  logsPanel.hidden = true;
  accessPanel.hidden = false;
  accessPanel.classList.toggle("is-loading", loading);
  accessSpinner.hidden = !loading;
  accessStatus.hidden = loading;
  loginButton.hidden = loading || !canSignIn;
  if(!loading) setStatus(accessStatus, message, tone);
}

async function requestHeaders(){
  const { data, error } = await supabase.auth.getSession();
  if(error || !data?.session?.access_token) throw new Error("Your session has expired. Sign in again.");
  return {
    Accept: "application/json",
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

function statusDetails(log){
  if(log.undone_by_action_id) return { label: "Undone", className: "undone" };
  if(log.status === "failed") return { label: "Failed", className: "failed" };
  if(log.status === "pending") return { label: "Pending", className: "pending" };
  return null;
}

function actionChange(change){
  const row = document.createElement("div");
  row.className = "action-change";
  const player = document.createElement("span");
  player.className = "action-change-player";
  player.textContent = change.playerName;
  const header = document.createElement("span");
  header.className = "action-change-header";
  header.textContent = change.header;
  const values = document.createElement("span");
  values.className = "action-change-values";
  const before = document.createElement("span");
  before.className = `action-change-value before${change.beforeBlank ? " is-blank" : ""}`;
  before.textContent = change.before;
  const arrow = document.createElement("span");
  arrow.className = "action-change-arrow";
  arrow.textContent = "→";
  const after = document.createElement("span");
  after.className = `action-change-value after${change.afterBlank ? " is-blank" : ""}`;
  after.textContent = change.after;
  values.append(before, arrow, after);
  row.append(player, header, values);
  return row;
}

async function loadActorProfiles(logs){
  const ids = [...new Set(logs.map((log) => String(log.actor_discord_user_id || "").trim()).filter(Boolean))];
  if(!ids.length) return new Map();
  const { data, error } = await supabase
    .from("discord_guild_members")
    .select("discord_user_id,display_name,avatar_url,server_avatar_url,is_current_member,updated_at")
    .in("discord_user_id", ids)
    .order("is_current_member", { ascending:false })
    .order("updated_at", { ascending:false });
  if(error){
    console.warn("Unable to load action-log admin profiles.", error);
    return new Map();
  }
  const profiles = new Map();
  (data || []).forEach((profile) => {
    const id = String(profile.discord_user_id || "");
    if(id && !profiles.has(id)) profiles.set(id, profile);
  });
  return profiles;
}

function actionCard(log){
  const card = document.createElement("article");
  card.className = "action-log-card";

  const row = document.createElement("div");
  row.className = "action-log-row";
  const timestamp = document.createElement("time");
  timestamp.className = "action-log-time";
  timestamp.dateTime = log.created_at || "";
  timestamp.textContent = actionLogTimestamp(log.created_at);

  const profile = actorProfiles.get(String(log.actor_discord_user_id || ""));
  const actor = document.createElement("div");
  actor.className = "action-log-actor";
  const avatarUrl = profile?.server_avatar_url || profile?.avatar_url || "";
  if(avatarUrl){
    const avatar = document.createElement("img");
    avatar.className = "action-log-avatar";
    avatar.src = avatarUrl;
    avatar.alt = "";
    avatar.loading = "lazy";
    actor.appendChild(avatar);
  }else{
    const fallback = document.createElement("span");
    fallback.className = "action-log-avatar-fallback";
    fallback.textContent = (profile?.display_name || log.actor_username || "?").trim().slice(0, 1).toUpperCase();
    actor.appendChild(fallback);
  }
  const actorName = document.createElement("span");
  actorName.textContent = profile?.display_name || log.actor_username || "Unknown admin";
  actor.appendChild(actorName);

  const eventName = document.createElement("span");
  eventName.className = "action-log-event";
  eventName.style.setProperty("--action-event-color", eventColors.get(log.event_key) || "#e9eef8");
  eventName.textContent = log.event_display_name || log.event_key || "Unknown event";

  const cellCount = document.createElement("span");
  cellCount.className = "action-log-cell-count";
  const count = actionLogCellCount(log);
  cellCount.textContent = `${count} ${count === 1 ? "cell" : "cells"} updated`;

  const actions = document.createElement("div");
  actions.className = "action-log-actions";
  const status = statusDetails(log);

  const changes = Array.isArray(log.changes) ? log.changes : [];
  const changesId = `action-log-changes-${log.action_id}`;
  const viewChanges = document.createElement("button");
  viewChanges.className = "editor-button action-log-toggle";
  viewChanges.type = "button";
  viewChanges.innerHTML = actionButtonContent('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', "View changes");
  viewChanges.title = "View changes";
  viewChanges.setAttribute("aria-label", "View changes");
  viewChanges.dataset.toggleChanges = "";
  viewChanges.setAttribute("aria-expanded", "false");
  viewChanges.setAttribute("aria-controls", changesId);
  actions.appendChild(viewChanges);
  if(status){
    const badge = document.createElement("span");
    badge.className = `action-log-status ${status.className}`;
    badge.textContent = status.label;
    actions.appendChild(badge);
  }else if(log.can_undo){
    const undo = document.createElement("button");
    undo.className = "editor-button action-log-undo";
    undo.type = "button";
    undo.innerHTML = actionButtonContent('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', "Undo");
    undo.title = "Undo";
    undo.setAttribute("aria-label", "Undo");
    undo.dataset.undoActionId = log.action_id;
    undo.disabled = busy;
    actions.appendChild(undo);
  }
  row.append(timestamp, actor, eventName, cellCount, actions);
  card.appendChild(row);

  const details = document.createElement("div");
  details.className = "action-log-changes";
  details.id = changesId;
  details.hidden = true;
  const changeList = document.createElement("div");
  changeList.className = "action-change-list";
  changeList.replaceChildren(...changes.flatMap(actionLogChangeRows).map(actionChange));
  details.appendChild(changeList);
  card.appendChild(details);

  if(log.error_message){
    const error = document.createElement("p");
    error.className = "action-log-error";
    error.textContent = log.error_message;
    card.appendChild(error);
  }
  return card;
}

async function loadLogs(){
  showAccess("", "", false, true);
  try{
    const response = await fetch(`${WORKER_URL}?limit=100`, {
      headers: await requestHeaders(),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if(!response.ok){
      const message = payload?.error || "Unable to load admin action logs.";
      if(response.status === 401) return showAccess(message, "error", true);
      return showAccess(message, "error");
    }

    accessPanel.hidden = true;
    logsPanel.hidden = false;
    const logs = addUndoChangeContext(Array.isArray(payload?.logs) ? payload.logs : []);
    actorProfiles = await loadActorProfiles(logs);
    logsList.replaceChildren(...logs.map(actionCard));
    if(!logs.length){
      const empty = document.createElement("p");
      empty.className = "action-log-empty";
      empty.textContent = "No tournament score edits have been logged yet.";
      logsList.appendChild(empty);
    }
    setStatus(logsStatus, "");
  }catch(error){
    showAccess(error?.message || "Unable to reach the tournament action log service.", "error", true);
  }
}

logsList.addEventListener("click", async (event) => {
  const toggle = event.target.closest("button[data-toggle-changes]");
  if(toggle){
    const details = document.getElementById(toggle.getAttribute("aria-controls"));
    if(!details) return;
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    const label = expanded ? "View changes" : "Hide changes";
    toggle.querySelector(".editor-button-label").textContent = label;
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    details.hidden = expanded;
    return;
  }
  const button = event.target.closest("button[data-undo-action-id]");
  if(!button || busy) return;
  if(!globalThis.confirm("Undo this score edit? The prior values will be written back to Google Sheets.")) return;

  busy = true;
  logsList.querySelectorAll("button[data-undo-action-id]").forEach((item) => { item.disabled = true; });
  setStatus(logsStatus, "Undoing score edit…");
  try{
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { ...(await requestHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: button.dataset.undoActionId }),
    });
    const payload = await response.json().catch(() => null);
    if(!response.ok) throw new Error(payload?.error || "Unable to undo this score edit.");
    await loadLogs();
    setStatus(logsStatus, "Score edit undone and logged.", "success");
  }catch(error){
    setStatus(logsStatus, error?.message || "Unable to undo this score edit.", "error");
  }finally{
    busy = false;
    logsList.querySelectorAll("button[data-undo-action-id]").forEach((item) => { item.disabled = false; });
  }
});

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: buildAuthRedirectTo(globalThis.location.href) },
  });
  if(error){
    loginButton.disabled = false;
    setStatus(accessStatus, error.message || "Unable to start Discord sign-in.", "error");
  }
});

void loadLogs();
