import { createBrowserSupabaseClient } from "/auth/supabase-auth.js";
import {
  MATCH_QUERY_PARAM,
  buildActualMatchesFromSheet,
  buildBracketContext,
  buildMatchRealtimeChannelName,
  buildResolvedMatchMap,
  formatRoundLabel,
  getMatchIdFromSearch,
  normalizeName,
} from "/lightningcup/match-feature.js";

const WORKER_BASE = "https://small-mud-2771.nextweekmedia.workers.dev/";
const SHEET_ID = "1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ";
const MATCH_STATE_TABLE = "match_states";
const MATCH_STATE_VERSION = 1;

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
  matchId: getMatchIdFromSearch(globalThis.location?.search || ""),
  actualMatches: [],
  context: null,
  resolvedMatches: new Map(),
  match: null,
  error: "",
  liveError: "",
  matchState: createInitialMatchState(),
  matchStateRowUpdatedAt: "",
  realtimeStatus: "idle",
  realtimeChannel: null,
  onlinePlayers: { 1: false, 2: false },
};

const els = {
  pageStatus: document.getElementById("pageStatus"),
  scoreboardTopName: document.getElementById("scoreboardTopName"),
  scoreboardTopSeed: document.getElementById("scoreboardTopSeed"),
  scoreboardBottomName: document.getElementById("scoreboardBottomName"),
  scoreboardBottomSeed: document.getElementById("scoreboardBottomSeed"),
  scoreboardTopSet1: document.getElementById("scoreboardTopSet1"),
  scoreboardTopSet2: document.getElementById("scoreboardTopSet2"),
  scoreboardTopSet3: document.getElementById("scoreboardTopSet3"),
  scoreboardBottomSet1: document.getElementById("scoreboardBottomSet1"),
  scoreboardBottomSet2: document.getElementById("scoreboardBottomSet2"),
  scoreboardBottomSet3: document.getElementById("scoreboardBottomSet3"),
  scoreboardTopMatch: document.getElementById("scoreboardTopMatch"),
  scoreboardBottomMatch: document.getElementById("scoreboardBottomMatch"),
  courseGrid: document.getElementById("courseGrid"),
  specialCourseSlot: document.getElementById("specialCourseSlot"),
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

function getRemainingCourseId(courseSelections){
  const selectedCourses = new Set(courseSelections);
  return COURSE_CHOICES.find((course) => !selectedCourses.has(course.id))?.id || null;
}

function getSuddenDeathCourseId(setState){
  const result = deriveSetResult(setState);
  if(Number(setState.setNumber) !== 3 || !result.suddenDeath) return null;

  const selections = result.courseSelections;
  return selections[COURSE_CHOICES.length - 1] ||
    (selections.length === COURSE_CHOICES.length - 1 ? getRemainingCourseId(selections) : null);
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
    if(setState.setNumber === 3 && trimmedResult.suddenDeath && !trimmedResult.winner){
      const selections = parseCourseSelections(setState.courseSelections);
      const suddenDeathCourse = getSuddenDeathCourseId(setState);
      if(suddenDeathCourse && selections.length === COURSE_CHOICES.length - 1){
        setState.courseSelections = toCsv([...selections, suddenDeathCourse]);
      }
    }

    const finalResult = deriveSetResult(setState);
    setState.suddenDeath = finalResult.suddenDeath;
    setState.winner = finalResult.winner;
  });

  matchState.history = Array.isArray(matchState.history) ? matchState.history : [];
  return matchState;
}

function sanitizeMatchState(rawState){
  const raw = rawState && typeof rawState === "object" ? rawState : {};
  return reconcileMatchState({
    version: MATCH_STATE_VERSION,
    created: raw.created !== false,
    started: !!raw.started,
    hole13CtpWinner: parsePlayerValue(raw.hole13CtpWinner),
    sets: [1, 2, 3].map((setNumber) => sanitizeSet(raw.sets?.[setNumber - 1], setNumber)),
    history: Array.isArray(raw.history) ? raw.history : [],
  });
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

function getPlayerSlot(player){
  return player === 1 ? state.match?.top : player === 2 ? state.match?.bottom : null;
}

function getPlayerClass(player){
  return player === 1 ? "is-player-one" : player === 2 ? "is-player-two" : "";
}

function formatSeedLabel(seed){
  return seed == null ? "TBD" : String(seed);
}

function getCourseHoleLabel(courseId){
  const normalizedCourseId = Number(courseId);
  if(!COURSE_BY_ID.has(normalizedCourseId)) return "";
  const firstHole = ((normalizedCourseId - 1) * 3) + 1;
  return `Holes ${firstHole}-${firstHole + 2}`;
}

function getMatchPhase(matchState){
  if(!matchState.started){
    return { type: "start", setIndex: -1, course: null };
  }

  if(!matchState.hole13CtpWinner){
    return { type: "ctp", setIndex: -1, course: null };
  }

  if(getMatchWinner(matchState)){
    return { type: "complete", setIndex: -1, course: null };
  }

  const currentSetIndex = getCurrentSetIndex(matchState);
  const currentSet = matchState.sets[currentSetIndex];
  if(!currentSet){
    return { type: "complete", setIndex: -1, course: null };
  }

  const result = deriveSetResult(currentSet);
  if(result.courseSelections.length === result.pointWinners.length){
    return {
      type: "course",
      setIndex: currentSetIndex,
      course: null,
    };
  }

  return {
    type: "point",
    setIndex: currentSetIndex,
    course: result.courseSelections[result.pointWinners.length],
  };
}

function getDisplaySetIndex(matchState){
  const currentSetIndex = getCurrentSetIndex(matchState);
  if(currentSetIndex >= 0) return currentSetIndex;

  for(let index = matchState.sets.length - 1; index >= 0; index -= 1){
    const setState = matchState.sets[index];
    const result = deriveSetResult(setState);
    if(result.courseSelections.length > 0 || result.pointWinners.length > 0 || setState.winner){
      return index;
    }
  }

  return 0;
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

function setScoreCell(cell, value, player, isWon){
  cell.textContent = value;
  cell.className = [
    cell.id.includes("Match") ? "scoreboard-match-score" : "scoreboard-score",
    getPlayerClass(player),
    isWon ? "is-won" : "",
  ].filter(Boolean).join(" ");
}

function getCourseSelectionInfo(matchState, courseId, setIndex){
  const targetSet = Number.isInteger(setIndex) && setIndex >= 0 ? matchState.sets[setIndex] : null;
  if(!targetSet) return { selected: false, owner: null, suddenDeath: false };

  const selections = parseCourseSelections(targetSet.courseSelections);
  const selectedIndex = selections.indexOf(courseId);
  if(selectedIndex < 0){
    return { selected: false, owner: null, suddenDeath: false };
  }

  const suddenDeathCourse = getSuddenDeathCourseId(targetSet);
  const isSuddenDeathCourse = suddenDeathCourse === courseId && selectedIndex === COURSE_CHOICES.length - 1;
  return {
    selected: true,
    owner: isSuddenDeathCourse ? null : getPickerForPointIndex(targetSet, selectedIndex),
    suddenDeath: isSuddenDeathCourse,
  };
}

function renderStatus(){
  const message = normalizeName(state.error || state.liveError);
  els.pageStatus.textContent = message;
  els.pageStatus.className = `obs-status${message ? "" : " is-hidden"}`;
}

function renderScoreboard(){
  const matchState = state.matchState;
  const setsWon = getSetsWon(matchState);
  const matchWinner = getMatchWinner(matchState);

  els.scoreboardTopSeed.textContent = formatSeedLabel(state.match?.top?.seed);
  els.scoreboardTopName.textContent = normalizeName(state.match?.top?.name) || "TBD";
  els.scoreboardBottomSeed.textContent = formatSeedLabel(state.match?.bottom?.seed);
  els.scoreboardBottomName.textContent = normalizeName(state.match?.bottom?.name) || "TBD";

  setScoreCell(els.scoreboardTopSet1, formatSetScoreValue(matchState, 0, 1), 1, matchState.sets[0].winner === 1);
  setScoreCell(els.scoreboardTopSet2, formatSetScoreValue(matchState, 1, 1), 1, matchState.sets[1].winner === 1);
  setScoreCell(els.scoreboardTopSet3, formatSetScoreValue(matchState, 2, 1), 1, matchState.sets[2].winner === 1);
  setScoreCell(els.scoreboardBottomSet1, formatSetScoreValue(matchState, 0, 2), 2, matchState.sets[0].winner === 2);
  setScoreCell(els.scoreboardBottomSet2, formatSetScoreValue(matchState, 1, 2), 2, matchState.sets[1].winner === 2);
  setScoreCell(els.scoreboardBottomSet3, formatSetScoreValue(matchState, 2, 2), 2, matchState.sets[2].winner === 2);

  setScoreCell(els.scoreboardTopMatch, String(setsWon[1]), 1, matchWinner === 1);
  setScoreCell(els.scoreboardBottomMatch, String(setsWon[2]), 2, matchWinner === 2);
}

function createCourseTile(course, phase, displaySetIndex){
  const info = getCourseSelectionInfo(state.matchState, course.id, displaySetIndex);
  const isCurrentSet = phase.setIndex === displaySetIndex;
  const isLiveCourse = phase.type === "point" && isCurrentSet && Number(phase.course) === course.id;

  const tile = document.createElement("article");
  tile.className = [
    "course-tile",
    info.selected ? "is-picked" : "",
    info.suddenDeath ? "is-sudden-death" : "",
    info.owner === 1 ? "is-player-one" : "",
    info.owner === 2 ? "is-player-two" : "",
    isLiveCourse ? "is-live" : "",
  ].filter(Boolean).join(" ");

  const name = document.createElement("span");
  name.className = "course-tile-name";
  name.textContent = course.name;

  const meta = document.createElement("span");
  meta.className = "course-tile-meta";
  meta.textContent = getCourseHoleLabel(course.id);

  tile.append(name, meta);
  return tile;
}

function renderCourses(){
  const phase = getMatchPhase(state.matchState);
  const displaySetIndex = getDisplaySetIndex(state.matchState);

  els.courseGrid.replaceChildren(...COURSE_CHOICES.slice(0, 6).map((course) => createCourseTile(course, phase, displaySetIndex)));
  els.specialCourseSlot.replaceChildren(createCourseTile(COURSE_CHOICES[6], phase, displaySetIndex));
}

function updateDocumentTitle(){
  const roundLabel = state.match ? formatRoundLabel(state.match.round) : "Lightning Cup";
  const matchLabel = Number.isFinite(Number(state.match?.id ?? state.matchId))
    ? `Match ${Number(state.match?.id ?? state.matchId)}`
    : "Match";
  document.title = `${roundLabel} ${matchLabel} | Lightning Cup OBS`;
}

function renderPage(){
  renderStatus();
  updateDocumentTitle();
  renderScoreboard();
  renderCourses();
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

async function loadMatchContext(){
  const bracketRaw = await fetchSheet("Bracket!A:J");
  state.actualMatches = buildActualMatchesFromSheet(bracketRaw);
  state.context = buildBracketContext(state.actualMatches);
  state.resolvedMatches = buildResolvedMatchMap(state.actualMatches, state.context);
  state.match = state.resolvedMatches.get(Number(state.matchId)) || null;

  if(!state.match){
    throw new Error("That Lightning Cup match could not be found.");
  }
}

async function loadPersistedMatchState(){
  state.liveError = "";
  renderPage();

  const { data, error } = await supabase
    .from(MATCH_STATE_TABLE)
    .select("match_id,state,updated_at")
    .eq("match_id", state.matchId)
    .maybeSingle();

  if(error){
    state.liveError = "Live match state could not load.";
    return;
  }

  state.matchState = sanitizeMatchState(data?.state || createInitialMatchState());
  state.matchStateRowUpdatedAt = normalizeName(data?.updated_at);
}

function updateRealtimePresence(channel){
  const presenceState = typeof channel?.presenceState === "function" ? channel.presenceState() : {};
  const onlinePlayers = { 1: false, 2: false };

  Object.values(presenceState || {}).forEach((entries) => {
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const player = parsePlayerValue(entry?.player);
      if(player){
        onlinePlayers[player] = true;
      }
    });
  });

  state.onlinePlayers = onlinePlayers;
  renderScoreboard();
}

function handlePostgresMatchStateChange(payload){
  const row = payload?.new || null;
  if(!row || Number(row.match_id) !== Number(state.matchId)) return;
  state.matchState = sanitizeMatchState(row.state || createInitialMatchState());
  state.matchStateRowUpdatedAt = normalizeName(row.updated_at);
  state.liveError = "";
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

  const channel = supabase.channel(buildMatchRealtimeChannelName(state.matchId), {
    config: {
      presence: { key: `obs-${Math.random().toString(36).slice(2, 10)}` },
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
      updateRealtimePresence(channel);
    });

  channel.subscribe((status) => {
    state.realtimeStatus = normalizeName(status) || "idle";

    if(status !== "SUBSCRIBED") return;
    void channel.track({
      viewedAt: new Date().toISOString(),
      matchId: state.matchId,
      source: "obs",
    }).then(() => {
      updateRealtimePresence(channel);
    }).catch(() => {
      // Presence is helpful for live dots, but not required for the feed itself.
    });
  });

  state.realtimeChannel = channel;
}

async function init(){
  if(!state.matchId){
    setError(`Missing ${MATCH_QUERY_PARAM} query parameter.`);
    renderPage();
    return;
  }

  renderPage();

  try{
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

globalThis.addEventListener("pagehide", () => {
  void unsubscribeRealtime();
});

void init();
