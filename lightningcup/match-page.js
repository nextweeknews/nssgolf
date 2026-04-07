import { buildAuthRedirectTo, createBrowserSupabaseClient } from "/auth/supabase-auth.js";
import {
  MATCH_PAGE_PATH,
  buildActualMatchesFromSheet,
  buildBracketContext,
  buildMatchRealtimeChannelName,
  buildResolvedMatchMap,
  formatRoundLabel,
  getMatchIdFromSearch,
  isUserParticipantInMatch as resolveIsUserParticipantInMatch,
  normalizeDiscordId,
  normalizeName,
  parseSeedsNameDiscordMap,
} from "/lightningcup/match-feature.js";

const WORKER_BASE = "https://small-mud-2771.nextweekmedia.workers.dev/";
const SHEET_ID = "1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ";
const MATCH_STATE_TABLE = "match_states";
const MATCH_STATE_VERSION = 1;
const MAX_UNDO_DEPTH = 40;
const MAX_HISTORY_EVENTS = 200;

const COURSE_CHOICES = Object.freeze([
  { id: 1, name: "Resort A" },
  { id: 2, name: "Resort B" },
  { id: 3, name: "Resort C" },
  { id: 4, name: "Classic A" },
  { id: 5, name: "Classic B" },
  { id: 6, name: "Classic C" },
  { id: 7, name: "Special" },
]);
const COURSE_BY_ID = new Map(COURSE_CHOICES.map((course) => [course.id, course]));

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
  liveError: "",
  saveError: "",
  matchState: createInitialMatchState(),
  matchStateRowUpdatedAt: "",
  matchStateLoadStatus: "idle",
  isSaving: false,
  realtimeChannel: null,
  realtimeStatus: "idle",
  realtimeViewerCount: 0,
  onlinePlayers: { 1: false, 2: false },
};

const els = {
  pageStatus: document.getElementById("pageStatus"),
  scoreboardTopName: document.getElementById("scoreboardTopName"),
  scoreboardTopSeed: document.getElementById("scoreboardTopSeed"),
  scoreboardTopOnline: document.getElementById("scoreboardTopOnline"),
  scoreboardBottomName: document.getElementById("scoreboardBottomName"),
  scoreboardBottomSeed: document.getElementById("scoreboardBottomSeed"),
  scoreboardBottomOnline: document.getElementById("scoreboardBottomOnline"),
  scoreboardTopSet1: document.getElementById("scoreboardTopSet1"),
  scoreboardTopSet2: document.getElementById("scoreboardTopSet2"),
  scoreboardTopSet3: document.getElementById("scoreboardTopSet3"),
  scoreboardBottomSet1: document.getElementById("scoreboardBottomSet1"),
  scoreboardBottomSet2: document.getElementById("scoreboardBottomSet2"),
  scoreboardBottomSet3: document.getElementById("scoreboardBottomSet3"),
  scoreboardTopMatch: document.getElementById("scoreboardTopMatch"),
  scoreboardBottomMatch: document.getElementById("scoreboardBottomMatch"),
  signInBtn: document.getElementById("signInBtn"),
  courseGrid: document.getElementById("courseGrid"),
  specialCourseSlot: document.getElementById("specialCourseSlot"),
  courseHint: document.getElementById("courseHint"),
  flowPrompt: document.getElementById("flowPrompt"),
  flowDetail: document.getElementById("flowDetail"),
  actionButtons: document.getElementById("actionButtons"),
  undoBtn: document.getElementById("undoBtn"),
  eventLog: document.getElementById("eventLog"),
  realtimeStatusText: document.getElementById("realtimeStatusText"),
  realtimePulse: document.getElementById("realtimePulse"),
  lastUpdatedText: document.getElementById("lastUpdatedText"),
};

function setError(message){
  state.error = normalizeName(message);
}

function createEmptySet(setNumber, firstPicker = null){
  return {
    setNumber,
    firstPicker,
    pointWinners: "",
    courseSelections: "",
    suddenDeath: false,
    winner: null,
  };
}

function createInitialMatchState(){
  return {
    version: MATCH_STATE_VERSION,
    created: true,
    started: false,
    hole13CtpWinner: null,
    sets: [createEmptySet(1), createEmptySet(2), createEmptySet(3)],
    history: [],
    undoStack: [],
  };
}

function parsePlayerValue(value){
  const player = Number(value);
  return player === 1 || player === 2 ? player : null;
}

function parseCourseValue(value){
  const course = Number(value);
  return COURSE_BY_ID.has(course) ? course : null;
}

function parseCsvValues(value, parser){
  const rawValues = Array.isArray(value) ? value : String(value || "").split(",");
  return rawValues.map((entry) => parser(entry)).filter((entry) => entry != null);
}

function parsePointWinners(value){
  return parseCsvValues(value, parsePlayerValue);
}

function parseCourseSelections(value){
  const seen = new Set();
  const selections = [];
  parseCsvValues(value, parseCourseValue).forEach((courseId) => {
    if(seen.has(courseId)) return;
    seen.add(courseId);
    selections.push(courseId);
  });
  return selections;
}

function toCsv(values){
  return values.map((value) => String(value)).join(",");
}

function getOtherPlayer(player){
  return player === 1 ? 2 : player === 2 ? 1 : null;
}

function getPlayerSlot(player){
  return player === 1 ? state.match?.top : player === 2 ? state.match?.bottom : null;
}

function getPlayerName(player){
  return normalizeName(getPlayerSlot(player)?.name) || `Player ${player}`;
}

function getPlayerLabel(player){
  return player === 1 || player === 2 ? `${getPlayerName(player)} (Player ${player})` : "System";
}

function getCourseName(courseId){
  return COURSE_BY_ID.get(Number(courseId))?.name || "Unknown course";
}

function getCourseHoleLabel(courseId){
  const normalizedCourseId = Number(courseId);
  if(!COURSE_BY_ID.has(normalizedCourseId)) return "";
  const firstHole = ((normalizedCourseId - 1) * 3) + 1;
  return `Holes ${firstHole}-${firstHole + 2}`;
}

function sanitizeSet(rawSet, setNumber){
  const raw = rawSet && typeof rawSet === "object" ? rawSet : {};
  const pointWinners = parsePointWinners(raw.pointWinners);
  const courseSelections = parseCourseSelections(raw.courseSelections);
  return {
    setNumber,
    firstPicker: parsePlayerValue(raw.firstPicker),
    pointWinners: toCsv(pointWinners),
    courseSelections: toCsv(courseSelections),
    suddenDeath: !!raw.suddenDeath,
    winner: parsePlayerValue(raw.winner),
  };
}

function sanitizeHistoryEvent(event){
  if(!event || typeof event !== "object") return null;
  const type = normalizeName(event.type);
  if(!type) return null;
  const at = normalizeName(event.at);
  const setNumber = Number(event.setNumber);
  const course = parseCourseValue(event.course);
  const sanitized = {
    type,
    player: parsePlayerValue(event.player),
    at: Number.isFinite(Date.parse(at)) ? at : "",
  };
  if(Number.isFinite(setNumber) && setNumber >= 1 && setNumber <= 3){
    sanitized.setNumber = setNumber;
  }
  if(course != null){
    sanitized.course = course;
  }
  return sanitized;
}

function cloneJson(value){
  return JSON.parse(JSON.stringify(value));
}

function snapshotMatchState(matchState){
  const snapshot = cloneJson(matchState);
  delete snapshot.undoStack;
  return snapshot;
}

function configureFirstPickers(matchState){
  const ctpWinner = parsePlayerValue(matchState.hole13CtpWinner);
  const firstPickers = ctpWinner ? [ctpWinner, getOtherPlayer(ctpWinner), ctpWinner] : [null, null, null];
  matchState.sets.forEach((setState, index) => {
    setState.firstPicker = firstPickers[index];
  });
}

function deriveSetResult(setState){
  const pointWinners = parsePointWinners(setState.pointWinners);
  const courseSelections = parseCourseSelections(setState.courseSelections);
  const score = { 1: 0, 2: 0 };
  const setNumber = Number(setState.setNumber);
  let winner = null;
  let winnerAtIndex = null;
  let suddenDeath = false;

  for(let index = 0; index < pointWinners.length; index += 1){
    const pointWinner = pointWinners[index];

    if(setNumber === 3 && suddenDeath){
      score[pointWinner] += 1;
      winner = pointWinner;
      winnerAtIndex = index;
      break;
    }

    score[pointWinner] += 1;

    if(setNumber === 3){
      if(score[1] === 3 && score[2] === 3){
        suddenDeath = true;
        continue;
      }

      if(Math.max(score[1], score[2]) >= 3 && Math.abs(score[1] - score[2]) >= 2){
        winner = pointWinner;
        winnerAtIndex = index;
        break;
      }
    }else if(score[pointWinner] >= 3){
      winner = pointWinner;
      winnerAtIndex = index;
      break;
    }
  }

  return {
    pointWinners,
    courseSelections,
    score,
    winner,
    winnerAtIndex,
    suddenDeath,
  };
}

function reconcileMatchState(matchState){
  matchState.version = MATCH_STATE_VERSION;
  matchState.created = true;
  matchState.started = !!matchState.started;
  matchState.hole13CtpWinner = parsePlayerValue(matchState.hole13CtpWinner);
  matchState.sets = [1, 2, 3].map((setNumber) => sanitizeSet(matchState.sets?.[setNumber - 1], setNumber));
  configureFirstPickers(matchState);

  matchState.sets.forEach((setState) => {
    const rawResult = deriveSetResult(setState);
    const playablePointWinners = rawResult.pointWinners.slice(0, rawResult.courseSelections.length);
    setState.pointWinners = toCsv(playablePointWinners);
    setState.courseSelections = toCsv(rawResult.courseSelections);

    const result = deriveSetResult(setState);
    const trimmedPointWinners = result.winnerAtIndex == null
      ? result.pointWinners
      : result.pointWinners.slice(0, result.winnerAtIndex + 1);
    const maxCourseSelections = result.winnerAtIndex == null
      ? trimmedPointWinners.length + 1
      : trimmedPointWinners.length;
    const trimmedCourseSelections = result.courseSelections.slice(0, Math.min(maxCourseSelections, COURSE_CHOICES.length));
    setState.pointWinners = toCsv(trimmedPointWinners);
    setState.courseSelections = toCsv(trimmedCourseSelections);

    const trimmedResult = deriveSetResult(setState);
    setState.suddenDeath = trimmedResult.suddenDeath;
    setState.winner = trimmedResult.winner;
  });

  matchState.history = Array.isArray(matchState.history)
    ? matchState.history.map(sanitizeHistoryEvent).filter(Boolean).slice(-MAX_HISTORY_EVENTS)
    : [];
  return matchState;
}

function sanitizeMatchState(rawState, { includeUndoStack = true } = {}){
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  const sanitized = reconcileMatchState({
    version: MATCH_STATE_VERSION,
    created: raw.created !== false,
    started: !!raw.started,
    hole13CtpWinner: parsePlayerValue(raw.hole13CtpWinner),
    sets: [1, 2, 3].map((setNumber) => sanitizeSet(raw.sets?.[setNumber - 1], setNumber)),
    history: Array.isArray(raw.history) ? raw.history : [],
    undoStack: [],
  });

  if(includeUndoStack && Array.isArray(raw.undoStack)){
    sanitized.undoStack = raw.undoStack
      .slice(-MAX_UNDO_DEPTH)
      .map((snapshot) => sanitizeMatchState(snapshot, { includeUndoStack: false }))
      .filter(Boolean);
  }else if(!includeUndoStack){
    delete sanitized.undoStack;
  }

  return sanitized;
}

function withUndoSnapshot(matchState){
  const nextState = sanitizeMatchState(cloneJson(matchState));
  nextState.undoStack = [
    ...(Array.isArray(matchState.undoStack) ? matchState.undoStack : []),
    snapshotMatchState(matchState),
  ].slice(-MAX_UNDO_DEPTH);
  return nextState;
}

function recordEvent(matchState, event){
  matchState.history = [
    ...(Array.isArray(matchState.history) ? matchState.history : []),
    {
      ...event,
      at: event.at || new Date().toISOString(),
    },
  ].slice(-MAX_HISTORY_EVENTS);
}

function getSetsWon(matchState){
  return matchState.sets.reduce((wins, setState) => {
    const winner = parsePlayerValue(setState.winner);
    if(winner){
      wins[winner] += 1;
    }
    return wins;
  }, { 1: 0, 2: 0 });
}

function getMatchWinner(matchState){
  const wins = { 1: 0, 2: 0 };
  for(const setState of matchState.sets){
    const winner = parsePlayerValue(setState.winner);
    if(!winner) continue;
    wins[winner] += 1;
    if(wins[winner] >= 2) return winner;
  }
  return null;
}

function getCurrentSetIndex(matchState){
  if(!matchState.started || !matchState.hole13CtpWinner || getMatchWinner(matchState)) return -1;
  return matchState.sets.findIndex((setState) => !parsePlayerValue(setState.winner));
}

function getPickerForPointIndex(setState, pointIndex){
  const firstPicker = parsePlayerValue(setState.firstPicker);
  if(!firstPicker) return null;
  return pointIndex % 2 === 0 ? firstPicker : getOtherPlayer(firstPicker);
}

function getMatchPhase(matchState){
  if(!matchState.started){
    return {
      type: "start",
      prompt: "Start match",
      detail: "Ready when both players are here.",
    };
  }

  if(!matchState.hole13CtpWinner){
    return {
      type: "ctp",
      prompt: "Hole 13 CTP",
      detail: "Who won it?",
    };
  }

  const matchWinner = getMatchWinner(matchState);
  if(matchWinner){
    return {
      type: "complete",
      prompt: "Match complete",
      detail: `${getPlayerName(matchWinner)} wins.`,
      player: matchWinner,
    };
  }

  const currentSetIndex = getCurrentSetIndex(matchState);
  const currentSet = matchState.sets[currentSetIndex];
  if(!currentSet){
    return {
      type: "complete",
      prompt: "The match is complete.",
      detail: "Final result locked.",
    };
  }

  const result = deriveSetResult(currentSet);
  if(result.courseSelections.length === result.pointWinners.length){
    const picker = getPickerForPointIndex(currentSet, result.courseSelections.length);
    const availableCourseCount = COURSE_CHOICES.length - result.courseSelections.length;
    const isSuddenDeathPick = currentSet.setNumber === 3 && result.suddenDeath;
    return {
      type: "course",
      prompt: isSuddenDeathPick
        ? "Sudden death"
        : "Course pick",
      detail: isSuddenDeathPick
        ? "Choose the final unplayed course."
        : `${getPlayerName(picker)} chooses. ${availableCourseCount} left.`,
      setIndex: currentSetIndex,
      setState: currentSet,
      player: picker,
      suddenDeath: isSuddenDeathPick,
    };
  }

  const courseId = result.courseSelections[result.pointWinners.length];
  const picker = getPickerForPointIndex(currentSet, result.pointWinners.length);
  return {
    type: "point",
    prompt: `${getCourseName(courseId)} result`,
    detail: "Who won the point?",
    setIndex: currentSetIndex,
    setState: currentSet,
    course: courseId,
    player: picker,
  };
}

function getAuthDiscordId(){
  return normalizeDiscordId(state.profile?.discord_user_id);
}

function getCurrentViewerPlayerNumber(){
  const discordUserId = getAuthDiscordId();
  if(!discordUserId || !state.match) return null;
  if(discordUserId === normalizeDiscordId(getDiscordIdForPlayerName(state.match.top?.name))) return 1;
  if(discordUserId === normalizeDiscordId(getDiscordIdForPlayerName(state.match.bottom?.name))) return 2;
  return null;
}

function getCanEditMatch(){
  return !!state.session && !!state.match && isUserParticipantInMatch(getAuthDiscordId(), state.match);
}

function getCanApplyActions(){
  return getCanEditMatch() && !state.isSaving && !state.liveError;
}

function getActionRestrictionMessage(){
  if(state.isSaving) return "Saving the latest match state...";
  if(state.liveError) return state.liveError;
  if(!state.session) return "Sign in to control the match.";
  if(!getAuthDiscordId()) return "Discord ID missing.";
  if(!isUserParticipantInMatch(getAuthDiscordId(), state.match)){
    return "View only.";
  }
  return "";
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

async function loadPersistedMatchState(){
  state.matchStateLoadStatus = "loading";
  state.liveError = "";
  renderPage();

  const { data, error } = await supabase
    .from(MATCH_STATE_TABLE)
    .select("match_id,state,updated_at")
    .eq("match_id", state.matchId)
    .maybeSingle();

  if(error){
    state.matchStateLoadStatus = "error";
    state.liveError = "Live match state could not load. Check the match_states table and Realtime setup.";
    return;
  }

  state.matchState = sanitizeMatchState(data?.state || createInitialMatchState());
  state.matchStateRowUpdatedAt = normalizeName(data?.updated_at);
  state.matchStateLoadStatus = data ? "loaded" : "not-created";
}

function renderStatus(message, type = ""){
  const clean = normalizeName(message);
  els.pageStatus.textContent = clean;
  els.pageStatus.className = `match-page-status${clean ? "" : " is-hidden"}${type === "error" ? " is-error" : ""}`;
}

function renderAuthNotice(){
  if(!state.session){
    els.signInBtn.hidden = false;
    return;
  }

  els.signInBtn.hidden = true;
}

function formatSetScoreValue(matchState, setIndex, player){
  const setState = matchState.sets[setIndex];
  const result = deriveSetResult(setState);
  const currentSetIndex = getCurrentSetIndex(matchState);
  const shouldShowScore = !!setState.winner ||
    result.pointWinners.length > 0 ||
    result.courseSelections.length > 0 ||
    (matchState.started && matchState.hole13CtpWinner && currentSetIndex === setIndex);

  return shouldShowScore ? String(result.score[player]) : "-";
}

function setScoreCell(cell, value, isWon){
  cell.textContent = value;
  cell.className = `scoreboard-score${isWon ? " is-won" : ""}`;
}

function renderScoreboard(){
  const matchState = state.matchState;
  const setsWon = getSetsWon(matchState);
  const matchWinner = getMatchWinner(matchState);

  els.scoreboardTopSeed.textContent = formatSeedLabel(state.match?.top?.seed);
  els.scoreboardTopName.textContent = normalizeName(state.match?.top?.name) || "TBD";
  els.scoreboardBottomSeed.textContent = formatSeedLabel(state.match?.bottom?.seed);
  els.scoreboardBottomName.textContent = normalizeName(state.match?.bottom?.name) || "TBD";
  els.scoreboardTopOnline.className = `online-dot${state.onlinePlayers[1] ? " is-online" : ""}`;
  els.scoreboardBottomOnline.className = `online-dot${state.onlinePlayers[2] ? " is-online" : ""}`;

  setScoreCell(els.scoreboardTopSet1, formatSetScoreValue(matchState, 0, 1), matchState.sets[0].winner === 1);
  setScoreCell(els.scoreboardTopSet2, formatSetScoreValue(matchState, 1, 1), matchState.sets[1].winner === 1);
  setScoreCell(els.scoreboardTopSet3, formatSetScoreValue(matchState, 2, 1), matchState.sets[2].winner === 1);
  setScoreCell(els.scoreboardBottomSet1, formatSetScoreValue(matchState, 0, 2), matchState.sets[0].winner === 2);
  setScoreCell(els.scoreboardBottomSet2, formatSetScoreValue(matchState, 1, 2), matchState.sets[1].winner === 2);
  setScoreCell(els.scoreboardBottomSet3, formatSetScoreValue(matchState, 2, 2), matchState.sets[2].winner === 2);

  els.scoreboardTopMatch.textContent = String(setsWon[1]);
  els.scoreboardBottomMatch.textContent = String(setsWon[2]);
  els.scoreboardTopMatch.className = `scoreboard-match-score${matchWinner === 1 ? " is-won" : ""}`;
  els.scoreboardBottomMatch.className = `scoreboard-match-score${matchWinner === 2 ? " is-won" : ""}`;
}

function getCourseSelectionInfo(matchState, courseId){
  const currentSetIndex = getCurrentSetIndex(matchState);
  const currentSet = currentSetIndex >= 0 ? matchState.sets[currentSetIndex] : null;
  if(!currentSet) return { selected: false, owner: null, selectedIndex: -1 };

  const selections = parseCourseSelections(currentSet.courseSelections);
  const selectedIndex = selections.indexOf(courseId);
  if(selectedIndex < 0){
    return { selected: false, owner: null, selectedIndex: -1, setState: currentSet };
  }

  return {
    selected: true,
    owner: getPickerForPointIndex(currentSet, selectedIndex),
    selectedIndex,
    setState: currentSet,
  };
}

function createCourseButton(course, phase, availableCourseIds){
  const info = getCourseSelectionInfo(state.matchState, course.id);
  const canApply = getCanApplyActions();
  const isCoursePhase = phase.type === "course";
  const isAvailable = availableCourseIds.has(course.id);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.courseId = String(course.id);
  button.className = [
    "course-button",
    info.selected ? "is-picked" : "",
    info.owner === 1 ? "is-player-one" : "",
    info.owner === 2 ? "is-player-two" : "",
  ].filter(Boolean).join(" ");
  button.disabled = !canApply || !isCoursePhase || info.selected || !isAvailable;
  button.setAttribute("aria-pressed", info.selected ? "true" : "false");

  const name = document.createElement("span");
  name.className = "course-button-name";
  name.textContent = course.name;
  button.append(name);

  const meta = document.createElement("span");
  meta.className = "course-button-meta";
  meta.textContent = getCourseHoleLabel(course.id);
  button.append(meta);

  return button;
}

function renderCourses(){
  const phase = getMatchPhase(state.matchState);
  const currentSet = phase.setState || null;
  const selectedCourses = currentSet ? parseCourseSelections(currentSet.courseSelections) : [];
  const availableCourseIds = phase.type === "course"
    ? new Set(COURSE_CHOICES.map((course) => course.id).filter((courseId) => !selectedCourses.includes(courseId)))
    : new Set();

  els.courseGrid.replaceChildren(...COURSE_CHOICES.slice(0, 6).map((course) => createCourseButton(course, phase, availableCourseIds)));
  els.specialCourseSlot.replaceChildren(createCourseButton(COURSE_CHOICES[6], phase, availableCourseIds));
  els.courseHint.textContent = phase.type === "course"
    ? phase.detail
    : currentSet
      ? "Course choices reset at the beginning of each set."
      : "Courses will unlock after the match starts and Hole 13 CTP is recorded.";
}

function createActionButton(label, action, player = null){
  const button = document.createElement("button");
  button.type = "button";
  button.className = [
    "flow-action",
    player === 1 ? "is-player-one" : "",
    player === 2 ? "is-player-two" : "",
  ].filter(Boolean).join(" ");
  button.dataset.action = action;
  if(player){
    button.dataset.player = String(player);
  }
  button.disabled = !getCanApplyActions();
  button.textContent = label;
  return button;
}

function renderFlow(){
  const phase = getMatchPhase(state.matchState);
  const restriction = getActionRestrictionMessage();
  els.flowPrompt.textContent = phase.prompt;
  els.flowDetail.textContent = restriction || phase.detail || "";
  els.actionButtons.replaceChildren();

  if(phase.type === "start"){
    els.actionButtons.append(createActionButton("Start match", "start"));
  }else if(phase.type === "ctp"){
    els.actionButtons.append(
      createActionButton(getPlayerName(1), "ctp", 1),
      createActionButton(getPlayerName(2), "ctp", 2)
    );
  }else if(phase.type === "point"){
    els.actionButtons.append(
      createActionButton(getPlayerName(1), "point", 1),
      createActionButton(getPlayerName(2), "point", 2)
    );
  }else if(phase.type === "course"){
    const note = document.createElement("span");
    note.className = "flow-action-note";
    note.textContent = "Pick below";
    els.actionButtons.append(note);
  }

  const canUndo = Array.isArray(state.matchState.undoStack) && state.matchState.undoStack.length > 0;
  els.undoBtn.disabled = !getCanApplyActions() || !canUndo;
}

function formatEventTimestamp(value){
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatLastUpdatedTimestamp(value){
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function getEventSetLabel(event){
  if(event.setNumber) return `Set ${event.setNumber}`;
  if(event.type === "hole13_ctp") return "CTP";
  return "Match";
}

function formatHistoryEvent(event){
  const playerLabel = event.player ? getPlayerLabel(event.player) : "System";
  if(event.type === "start_match") return "Match started";
  if(event.type === "hole13_ctp") return `Hole 13 CTP won by ${playerLabel}`;
  if(event.type === "course_pick") return `Set ${event.setNumber} course pick: ${getCourseName(event.course)} by ${playerLabel}`;
  if(event.type === "point_win") return `Set ${event.setNumber} point won by ${playerLabel}`;
  if(event.type === "set_win") return `Set ${event.setNumber} won by ${playerLabel}`;
  if(event.type === "sudden_death") return `Set ${event.setNumber} sudden death started`;
  if(event.type === "match_win") return `Match won by ${playerLabel}`;
  return event.type.replaceAll("_", " ");
}

function renderEventLog(){
  const events = Array.isArray(state.matchState.history) ? state.matchState.history : [];
  if(events.length === 0){
    const emptyItem = document.createElement("li");
    emptyItem.className = "event-log-empty";
    emptyItem.textContent = "No match events yet.";
    els.eventLog.replaceChildren(emptyItem);
    return;
  }

  els.eventLog.replaceChildren(...events.map((event) => {
    const item = document.createElement("li");
    item.className = [
      "event-log-item",
      event.player === 1 ? "is-player-one" : "",
      event.player === 2 ? "is-player-two" : "",
    ].filter(Boolean).join(" ");

    const setLabel = document.createElement("span");
    setLabel.className = "event-log-set";
    setLabel.textContent = getEventSetLabel(event);

    const timestamp = document.createElement("time");
    timestamp.className = "event-log-time";
    timestamp.dateTime = event.at || "";
    timestamp.textContent = formatEventTimestamp(event.at);

    const message = document.createElement("span");
    message.className = "event-log-message";
    message.textContent = formatHistoryEvent(event);

    item.append(setLabel, timestamp, message);
    return item;
  }));
}

function renderRealtimeState(){
  const isError = !!state.saveError || !!state.liveError || state.realtimeStatus === "CHANNEL_ERROR" || state.realtimeStatus === "TIMED_OUT";
  const isLive = state.realtimeStatus === "SUBSCRIBED" && !isError;

  els.realtimeStatusText.textContent = isError
    ? (state.saveError || state.liveError || "SYNC ERROR")
    : "LIVE";
  els.realtimeStatusText.className = `realtime-state${isError ? " is-error" : ""}`;
  els.realtimePulse.className = `live-dot${isLive ? " is-live" : ""}`;
  els.lastUpdatedText.textContent = `Last updated: ${state.matchStateRowUpdatedAt ? formatLastUpdatedTimestamp(state.matchStateRowUpdatedAt) : "-"}`;
}

function renderPage(){
  if(state.error){
    renderStatus(state.error, "error");
  }else{
    renderStatus("");
  }

  if(!state.match){
    renderAuthNotice();
    renderScoreboard();
    renderCourses();
    renderFlow();
    renderEventLog();
    renderRealtimeState();
    return;
  }

  const roundLabel = formatRoundLabel(state.match.round);
  document.title = `${roundLabel} Match ${state.match.id} | Lightning Cup`;
  renderAuthNotice();

  renderScoreboard();
  renderCourses();
  renderFlow();
  renderEventLog();
  renderRealtimeState();
}

function updateRealtimeViewerCount(channel){
  const presenceState = typeof channel?.presenceState === "function" ? channel.presenceState() : {};
  const onlinePlayers = { 1: false, 2: false };
  state.realtimeViewerCount = Object.values(presenceState || {}).reduce((count, entries) => {
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const player = parsePlayerValue(entry?.player);
      if(player) onlinePlayers[player] = true;
    });
    return count + (Array.isArray(entries) ? entries.length : 0);
  }, 0);
  state.onlinePlayers = onlinePlayers;
  renderScoreboard();
  renderRealtimeState();
}

function handlePostgresMatchStateChange(payload){
  const row = payload?.new || null;
  if(!row || Number(row.match_id) !== Number(state.matchId)) return;
  state.matchState = sanitizeMatchState(row.state || createInitialMatchState());
  state.matchStateRowUpdatedAt = normalizeName(row.updated_at);
  state.matchStateLoadStatus = "loaded";
  state.liveError = "";
  state.saveError = "";
  renderPage();
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
      presence: { key: presenceKey },
    },
  });

  const changeFilter = `match_id=eq.${Number(state.matchId)}`;
  channel
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: MATCH_STATE_TABLE,
      filter: changeFilter,
    }, handlePostgresMatchStateChange)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: MATCH_STATE_TABLE,
      filter: changeFilter,
    }, handlePostgresMatchStateChange)
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
      participant: isUserParticipantInMatch(getAuthDiscordId(), state.match),
      player: getCurrentViewerPlayerNumber(),
      userId: normalizeName(state.session?.user?.id) || "anonymous",
    }).then(() => {
      updateRealtimeViewerCount(channel);
    }).catch(() => {
      // Tracking presence is helpful but not required for live scoring.
    });
  });

  state.realtimeChannel = channel;
}

async function persistMatchState(nextState){
  const previousState = state.matchState;
  const sanitizedNextState = sanitizeMatchState(nextState);
  state.matchState = sanitizedNextState;
  state.isSaving = true;
  state.saveError = "";
  renderPage();

  const row = {
    match_id: Number(state.matchId),
    state: sanitizedNextState,
  };
  const updaterId = normalizeName(state.session?.user?.id);
  if(updaterId){
    row.updated_by = updaterId;
  }

  const { data, error } = await supabase
    .from(MATCH_STATE_TABLE)
    .upsert(row, { onConflict: "match_id" })
    .select("match_id,state,updated_at")
    .single();

  state.isSaving = false;

  if(error){
    state.matchState = previousState;
    state.saveError = "Could not save the live match state. Please try again.";
    renderPage();
    return;
  }

  state.matchState = sanitizeMatchState(data?.state || sanitizedNextState);
  state.matchStateRowUpdatedAt = normalizeName(data?.updated_at) || new Date().toISOString();
  state.matchStateLoadStatus = "loaded";
  renderPage();
}

async function applyMatchAction(action, payload = {}){
  if(!getCanApplyActions()) return;

  const phase = getMatchPhase(state.matchState);
  const now = new Date().toISOString();
  let nextState = withUndoSnapshot(state.matchState);

  if(action === "start" && phase.type === "start"){
    nextState.started = true;
    recordEvent(nextState, { type: "start_match", player: null, at: now });
  }else if(action === "ctp" && phase.type === "ctp"){
    const player = parsePlayerValue(payload.player);
    if(!player) return;
    nextState.hole13CtpWinner = player;
    configureFirstPickers(nextState);
    recordEvent(nextState, { type: "hole13_ctp", player, at: now });
  }else if(action === "course" && phase.type === "course"){
    const course = parseCourseValue(payload.course);
    const setState = nextState.sets[phase.setIndex];
    const selections = parseCourseSelections(setState.courseSelections);
    if(!course || selections.includes(course)) return;
    const picker = getPickerForPointIndex(setState, selections.length);
    setState.courseSelections = toCsv([...selections, course]);
    recordEvent(nextState, {
      type: "course_pick",
      player: picker,
      setNumber: setState.setNumber,
      course,
      at: now,
    });
  }else if(action === "point" && phase.type === "point"){
    const player = parsePlayerValue(payload.player);
    if(!player) return;
    const setState = nextState.sets[phase.setIndex];
    const beforeSetResult = deriveSetResult(setState);
    setState.pointWinners = toCsv([...beforeSetResult.pointWinners, player]);
    recordEvent(nextState, {
      type: "point_win",
      player,
      setNumber: setState.setNumber,
      at: now,
    });
    reconcileMatchState(nextState);
    const afterSetState = nextState.sets[phase.setIndex];
    if(afterSetState.suddenDeath && !beforeSetResult.suddenDeath && !afterSetState.winner){
      recordEvent(nextState, {
        type: "sudden_death",
        player: null,
        setNumber: afterSetState.setNumber,
        at: now,
      });
    }
    if(afterSetState.winner && beforeSetResult.winner !== afterSetState.winner){
      recordEvent(nextState, {
        type: "set_win",
        player: afterSetState.winner,
        setNumber: afterSetState.setNumber,
        at: now,
      });
      const matchWinner = getMatchWinner(nextState);
      if(matchWinner){
        recordEvent(nextState, {
          type: "match_win",
          player: matchWinner,
          at: now,
        });
      }
    }
  }else{
    return;
  }

  nextState = sanitizeMatchState(nextState);
  await persistMatchState(nextState);
}

async function undoLastAction(){
  if(!getCanApplyActions()) return;
  const undoStack = Array.isArray(state.matchState.undoStack) ? state.matchState.undoStack : [];
  const snapshot = undoStack[undoStack.length - 1];
  if(!snapshot) return;

  const restoredState = sanitizeMatchState(snapshot, { includeUndoStack: false });
  restoredState.undoStack = undoStack.slice(0, -1);
  await persistMatchState(restoredState);
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
    await loadPersistedMatchState();
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

els.actionButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if(!button) return;
  void applyMatchAction(button.dataset.action, {
    player: button.dataset.player,
  });
});

els.undoBtn.addEventListener("click", () => {
  void undoLastAction();
});

els.courseGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-course-id]");
  if(!button) return;
  void applyMatchAction("course", {
    course: button.dataset.courseId,
  });
});

els.specialCourseSlot.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-course-id]");
  if(!button) return;
  void applyMatchAction("course", {
    course: button.dataset.courseId,
  });
});

globalThis.addEventListener("pagehide", () => {
  void unsubscribeRealtime();
});

void init();
