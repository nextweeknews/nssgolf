import React from "react";
import { createRoot } from "react-dom/client";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Popover from "@radix-ui/react-popover";
import * as Progress from "@radix-ui/react-progress";
import * as RadioGroup from "@radix-ui/react-radio-group";

const MAIN_TAB_BY_PARENT = {
  results: "Actual Bracket",
  game: "Your Bracket",
};

function getParentValueFromMainTab(mainTab){
  return mainTab === "Actual Bracket" ? "results" : "game";
}

function MainNavigation({ loggedIn, mainTab, year, onMainTabChange }){
  const selectedParentValue = getParentValueFromMainTab(mainTab);
  const [openParentValue, setOpenParentValue] = React.useState(selectedParentValue);

  React.useEffect(() => {
    setOpenParentValue(selectedParentValue);
  }, [selectedParentValue]);

  const handleParentValueChange = () => {
    // Intentionally no-op to keep menu selection click-driven only.
  };

  const handleParentTriggerClick = (event, value) => {
    event.preventDefault();
    setOpenParentValue(value);

    if(value === "results"){
      onMainTabChange("Actual Bracket");
      return;
    }
    if(value === "game"){
      if(!loggedIn) return;
      const nextMainTab = MAIN_TAB_BY_PARENT[value] || "Your Bracket";
      if(mainTab !== "Your Bracket" && mainTab !== "Leaderboard"){
        onMainTabChange(nextMainTab);
      }
    }
  };

  const handleChildLinkSelect = (event, targetMainTab, parentValue) => {
    event.preventDefault();
    if(targetMainTab !== "Actual Bracket" && !loggedIn) return;
    setOpenParentValue(parentValue);
    onMainTabChange(targetMainTab);
  };

  return (
    <NavigationMenu.Root
      className="lc-nav-root"
      value={openParentValue}
      onValueChange={handleParentValueChange}
      delayDuration={120}
      skipDelayDuration={80}
    >
      <NavigationMenu.List className="lc-nav-list">
        <NavigationMenu.Item value="results" className="lc-nav-item">
          <NavigationMenu.Trigger className="lc-nav-trigger" onClick={(event) => handleParentTriggerClick(event, "results")}>
            <span className="lc-nav-trigger-label">Lightning Cup Tournament Results</span>
          </NavigationMenu.Trigger>
          <NavigationMenu.Content className="lc-nav-content">
            <ul className="lc-nav-sublist">
              <li>
                <NavigationMenu.Link
                  className="lc-nav-sublink"
                  active={mainTab === "Actual Bracket"}
                  href="#"
                  onClick={(event) => handleChildLinkSelect(event, "Actual Bracket", "results")}
                >
                  {year}
                </NavigationMenu.Link>
              </li>
            </ul>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item value="game" className="lc-nav-item">
          <NavigationMenu.Trigger className="lc-nav-trigger" onClick={(event) => handleParentTriggerClick(event, "game")}>
            <span className="lc-nav-trigger-label">Lightning Cup Bracket Game</span>
          </NavigationMenu.Trigger>
          <NavigationMenu.Content className="lc-nav-content">
            <ul className="lc-nav-sublist">
              <li>
                <NavigationMenu.Link
                  className="lc-nav-sublink"
                  active={mainTab === "Your Bracket"}
                  aria-disabled={loggedIn ? undefined : "true"}
                  data-disabled={loggedIn ? undefined : ""}
                  href="#"
                  onClick={(event) => handleChildLinkSelect(event, "Your Bracket", "game")}
                  tabIndex={loggedIn ? undefined : -1}
                >
                  Your Bracket
                </NavigationMenu.Link>
              </li>
              <li>
                <NavigationMenu.Link
                  className="lc-nav-sublink"
                  active={mainTab === "Leaderboard"}
                  aria-disabled={loggedIn ? undefined : "true"}
                  data-disabled={loggedIn ? undefined : ""}
                  href="#"
                  onClick={(event) => handleChildLinkSelect(event, "Leaderboard", "game")}
                  tabIndex={loggedIn ? undefined : -1}
                >
                  Leaderboard
                </NavigationMenu.Link>
              </li>
            </ul>
            {!loggedIn ? (
              <span className="lc-nav-subtext">Sign in to access bracket game views.</span>
            ) : null}
          </NavigationMenu.Content>
        </NavigationMenu.Item>

      </NavigationMenu.List>

      <div className="lc-nav-viewport-wrap">
        <NavigationMenu.Viewport className="lc-nav-viewport" />
      </div>
    </NavigationMenu.Root>
  );
}

function RegionTabs({ tabs, activeTab, onRegionTabChange }){
  return (
    <Tabs.Root className="lc-region-tabs-root" value={activeTab} onValueChange={onRegionTabChange}>
      <Tabs.List className="lc-region-tabs-list" aria-label="Lightning Cup bracket regions">
        {tabs.map((tab) => (
          <Tabs.Trigger key={tab} className="lc-region-tabs-trigger" value={tab}>
            {tab}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Content key={`${tab}-content`} className="lc-region-tabs-content" value={tab}>
          Region tab active: {tab}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

function PopoverWinnerRadio({ side, playerName, disabled }){
  const cleanPlayerName = typeof playerName === "string" ? playerName.trim() : "";
  if(!cleanPlayerName){
    return <span className={`lc-match-popover-choice-radio-spacer is-${side}`} aria-hidden="true" />;
  }

  return (
    <RadioGroup.Item
      className={`lc-match-popover-choice-radio is-${side}`}
      value={cleanPlayerName}
      disabled={disabled}
      aria-label={`Pick ${cleanPlayerName}`}
    >
      <RadioGroup.Indicator className="lc-match-popover-choice-radio-indicator" />
    </RadioGroup.Item>
  );
}

function PlayerComparisonColumn({
  side,
  player,
  showWinnerSelection = false,
  winnerSelectionDisabled = false,
  isWinnerSelected = false,
  isSelectionPending = false,
}){
  const playerName = player?.name || "TBD";
  const seedLabel = player?.seedLabel && player.seedLabel !== "—" ? player.seedLabel : "";
  const showRadio = showWinnerSelection && playerName && playerName !== "TBD";
  const columnClassName = [
    "lc-match-popover-row",
    "lc-match-popover-player",
    `lc-match-popover-player-${side}`,
    "lc-match-popover-player-head",
    isWinnerSelected ? "is-winner-selected" : "",
    isSelectionPending ? "is-selection-pending" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={columnClassName} title={playerName}>
      <div className="lc-match-popover-player-heading">
        {seedLabel ? <span className="lc-match-popover-player-seed">{seedLabel}</span> : null}
        {side === "right" && showRadio ? <PopoverWinnerRadio side={side} playerName={playerName} disabled={winnerSelectionDisabled} /> : null}
        <span className="lc-match-popover-player-name">{playerName}</span>
        {side === "left" && showRadio ? <PopoverWinnerRadio side={side} playerName={playerName} disabled={winnerSelectionDisabled} /> : null}
      </div>
    </div>
  );
}

function getPlayerSeasonValue(player, season){
  const seasonRows = Array.isArray(player?.seasons) ? player.seasons : [];
  const seasonRow = seasonRows.find((row) => `${row?.season}` === `${season}`);
  return seasonRow?.value || "Unranked";
}

const H2H_SEASONS = [9, 10, 11];
const DISPLAY_SEASONS_DESC = [...H2H_SEASONS].sort((left, right) => right - left);
const TEAMUP_HEAD_TO_HEAD_ENDPOINT = "https://empty-poetry-4be0.nextweekmedia.workers.dev/";
const headToHeadSeasonCache = new Map();
let transientOpenPopoverId = "";

function parseRankedSeasonValue(value){
  const clean = typeof value === "string" ? value.trim() : "";
  if(!clean || clean === "Unranked"){
    return {
      isRanked: false,
      text: clean || "Unranked",
    };
  }

  const pieces = clean.split(/\s*,\s*/);
  if(pieces.length < 2){
    return {
      isRanked: false,
      text: clean,
    };
  }

  return {
    isRanked: true,
    rank: pieces[0],
    elo: pieces.slice(1).join(", "),
  };
}

function RankedSeasonValue({ value, side }){
  const parsed = parseRankedSeasonValue(value);

  if(!parsed.isRanked){
    return <span className={`lc-match-popover-ranked-text${parsed.text === "Unranked" ? " is-muted" : ""}`}>{parsed.text}</span>;
  }

  return (
    <span className="lc-match-popover-ranked-value">
      <span className="lc-match-popover-ranked-metric">{parsed.rank}</span>
      <span className={`lc-match-popover-ranked-divider is-${side}`} aria-hidden="true" />
      <span className="lc-match-popover-ranked-metric">{parsed.elo}</span>
    </span>
  );
}

function normalizeDiscordId(value){
  return typeof value === "string" ? value.trim() : "";
}

function createHeadToHeadSeasonMap(defaultValue = null){
  return new Map(H2H_SEASONS.map((season) => [season, defaultValue]));
}

function getHeadToHeadCacheKey(playerA, playerB, season){
  return `${normalizeDiscordId(playerA)}::${normalizeDiscordId(playerB)}::${Number(season)}`;
}

function normalizeHeadToHeadCount(value){
  const parsed = Number(value);
  if(!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function normalizeHeadToHeadRecord(payload, season){
  const playerAWins = normalizeHeadToHeadCount(payload?.playerAWins ?? payload?.player_a_wins);
  const playerBWins = normalizeHeadToHeadCount(payload?.playerBWins ?? payload?.player_b_wins);
  const ties = normalizeHeadToHeadCount(payload?.ties);
  if(playerAWins == null || playerBWins == null || ties == null){
    return null;
  }
  return {
    season: Number(season),
    playerAWins,
    playerBWins,
    ties,
    totalMatches: playerAWins + playerBWins + ties,
  };
}

async function loadTeamUpHeadToHead(playerA, playerB, season){
  const normalizedPlayerA = normalizeDiscordId(playerA);
  const normalizedPlayerB = normalizeDiscordId(playerB);
  const normalizedSeason = Number(season);

  if(!normalizedPlayerA || !normalizedPlayerB || !Number.isFinite(normalizedSeason)){
    return null;
  }

  const cacheKey = getHeadToHeadCacheKey(normalizedPlayerA, normalizedPlayerB, normalizedSeason);
  if(headToHeadSeasonCache.has(cacheKey)){
    return headToHeadSeasonCache.get(cacheKey);
  }

  const request = (async () => {
    const url = new URL(TEAMUP_HEAD_TO_HEAD_ENDPOINT, globalThis.location?.origin || "https://nssgolf.com");
    url.searchParams.set("player_a", normalizedPlayerA);
    url.searchParams.set("player_b", normalizedPlayerB);
    url.searchParams.set("season", `${normalizedSeason}`);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if(!response.ok){
      throw new Error(`Head-to-head unavailable (${response.status}).`);
    }

    const payload = await response.json();
    return normalizeHeadToHeadRecord(payload, normalizedSeason);
  })().catch((error) => {
    headToHeadSeasonCache.delete(cacheKey);
    throw error;
  });

  headToHeadSeasonCache.set(cacheKey, request);
  return request;
}

async function loadHeadToHeadSeasons(playerA, playerB){
  const normalizedPlayerA = normalizeDiscordId(playerA);
  const normalizedPlayerB = normalizeDiscordId(playerB);
  if(!normalizedPlayerA || !normalizedPlayerB){
    return createHeadToHeadSeasonMap(null);
  }

  let failureCount = 0;
  let lastError = null;
  const seasonEntries = await Promise.all(H2H_SEASONS.map(async (season) => {
    try{
      return [season, await loadTeamUpHeadToHead(normalizedPlayerA, normalizedPlayerB, season)];
    }catch(error){
      failureCount += 1;
      lastError = error;
      return [season, null];
    }
  }));

  const records = new Map(seasonEntries);
  if(failureCount === H2H_SEASONS.length && lastError){
    const requestError = new Error(lastError?.message || "Head-to-head unavailable.");
    requestError.records = records;
    throw requestError;
  }

  return records;
}

function summarizeHeadToHeadAcrossSeasons(headToHeadBySeason){
  const source = headToHeadBySeason instanceof Map ? headToHeadBySeason : new Map();
  let validSeasonCount = 0;
  let playerAWins = 0;
  let playerBWins = 0;
  let ties = 0;

  H2H_SEASONS.forEach((season) => {
    const record = source.get(season);
    if(!record) return;
    validSeasonCount += 1;
    playerAWins += record.playerAWins;
    playerBWins += record.playerBWins;
    ties += record.ties;
  });

  const totalMatches = playerAWins + playerBWins + ties;
  const playerAWinPercent = totalMatches ? (playerAWins / totalMatches) * 100 : 0;
  const tiePercent = totalMatches ? (ties / totalMatches) * 100 : 0;
  const playerBWinPercent = totalMatches ? Math.max(0, 100 - playerAWinPercent - tiePercent) : 0;

  return {
    hasAnyData: validSeasonCount > 0,
    playerAWins: validSeasonCount > 0 ? playerAWins : null,
    playerBWins: validSeasonCount > 0 ? playerBWins : null,
    ties: validSeasonCount > 0 ? ties : null,
    totalMatches,
    playerAWinPercent,
    tiePercent,
    playerBWinPercent,
  };
}

function getHeadToHeadStatClass(record, isPending = false){
  if(record == null){
    return `lc-match-popover-row lc-match-popover-player-stat lc-match-popover-player-stat-muted${isPending ? " is-pending" : ""}`;
  }
  return "lc-match-popover-row lc-match-popover-player-stat";
}

function formatHeadToHeadSummaryCount(value, singular, plural, isPending = false){
  if(value == null){
    return isPending ? "..." : "N/A";
  }
  return `${value} ${value === 1 ? singular : plural}`;
}

function HeadToHeadRecordValue({ record, side, isPending = false }){
  if(record == null){
    return isPending ? "..." : "N/A";
  }

  const isRightSide = side === "right";
  const wins = isRightSide ? record.playerBWins : record.playerAWins;
  const losses = isRightSide ? record.playerAWins : record.playerBWins;

  return (
    <span className="lc-match-popover-h2h-record">
      <span>{wins}</span>
      <span className={`lc-match-popover-h2h-separator ${isRightSide ? "is-right" : "is-left"}`}>-</span>
      <span>{losses}</span>
      <span className={`lc-match-popover-h2h-separator ${isRightSide ? "is-right" : "is-left"}`}>-</span>
      <span>{record.ties}</span>
    </span>
  );
}

function HeadToHeadSummary({ summary, isPending }){
  const showNeutralProgress = !summary.hasAnyData || summary.totalMatches === 0;
  const leftLabelClass = `lc-match-popover-summary-label lc-match-popover-summary-label-left${summary.playerAWins == null ? " is-muted" : ""}`;
  const centerLabelClass = `lc-match-popover-summary-label lc-match-popover-summary-label-center${summary.ties == null ? " is-muted" : ""}`;
  const rightLabelClass = `lc-match-popover-summary-label lc-match-popover-summary-label-right${summary.playerBWins == null ? " is-muted" : ""}`;

  return (
    <div className="lc-match-popover-summary">
      <Progress.Root
        className="lc-match-popover-progress-root"
        value={showNeutralProgress ? 0 : 100}
        max={100}
        data-empty={showNeutralProgress ? "true" : undefined}
        aria-label="Ranked head-to-head summary across Seasons 9 to 11"
      >
        {showNeutralProgress ? null : (
          <>
            <Progress.Indicator
              className="lc-match-popover-progress-indicator lc-match-popover-progress-indicator-left"
              style={{ width: `${summary.playerAWinPercent}%` }}
            />
            <Progress.Indicator
              className="lc-match-popover-progress-indicator lc-match-popover-progress-indicator-ties"
              style={{ width: `${summary.tiePercent}%` }}
            />
            <Progress.Indicator
              className="lc-match-popover-progress-indicator lc-match-popover-progress-indicator-right"
              style={{ width: `${summary.playerBWinPercent}%` }}
            />
          </>
        )}
      </Progress.Root>

      <div className="lc-match-popover-summary-labels" aria-hidden="true">
        <span className={leftLabelClass}>{formatHeadToHeadSummaryCount(summary.playerAWins, "win", "wins", isPending)}</span>
        <span className={centerLabelClass}>{formatHeadToHeadSummaryCount(summary.ties, "tie", "ties", isPending)}</span>
        <span className={rightLabelClass}>{formatHeadToHeadSummaryCount(summary.playerBWins, "win", "wins", isPending)}</span>
      </div>
    </div>
  );
}

function MatchInfoPopover({ getMatchInfo, ensureRankedDataLoaded, onSelectWinner, popoverId }){
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [isHeadToHeadLoading, setIsHeadToHeadLoading] = React.useState(false);
  const [headToHeadLoadError, setHeadToHeadLoadError] = React.useState("");
  const [headToHeadBySeason, setHeadToHeadBySeason] = React.useState(() => createHeadToHeadSeasonMap(null));
  const [selectionPulseSide, setSelectionPulseSide] = React.useState("");
  const restoreOpenOnReturnRef = React.useRef(false);
  const selectionTimeoutRef = React.useRef(null);
  const [, forceRefresh] = React.useReducer((value) => value + 1, 0);

  const info = typeof getMatchInfo === "function" ? getMatchInfo() : null;
  const topPlayer = info?.top || {};
  const bottomPlayer = info?.bottom || {};
  const seasonLabels = Array.isArray(info?.seasons) && info.seasons.length ? info.seasons : [9, 10, 11];
  const displaySeasonLabels = React.useMemo(
    () => [...seasonLabels].sort((left, right) => Number(right) - Number(left)),
    [seasonLabels]
  );
  const topDiscordId = normalizeDiscordId(topPlayer?.discordId);
  const bottomDiscordId = normalizeDiscordId(bottomPlayer?.discordId);
  const headToHeadSummary = React.useMemo(
    () => summarizeHeadToHeadAcrossSeasons(headToHeadBySeason),
    [headToHeadBySeason]
  );
  const selectedWinnerName = typeof info?.selectedWinnerName === "string" ? info.selectedWinnerName.trim() : "";
  const showWinnerSelection = info?.showWinnerSelection === true;
  const winnerSelectionDisabled = info?.winnerSelectionDisabled !== false;

  React.useEffect(() => () => {
    if(selectionTimeoutRef.current != null){
      window.clearTimeout(selectionTimeoutRef.current);
    }
  }, []);

  const handleOpenChange = React.useCallback((nextOpen) => {
    setOpen(nextOpen);

    if(nextOpen){
      restoreOpenOnReturnRef.current = false;
      if(popoverId){
        transientOpenPopoverId = popoverId;
      }
      return;
    }

    if(typeof document !== "undefined" && document.visibilityState === "hidden"){
      if(popoverId && transientOpenPopoverId === popoverId){
        restoreOpenOnReturnRef.current = true;
      }
      return;
    }

    restoreOpenOnReturnRef.current = false;
    if(popoverId && transientOpenPopoverId === popoverId){
      transientOpenPopoverId = "";
    }
  }, [popoverId]);

  const handleWinnerValueChange = React.useCallback((nextWinnerName) => {
    if(!showWinnerSelection || winnerSelectionDisabled) return;
    const normalizedWinner = typeof nextWinnerName === "string" ? nextWinnerName.trim() : "";
    if(!normalizedWinner || normalizedWinner === selectedWinnerName) return;

    const nextSide = normalizedWinner === topPlayer?.name
      ? "left"
      : normalizedWinner === bottomPlayer?.name
        ? "right"
        : "";
    if(!nextSide) return;

    if(selectionTimeoutRef.current != null){
      window.clearTimeout(selectionTimeoutRef.current);
    }

    setSelectionPulseSide(nextSide);
    selectionTimeoutRef.current = window.setTimeout(() => {
      selectionTimeoutRef.current = null;
      const didSelect = typeof onSelectWinner === "function"
        ? onSelectWinner({ matchId: info?.matchId, winnerName: normalizedWinner, source: info?.source || "" })
        : false;
      if(didSelect){
        restoreOpenOnReturnRef.current = false;
        if(popoverId && transientOpenPopoverId === popoverId){
          transientOpenPopoverId = "";
        }
        setOpen(false);
      }
      setSelectionPulseSide("");
    }, 210);
  }, [
    showWinnerSelection,
    winnerSelectionDisabled,
    selectedWinnerName,
    topPlayer?.name,
    bottomPlayer?.name,
    onSelectWinner,
    info?.matchId,
    info?.source,
    popoverId,
  ]);

  React.useEffect(() => {
    if(!open || typeof ensureRankedDataLoaded !== "function") return undefined;
    let cancelled = false;
    setIsLoading(true);
    Promise.resolve()
      .then(() => ensureRankedDataLoaded())
      .then(() => {
        if(cancelled) return;
        setLoadError("");
        setIsLoading(false);
        forceRefresh();
      })
      .catch((error) => {
        if(cancelled) return;
        setIsLoading(false);
        setLoadError(error?.message || "Ranked history unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, ensureRankedDataLoaded]);

  React.useEffect(() => {
    if(!open) return undefined;
    let cancelled = false;

    if(!topDiscordId || !bottomDiscordId){
      setHeadToHeadBySeason(createHeadToHeadSeasonMap(null));
      setHeadToHeadLoadError("");
      setIsHeadToHeadLoading(false);
      return undefined;
    }

    setHeadToHeadBySeason(createHeadToHeadSeasonMap(undefined));
    setHeadToHeadLoadError("");
    setIsHeadToHeadLoading(true);

    loadHeadToHeadSeasons(topDiscordId, bottomDiscordId)
      .then((records) => {
        if(cancelled) return;
        setHeadToHeadBySeason(records);
        setHeadToHeadLoadError("");
        setIsHeadToHeadLoading(false);
      })
      .catch((error) => {
        if(cancelled) return;
        setHeadToHeadBySeason(error?.records instanceof Map ? error.records : createHeadToHeadSeasonMap(null));
        setHeadToHeadLoadError(error?.message || "Head-to-head unavailable.");
        setIsHeadToHeadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, topDiscordId, bottomDiscordId]);

  React.useEffect(() => {
    if(!popoverId) return undefined;

    const maybeRestore = () => {
      if(!restoreOpenOnReturnRef.current) return;
      if(transientOpenPopoverId !== popoverId) return;
      restoreOpenOnReturnRef.current = false;
      setOpen(true);
    };

    const handleVisibilityChange = () => {
      if(document.visibilityState === "hidden"){
        if(open){
          restoreOpenOnReturnRef.current = true;
          transientOpenPopoverId = popoverId;
        }
        return;
      }
      maybeRestore();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", maybeRestore);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", maybeRestore);
    };
  }, [open, popoverId]);

  const ariaLabel = info?.matchId
    ? `Match info for ${info.matchId}`
    : "Match info";

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button className="qualifier-match-info lc-match-info-trigger" type="button" aria-label={ariaLabel}>i</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="lc-match-popover-content"
          side="right"
          align="center"
          sideOffset={10}
          collisionPadding={12}
        >
          <RadioGroup.Root
            className="lc-match-popover-choice-group"
            value={selectedWinnerName}
            onValueChange={handleWinnerValueChange}
            disabled={!showWinnerSelection || winnerSelectionDisabled}
          >
            <div className="lc-match-popover-compare">
              <PlayerComparisonColumn
                side="left"
                player={topPlayer}
                showWinnerSelection={showWinnerSelection}
                winnerSelectionDisabled={winnerSelectionDisabled}
                isWinnerSelected={selectedWinnerName === topPlayer?.name}
                isSelectionPending={selectionPulseSide === "left"}
              />
              <div className="lc-match-popover-center-spacer" aria-hidden="true" />
              <PlayerComparisonColumn
                side="right"
                player={bottomPlayer}
                showWinnerSelection={showWinnerSelection}
                winnerSelectionDisabled={winnerSelectionDisabled}
                isWinnerSelected={selectedWinnerName === bottomPlayer?.name}
                isSelectionPending={selectionPulseSide === "right"}
              />
              <div className="lc-match-popover-row lc-match-popover-section-head">
                <span>Ranked Performance</span>
              </div>
              {displaySeasonLabels.map((season) => (
                <React.Fragment key={`season-label-${season}`}>
                  <div className="lc-match-popover-row lc-match-popover-player-stat"><RankedSeasonValue value={getPlayerSeasonValue(topPlayer, season)} side="left" /></div>
                  <div className="lc-match-popover-row lc-match-popover-center-label">Season {season}</div>
                  <div className="lc-match-popover-row lc-match-popover-player-stat"><RankedSeasonValue value={getPlayerSeasonValue(bottomPlayer, season)} side="right" /></div>
                </React.Fragment>
              ))}
              <div className="lc-match-popover-row lc-match-popover-section-head">
                <span>Ranked H2H</span>
              </div>
              <HeadToHeadSummary summary={headToHeadSummary} isPending={isHeadToHeadLoading && !headToHeadSummary.hasAnyData} />
              {DISPLAY_SEASONS_DESC.map((season) => {
                const record = headToHeadBySeason.get(season);
                const isPending = isHeadToHeadLoading && record === undefined;

                return (
                  <React.Fragment key={`h2h-season-${season}`}>
                    <div className={getHeadToHeadStatClass(record, isPending)}><HeadToHeadRecordValue record={record} side="left" isPending={isPending} /></div>
                    <div className={`lc-match-popover-row lc-match-popover-center-label${record == null ? " is-muted" : ""}`}>Season {season}</div>
                    <div className={getHeadToHeadStatClass(record, isPending)}><HeadToHeadRecordValue record={record} side="right" isPending={isPending} /></div>
                  </React.Fragment>
                );
              })}
            </div>
          </RadioGroup.Root>

          {isLoading ? <p className="lc-match-popover-status">Loading ranked history...</p> : null}
          {isHeadToHeadLoading ? <p className="lc-match-popover-status">Loading ranked H2H...</p> : null}
          {loadError ? <p className="lc-match-popover-status lc-match-popover-status-error">{loadError}</p> : null}
          {headToHeadLoadError ? <p className="lc-match-popover-status lc-match-popover-status-error">{headToHeadLoadError}</p> : null}

          <Popover.Arrow className="lc-match-popover-arrow" width={14} height={8} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function mountLightningCupRadixControls({
  mainTabsEl,
  regionTabsEl,
  regionTabs,
  onMainTabChange,
  onRegionTabChange,
}){
  const mainRoot = createRoot(mainTabsEl);
  const regionRoot = createRoot(regionTabsEl);

  return {
    render({ loggedIn, mainTab, activeTab, year }){
      mainRoot.render(
        <MainNavigation
          loggedIn={loggedIn}
          mainTab={mainTab}
          year={year || "2026"}
          onMainTabChange={onMainTabChange}
        />
      );

      regionRoot.render(
        <RegionTabs tabs={regionTabs} activeTab={activeTab} onRegionTabChange={onRegionTabChange} />
      );
    },
    unmount(){
      mainRoot.unmount();
      regionRoot.unmount();
    },
  };
}

export function mountLightningCupMatchInfoPopover({
  mountEl,
  getMatchInfo,
  ensureRankedDataLoaded,
  onSelectWinner,
  popoverId,
}){
  const root = createRoot(mountEl);

  root.render(
    <MatchInfoPopover
      getMatchInfo={getMatchInfo}
      ensureRankedDataLoaded={ensureRankedDataLoaded}
      onSelectWinner={onSelectWinner}
      popoverId={popoverId}
    />
  );

  return {
    unmount(){
      root.unmount();
    },
  };
}
