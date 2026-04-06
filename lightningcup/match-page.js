import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js";
import {
  MATCH_PAGE_PATH,
  buildActualMatchesFromSheet,
  buildBracketContext,
  buildMatchRealtimeChannelName,
  buildResolvedMatchMap,
  formatRoundLabel,
  getMatchIdFromSearch,
  getRegionNameForMatch,
  isUserParticipantInMatch as resolveIsUserParticipantInMatch,
  normalizeDiscordId,
  normalizeName,
  parseSeedsNameDiscordMap,
  shouldShowRegionLabel,
} from "/lightningcup/match-feature.js";

const WORKER_BASE = "https://small-mud-2771.nextweekmedia.workers.dev/";
const SHEET_ID = "1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ";
const FALLBACK_REGION_RGB = "125,211,252";
const REGION_ACCENT_RGB_BY_NAME = {
  "Wii Plaza": "250,204,21",
  "Wuhu Island": "168,85,247",
  "Wedge Island": "125,211,252",
  "Spocco Square": "249,115,22",
};

const supabase = createBrowserSupabaseClient();

const state = {
  session: null,
  profile: null,
  matchId: getMatchIdFromSearch(globalThis.location?.search || ""),
  actualMatches: [],
  context: null,
  resolvedMatches: new Map(),
  seedDiscordMap: new Map(),
  seedDiscordMapLower: new Map(),
  match: null,
  error: "",
  realtimeChannel: null,
  realtimeStatus: "idle",
  realtimeViewerCount: 0,
  lastMatchStatePayload: null,
  lastMatchStateAt: "",
};

const els = {
  pageStatus: document.getElementById("pageStatus"),
  matchTitle: document.getElementById("matchTitle"),
  matchMeta: document.getElementById("matchMeta"),
  matchIdValue: document.getElementById("matchIdValue"),
  authChip: document.getElementById("authChip"),
  realtimeChip: document.getElementById("realtimeChip"),
  participantTopSeed: document.getElementById("participantTopSeed"),
  participantTopName: document.getElementById("participantTopName"),
  participantTopDiscord: document.getElementById("participantTopDiscord"),
  participantBottomSeed: document.getElementById("participantBottomSeed"),
  participantBottomName: document.getElementById("participantBottomName"),
  participantBottomDiscord: document.getElementById("participantBottomDiscord"),
  authNotice: document.getElementById("authNotice"),
  signInBtn: document.getElementById("signInBtn"),
  placeholderText: document.getElementById("placeholderText"),
  realtimeStatusText: document.getElementById("realtimeStatusText"),
  realtimeChannelName: document.getElementById("realtimeChannelName"),
  realtimeViewerCount: document.getElementById("realtimeViewerCount"),
  realtimePayload: document.getElementById("realtimePayload"),
};

function setError(message){
  state.error = normalizeName(message);
}

async function fetchSheet(range){
  const url = new URL(WORKER_BASE);
  url.searchParams.set("sheetId", SHEET_ID);
  url.searchParams.set("range", range);
  const response = await fetch(url.toString());
  if(!response.ok){
    throw new Error(`Worker fetch failed (${response.status})`);
  }
  return response.json();
}

function getDiscordIdForPlayerName(name){
  const clean = normalizeName(name);
  if(!clean) return "";
  const exact = normalizeDiscordId(state.seedDiscordMap.get(clean));
  if(exact) return exact;
  return normalizeDiscordId(state.seedDiscordMapLower.get(clean.toLowerCase()));
}

function isUserParticipantInMatch(userDiscordId, matchData){
  return resolveIsUserParticipantInMatch(userDiscordId, matchData, getDiscordIdForPlayerName);
}

function formatSeedLabel(seed){
  return seed == null ? "TBD" : String(seed);
}

function formatDiscordLabel(name){
  const discordId = getDiscordIdForPlayerName(name);
  return discordId ? `Discord ID ${discordId}` : "Discord ID unavailable";
}

function getProviderProfileName(user){
  const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  return normalizeName(
    metadata.full_name ||
    metadata.name ||
    metadata.global_name ||
    metadata.preferred_username ||
    metadata.user_name ||
    metadata.username
  );
}

function getDiscordProviderIdFromIdentities(identities){
  const list = Array.isArray(identities) ? identities : [];
  const discordIdentity = list.find((identity) => normalizeName(identity?.provider).toLowerCase() === "discord");
  if(!discordIdentity) return "";
  return normalizeName(
    discordIdentity.provider_id ||
    discordIdentity.identity_data?.provider_id ||
    discordIdentity.identity_data?.sub ||
    discordIdentity.identity_data?.id
  );
}

async function syncSessionFromSupabase(){
  const { data, error } = await supabase.auth.getSession();
  if(error){
    throw error;
  }
  state.session = data?.session?.user ? data.session : null;
}

async function syncProfileFromAuthUser(){
  const sessionUserId = normalizeName(state.session?.user?.id);
  if(!sessionUserId) return;

  let authUser = state.session?.user || null;
  try{
    const { data, error } = await supabase.auth.getUser();
    if(!error && data?.user?.id === sessionUserId){
      authUser = data.user;
    }
  }catch{
    // Keep match bootstrap resilient if auth enrichment is unavailable.
  }

  const identities = Array.isArray(authUser?.identities) ? authUser.identities : [];
  const discordUserId = getDiscordProviderIdFromIdentities(identities);
  const providerFullName = getProviderProfileName(authUser);

  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id,username,discord_user_id,full_name")
    .eq("user_id", sessionUserId)
    .maybeSingle();
  if(profileError){
    return;
  }

  const payload = { user_id: sessionUserId };
  let shouldUpsert = !existingProfile;

  if(discordUserId && discordUserId !== normalizeName(existingProfile?.discord_user_id)){
    payload.discord_user_id = discordUserId;
    shouldUpsert = true;
  }

  if(providerFullName && providerFullName !== normalizeName(existingProfile?.full_name)){
    payload.full_name = providerFullName;
    shouldUpsert = true;
  }

  if(!normalizeName(existingProfile?.username) && providerFullName){
    payload.username = providerFullName;
    shouldUpsert = true;
  }

  if(!shouldUpsert){
    return;
  }

  try{
    await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
  }catch{
    // Keep page usable even if profile sync is temporarily unavailable.
  }
}

async function loadProfileFromCurrentSession(){
  if(!state.session?.user?.id){
    state.profile = null;
    return;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,username,discord_user_id,full_name")
    .eq("user_id", state.session.user.id)
    .maybeSingle();
  if(error){
    throw error;
  }
  state.profile = data || null;
}

async function loadMatchContext(){
  const [bracketRaw, seedsRaw] = await Promise.all([
    fetchSheet("Bracket!A:J"),
    fetchSheet("Seeds!C:E"),
  ]);

  state.actualMatches = buildActualMatchesFromSheet(bracketRaw);
  const seedMaps = parseSeedsNameDiscordMap(seedsRaw);
  state.seedDiscordMap = seedMaps.exact;
  state.seedDiscordMapLower = seedMaps.lower;
  state.context = buildBracketContext(state.actualMatches);
  state.resolvedMatches = buildResolvedMatchMap(state.actualMatches, state.context);
  state.match = state.resolvedMatches.get(Number(state.matchId)) || null;

  if(!state.match){
    throw new Error("That Lightning Cup match could not be found.");
  }
}

function renderStatus(message, type = ""){
  const clean = normalizeName(message);
  els.pageStatus.textContent = clean;
  els.pageStatus.className = `match-page-status${clean ? "" : " is-hidden"}${type === "error" ? " is-error" : ""}`;
}

function renderParticipantCard(prefix, slot){
  const seedEl = prefix === "top" ? els.participantTopSeed : els.participantBottomSeed;
  const nameEl = prefix === "top" ? els.participantTopName : els.participantBottomName;
  const discordEl = prefix === "top" ? els.participantTopDiscord : els.participantBottomDiscord;
  seedEl.textContent = formatSeedLabel(slot?.seed);
  nameEl.textContent = normalizeName(slot?.name) || "TBD";
  discordEl.textContent = formatDiscordLabel(slot?.name);
}

function getAuthChipState(){
  if(!state.session){
    return { label: "SIGNED OUT", tone: "muted" };
  }

  const discordUserId = normalizeDiscordId(state.profile?.discord_user_id);
  if(!discordUserId){
    return { label: "PROFILE DISCORD ID MISSING", tone: "warn" };
  }

  if(isUserParticipantInMatch(discordUserId, state.match)){
    return { label: "SIGNED IN AS PARTICIPANT", tone: "ok" };
  }

  return { label: "SIGNED IN, NOT A PARTICIPANT", tone: "warn" };
}

function renderAuthNotice(){
  if(!state.session){
    els.authNotice.textContent = "Sign in with your Discord-linked account to confirm player access for this match.";
    els.signInBtn.hidden = false;
    return;
  }

  const discordUserId = normalizeDiscordId(state.profile?.discord_user_id);
  els.signInBtn.hidden = true;

  if(!discordUserId){
    els.authNotice.textContent = "You are signed in, but your public profile does not have a Discord ID yet.";
    return;
  }

  if(isUserParticipantInMatch(discordUserId, state.match)){
    els.authNotice.textContent = "Your Discord-linked profile matches one of the seeded participants for this matchup.";
    return;
  }

  els.authNotice.textContent = "You are signed in, but your profile Discord ID does not match either seeded participant for this matchup.";
}

function renderRealtimeState(){
  const channelName = state.matchId ? buildMatchRealtimeChannelName(state.matchId) : "lightningcup:match";
  els.realtimeChannelName.textContent = channelName;
  els.realtimeViewerCount.textContent = `${state.realtimeViewerCount} viewer${state.realtimeViewerCount === 1 ? "" : "s"}`;
  els.realtimeChip.textContent = state.realtimeStatus.toUpperCase();

  const toneClass = state.realtimeStatus === "SUBSCRIBED"
    ? "is-ok"
    : state.realtimeStatus === "CHANNEL_ERROR" || state.realtimeStatus === "TIMED_OUT"
      ? "is-error"
      : "";
  els.realtimeChip.className = `match-status-chip ${toneClass}`.trim();

  if(state.realtimeStatus === "SUBSCRIBED"){
    els.realtimeStatusText.textContent = "Realtime channel connected. Future live score and match-state events can flow through this subscription.";
  }else if(state.realtimeStatus === "CHANNEL_ERROR" || state.realtimeStatus === "TIMED_OUT"){
    els.realtimeStatusText.textContent = "Realtime channel could not connect cleanly. The page shell still loaded.";
  }else{
    els.realtimeStatusText.textContent = "Connecting the match-specific Realtime channel.";
  }

  if(state.lastMatchStatePayload){
    els.realtimePayload.textContent = JSON.stringify({
      receivedAt: state.lastMatchStateAt,
      payload: state.lastMatchStatePayload,
    }, null, 2);
  }else{
    els.realtimePayload.textContent = "Waiting for match-state broadcasts.";
  }
}

function renderPage(){
  if(state.error){
    renderStatus(state.error, "error");
  }else{
    renderStatus("");
  }

  if(!state.match){
    els.matchTitle.textContent = "Lightning Cup Match";
    els.matchMeta.textContent = "Load a valid match to see the future live match shell.";
    els.matchIdValue.textContent = state.matchId == null ? "Unknown" : String(state.matchId);
    els.placeholderText.textContent = "This page will become the live head-to-head match surface in a later phase.";
    renderAuthNotice();
    renderRealtimeState();
    return;
  }

  const roundLabel = formatRoundLabel(state.match.round);
  const regionName = getRegionNameForMatch(state.match);
  const matchMetaParts = [`${roundLabel}`];
  if(shouldShowRegionLabel(state.match.round) && regionName){
    matchMetaParts.push(`${regionName} region`);
  }

  document.title = `${roundLabel} Match ${state.match.id} | Lightning Cup`;
  els.matchTitle.textContent = `${normalizeName(state.match.top?.name) || "TBD"} vs ${normalizeName(state.match.bottom?.name) || "TBD"}`;
  els.matchMeta.textContent = matchMetaParts.join(" • ").toUpperCase();
  els.matchIdValue.textContent = String(state.match.id);

  const authChip = getAuthChipState();
  els.authChip.textContent = authChip.label;
  els.authChip.className = `match-status-chip${authChip.tone === "ok" ? " is-ok" : authChip.tone === "warn" ? " is-warn" : ""}`;

  renderParticipantCard("top", state.match.top);
  renderParticipantCard("bottom", state.match.bottom);
  renderAuthNotice();

  const regionAccent = REGION_ACCENT_RGB_BY_NAME[regionName] || FALLBACK_REGION_RGB;
  document.documentElement.style.setProperty("--match-region-rgb", regionAccent);
  els.placeholderText.textContent = "This is the first-phase match shell. The full live scoring and interaction UI will be added on top of this route.";
  renderRealtimeState();
}

function updateRealtimeViewerCount(channel){
  const presenceState = typeof channel?.presenceState === "function" ? channel.presenceState() : {};
  state.realtimeViewerCount = Object.values(presenceState || {}).reduce((count, entries) => {
    return count + (Array.isArray(entries) ? entries.length : 0);
  }, 0);
  renderRealtimeState();
}

async function unsubscribeRealtime(){
  if(!state.realtimeChannel) return;
  try{
    await supabase.removeChannel(state.realtimeChannel);
  }catch{
    // Ignore channel teardown issues during page transitions.
  }
  state.realtimeChannel = null;
}

async function subscribeToMatchRealtime(){
  if(!state.matchId) return;
  await unsubscribeRealtime();

  const presenceKey = normalizeName(state.session?.user?.id) || `anon-${Math.random().toString(36).slice(2, 10)}`;
  const channel = supabase.channel(buildMatchRealtimeChannelName(state.matchId), {
    config: {
      broadcast: { self: false },
      presence: { key: presenceKey },
    },
  });

  channel
    .on("broadcast", { event: "match-state" }, (eventPayload) => {
      state.lastMatchStatePayload = eventPayload?.payload || null;
      state.lastMatchStateAt = new Date().toISOString();
      renderRealtimeState();
    })
    .on("presence", { event: "sync" }, () => {
      updateRealtimeViewerCount(channel);
    });

  channel.subscribe((status) => {
    state.realtimeStatus = normalizeName(status) || "idle";
    renderRealtimeState();

    if(status !== "SUBSCRIBED") return;
    void channel.track({
      viewedAt: new Date().toISOString(),
      matchId: state.matchId,
      participant: isUserParticipantInMatch(normalizeDiscordId(state.profile?.discord_user_id), state.match),
      userId: normalizeName(state.session?.user?.id) || "anonymous",
    }).then(() => {
      updateRealtimeViewerCount(channel);
    }).catch(() => {
      // Tracking presence is helpful but not required for the scaffold.
    });
  });

  state.realtimeChannel = channel;
}

async function handleDiscordSignIn(){
  const returnPath = `${globalThis.location?.pathname || MATCH_PAGE_PATH}${globalThis.location?.search || ""}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: buildAuthRedirectTo(returnPath) },
  });
  if(error){
    throw error;
  }
}

async function init(){
  if(!state.matchId){
    setError("Missing matchId query parameter.");
    renderPage();
    return;
  }

  renderPage();

  try{
    await syncSessionFromSupabase();
    await syncProfileFromAuthUser();
    await loadProfileFromCurrentSession();
    await loadMatchContext();
    renderPage();
    await subscribeToMatchRealtime();
  }catch(error){
    setError(error?.message || "Could not load this match.");
  }

  renderPage();
}

els.signInBtn.addEventListener("click", () => {
  void handleDiscordSignIn().catch(() => {
    renderStatus("Could not start Discord sign-in. Please try again.", "error");
  });
});

globalThis.addEventListener("pagehide", () => {
  void unsubscribeRealtime();
});

void init();
