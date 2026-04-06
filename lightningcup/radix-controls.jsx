import React from "react";
import { createRoot } from "react-dom/client";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import * as Tabs from "@radix-ui/react-tabs";
import * as Popover from "@radix-ui/react-popover";

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

function PlayerComparisonColumn({ side, player }){
  const playerName = player?.name || "TBD";
  const seedLabel = player?.seedLabel || "-";
  const discordLabel = player?.discordLabel || "No Discord ID";
  const seasonRows = Array.isArray(player?.seasons) ? player.seasons : [];

  return (
    <section className={`lc-match-popover-player lc-match-popover-player-${side}`}>
      <div className="lc-match-popover-row lc-match-popover-player-head" title={playerName}>
        <span className="lc-match-popover-player-seed">{seedLabel}</span>
        <span className="lc-match-popover-player-name">{playerName}</span>
      </div>
      <div className="lc-match-popover-row lc-match-popover-player-discord" title={discordLabel}>{discordLabel}</div>
      <div className="lc-match-popover-row lc-match-popover-section-head">
        <span>Ranked Performance</span>
      </div>
      {seasonRows.map((row) => (
        <div key={`${side}-season-${row.season}`} className="lc-match-popover-row lc-match-popover-player-stat">{row.value || "Unranked"}</div>
      ))}
    </section>
  );
}

function MatchInfoPopover({ getMatchInfo, ensureRankedDataLoaded }){
  const [open, setOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [, forceRefresh] = React.useReducer((value) => value + 1, 0);

  const info = typeof getMatchInfo === "function" ? getMatchInfo() : null;
  const topPlayer = info?.top || {};
  const bottomPlayer = info?.bottom || {};
  const seasonLabels = Array.isArray(info?.seasons) && info.seasons.length ? info.seasons : [9, 10, 11];

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

  const ariaLabel = info?.matchId
    ? `Match info for ${info.matchId}`
    : "Match info";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="qualifier-match-info lc-match-info-trigger" type="button" aria-label={ariaLabel}>i</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="lc-match-popover-content"
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
        >
          <div className="lc-match-popover-head">
            <span className="lc-match-popover-badge">Match {info?.matchId ?? "-"}</span>
            <span className="lc-match-popover-meta">Round {info?.round || "-"}</span>
            <span className="lc-match-popover-meta">{info?.winnerLabel || "Winner: TBD"}</span>
          </div>

          <div className="lc-match-popover-compare">
            <PlayerComparisonColumn side="left" player={topPlayer} />
            <div className="lc-match-popover-center" aria-hidden="true">
              <div className="lc-match-popover-row lc-match-popover-center-label">Player</div>
              <div className="lc-match-popover-row lc-match-popover-center-label">Discord</div>
              <div className="lc-match-popover-row lc-match-popover-center-label">Stats</div>
              {seasonLabels.map((season) => (
                <div key={`season-label-${season}`} className="lc-match-popover-row lc-match-popover-center-label">Season {season}</div>
              ))}
            </div>
            <PlayerComparisonColumn side="right" player={bottomPlayer} />
          </div>

          {isLoading ? <p className="lc-match-popover-status">Loading ranked history...</p> : null}
          {loadError ? <p className="lc-match-popover-status lc-match-popover-status-error">{loadError}</p> : null}

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
}){
  const root = createRoot(mountEl);

  root.render(
    <MatchInfoPopover
      getMatchInfo={getMatchInfo}
      ensureRankedDataLoaded={ensureRankedDataLoaded}
    />
  );

  return {
    unmount(){
      root.unmount();
    },
  };
}
