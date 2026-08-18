import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js?v=20260817-singleton";
import { getTournamentAdminFlag } from "/admin/tournament-results-core.mjs?v=20260818-mobile-sticky-headers";
import { normalizeSeasonConfiguration, seasonConfigurationRpcParams } from "/season-configuration-core.mjs?v=20260818-season-configuration";

const supabase = createBrowserSupabaseClient();
const accessPanel = document.getElementById("configurationAccessPanel");
const accessSpinner = document.getElementById("configurationAccessSpinner");
const accessStatus = document.getElementById("configurationAccessStatus");
const loginButton = document.getElementById("configurationLoginBtn");
const editorPanel = document.getElementById("editorPanel");
const form = document.getElementById("seasonConfigurationForm");
const saveButton = document.getElementById("configurationSaveBtn");
const resetButton = document.getElementById("configurationResetBtn");
const status = document.getElementById("configurationStatus");
const embedded = new URL(globalThis.location.href).searchParams.get("embed") === "1";
const inputs = Object.fromEntries([...form.elements]
  .filter((element) => element instanceof HTMLInputElement)
  .map((element) => [element.name, element]));

let initialConfiguration = null;
let saving = false;
let messageTimer = 0;

function values(){
  return Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
}

function parsedValues(){
  const raw = values();
  const parsed = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number(value)]));
  if(Object.entries(parsed).some(([key, value]) => !Number.isInteger(value)
    || value < (key === "rankedLeagueSeason" ? 7 : 1)
    || value > (key === "shotgunProLeagueStage" ? 3 : 99))){
    throw new Error("Ranked League must be Season 7 or later. Other seasons must be 1–99, and the Pro League stage must be 1–3.");
  }
  return normalizeSeasonConfiguration(parsed);
}

function dirtyCount(){
  if(!initialConfiguration) return 0;
  const current = values();
  return Object.keys(inputs).filter((key) => current[key] !== String(initialConfiguration[key])).length;
}

function setMessage(message, tone = ""){
  globalThis.clearTimeout(messageTimer);
  status.textContent = message;
  status.className = `editor-dirty-count ${tone}`.trim();
  if(tone === "success"){
    messageTimer = globalThis.setTimeout(updateActions, 2500);
  }
}

function updateActions(){
  const count = dirtyCount();
  saveButton.disabled = saving || count === 0;
  resetButton.disabled = saving || count === 0;
  Object.values(inputs).forEach((input) => { input.disabled = saving; });
  status.textContent = count ? `${count} unsaved ${count === 1 ? "change" : "changes"}` : "No unsaved changes";
  status.className = `editor-dirty-count${count ? " has-changes" : ""}`;
}

function render(configuration){
  initialConfiguration = normalizeSeasonConfiguration(configuration);
  Object.entries(inputs).forEach(([key, input]) => { input.value = String(initialConfiguration[key]); });
  updateActions();
}

function showAccess(message = "", tone = "", canSignIn = false, loading = false){
  editorPanel.hidden = true;
  accessPanel.hidden = false;
  accessPanel.classList.toggle("is-loading", loading);
  accessSpinner.hidden = !loading;
  accessStatus.hidden = loading;
  loginButton.hidden = loading || !canSignIn;
  if(!loading){
    accessStatus.textContent = message;
    accessStatus.className = `editor-status ${tone}`.trim();
  }
}

async function loadConfiguration(){
  showAccess("", "", false, true);
  if(!embedded){
    const { data:sessionData, error:sessionError } = await supabase.auth.getSession();
    if(sessionError) throw sessionError;
    if(!sessionData?.session?.user){
      showAccess("Sign in with Discord to edit season configuration.", "", true);
      return;
    }
    const { error:userError } = await supabase.auth.getUser();
    if(userError) throw userError;
    if(!await getTournamentAdminFlag(supabase)){
      showAccess("Admin access is required.", "error");
      return;
    }
  }

  const { data, error } = await supabase
    .from("season_configuration")
    .select("ranked_league_season,shotgun_pro_league_season,shotgun_pro_league_stage,super_league_season")
    .eq("id", "current")
    .single();
  if(error) throw error;

  accessPanel.hidden = true;
  editorPanel.hidden = false;
  render(data);
}

form.addEventListener("input", updateActions);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if(saving || !dirtyCount()) return;
  let configuration;
  try{
    configuration = parsedValues();
  }catch(error){
    setMessage(error.message, "error");
    return;
  }

  saving = true;
  updateActions();
  setMessage("Saving…");
  try{
    const { data, error } = await supabase.rpc(
      "update_season_configuration",
      seasonConfigurationRpcParams(configuration, initialConfiguration),
    );
    if(error) throw error;
    render(Array.isArray(data) ? data[0] : data);
    setMessage("Season configuration saved and logged.", "success");
  }catch(error){
    setMessage(error?.message || "Unable to save season configuration.", "error");
  }finally{
    saving = false;
    Object.values(inputs).forEach((input) => { input.disabled = false; });
    saveButton.disabled = dirtyCount() === 0;
    resetButton.disabled = dirtyCount() === 0;
  }
});

resetButton.addEventListener("click", () => {
  render(initialConfiguration);
  setMessage("Unsaved changes reset.", "success");
});

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  const { error } = await supabase.auth.signInWithOAuth({
    provider:"discord",
    options:{ redirectTo:buildAuthRedirectTo(globalThis.location.href) },
  });
  if(error){
    loginButton.disabled = false;
    showAccess(error.message || "Unable to start Discord sign-in.", "error", true);
  }
});

globalThis.addEventListener("beforeunload", (event) => {
  if(!dirtyCount()) return;
  event.preventDefault();
  event.returnValue = "";
});

loadConfiguration().catch((error) => {
  showAccess(error?.message || "Unable to load season configuration.", "error", true);
});
