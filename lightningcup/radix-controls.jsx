import React from "react";
import { createRoot } from "react-dom/client";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import * as Tabs from "@radix-ui/react-tabs";

const MAIN_TAB_BY_PARENT = {
  results: "Actual Bracket",
  game: "Your Bracket",
};

function getParentValueFromMainTab(mainTab){
  return mainTab === "Actual Bracket" ? "results" : "game";
}

function MainNavigation({ loggedIn, mainTab, year, onMainTabChange }){
  const parentValue = getParentValueFromMainTab(mainTab);

  const handleParentValueChange = (value) => {
    if(value === "results"){
      onMainTabChange("Actual Bracket");
      return;
    }
    if(value === "game"){
      if(!loggedIn){
        onMainTabChange("Actual Bracket");
        return;
      }
      const nextMainTab = MAIN_TAB_BY_PARENT[value] || "Your Bracket";
      if(mainTab !== "Your Bracket" && mainTab !== "Leaderboard"){
        onMainTabChange(nextMainTab);
      }
    }
  };

  const handleChildLinkSelect = (event, targetMainTab) => {
    event.preventDefault();
    if(targetMainTab !== "Actual Bracket" && !loggedIn) return;
    onMainTabChange(targetMainTab);
  };

  return (
    <NavigationMenu.Root
      className="lc-nav-root"
      value={parentValue}
      onValueChange={handleParentValueChange}
      delayDuration={120}
      skipDelayDuration={80}
    >
      <NavigationMenu.List className="lc-nav-list">
        <NavigationMenu.Item value="results" className="lc-nav-item">
          <NavigationMenu.Trigger className="lc-nav-trigger">
            Lightning Cup Tournament Results
          </NavigationMenu.Trigger>
          <NavigationMenu.Content className="lc-nav-content">
            <ul className="lc-nav-sublist">
              <li>
                <NavigationMenu.Link
                  className="lc-nav-sublink"
                  active={mainTab === "Actual Bracket"}
                  href="#"
                  onClick={(event) => handleChildLinkSelect(event, "Actual Bracket")}
                >
                  {year}
                </NavigationMenu.Link>
              </li>
            </ul>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item value="game" className="lc-nav-item">
          <NavigationMenu.Trigger className="lc-nav-trigger">
            Lightning Cup Bracket Game
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
                  onClick={(event) => handleChildLinkSelect(event, "Your Bracket")}
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
                  onClick={(event) => handleChildLinkSelect(event, "Leaderboard")}
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

        <NavigationMenu.Indicator className="lc-nav-indicator">
          <div className="lc-nav-indicator-line" />
        </NavigationMenu.Indicator>
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
