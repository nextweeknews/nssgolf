import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js?v=20260817-singleton";

const WORKER_URL = "https://small-mud-2771.nextweekmedia.workers.dev/admin/tournament-action-logs";
const supabase = createBrowserSupabaseClient();

const accessPanel = document.getElementById("logsAccessPanel");
const accessStatus = document.getElementById("logsAccessStatus");
const loginButton = document.getElementById("logsLoginBtn");
const logsPanel = document.getElementById("logsPanel");
const logsStatus = document.getElementById("logsStatus");
const logsList = document.getElementById("actionLogList");

let busy = false;

function setStatus(element, message, tone = ""){
  element.textContent = message || "";
  element.className = `editor-status ${tone}`.trim();
}

function showAccess(message, tone = "", canSignIn = false){
  logsPanel.hidden = true;
  accessPanel.hidden = false;
  loginButton.hidden = !canSignIn;
  setStatus(accessStatus, message, tone);
}

async function requestHeaders(){
  const { data, error } = await supabase.auth.getSession();
  if(error || !data?.session?.access_token) throw new Error("Your session has expired. Sign in again.");
  return {
    Accept: "application/json",
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

function displayTime(value){
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function statusDetails(log){
  if(log.undone_by_action_id) return { label: "Undone", className: "undone" };
  if(log.status === "succeeded") return { label: log.action_type === "undo" ? "Undo saved" : "Saved", className: "succeeded" };
  if(log.status === "failed") return { label: "Failed", className: "failed" };
  return { label: "Pending", className: "pending" };
}

function actionChange(change){
  const row = document.createElement("div");
  row.className = "action-change";
  const range = document.createElement("code");
  range.textContent = change?.range || "Unknown range";
  const before = document.createElement("span");
  before.className = "action-change-value";
  before.textContent = JSON.stringify(change?.before ?? []);
  const arrow = document.createElement("span");
  arrow.className = "action-change-arrow";
  arrow.textContent = "→";
  const after = document.createElement("span");
  after.className = "action-change-value";
  after.textContent = JSON.stringify(change?.after ?? []);
  row.append(range, before, arrow, after);
  return row;
}

function actionCard(log){
  const card = document.createElement("article");
  card.className = "action-log-card";

  const head = document.createElement("div");
  head.className = "action-log-head";
  const summary = document.createElement("div");
  summary.className = "action-log-summary";
  const title = document.createElement("h2");
  title.className = "action-log-title";
  title.textContent = `${log.actor_username || "Unknown admin"} ${log.action_type === "undo" ? "undid" : "edited"} ${log.event_display_name || log.event_key}`;
  const meta = document.createElement("p");
  meta.className = "action-log-meta";
  const pageLink = document.createElement("a");
  pageLink.href = log.route_path || "/";
  pageLink.textContent = log.route_path || "/";
  meta.append(`${displayTime(log.created_at)} · Discord ${log.actor_discord_user_id || "unknown"} · `, pageLink);
  summary.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "action-log-actions";
  const status = statusDetails(log);
  const badge = document.createElement("span");
  badge.className = `action-log-status ${status.className}`;
  badge.textContent = status.label;
  actions.appendChild(badge);
  if(log.can_undo){
    const undo = document.createElement("button");
    undo.className = "editor-button";
    undo.type = "button";
    undo.textContent = "Undo";
    undo.dataset.undoActionId = log.action_id;
    undo.disabled = busy;
    actions.appendChild(undo);
  }
  head.append(summary, actions);
  card.appendChild(head);

  const changes = Array.isArray(log.changes) ? log.changes : [];
  const details = document.createElement("details");
  details.className = "action-log-changes";
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = `${changes.length} changed ${changes.length === 1 ? "range" : "ranges"}`;
  const changeList = document.createElement("div");
  changeList.className = "action-change-list";
  changeList.replaceChildren(...changes.map(actionChange));
  details.append(detailsSummary, changeList);
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
  showAccess("Checking admin access…");
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
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
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
