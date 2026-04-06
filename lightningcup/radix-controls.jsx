import React from "react";
import { createRoot } from "react-dom/client";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import * as Tabs from "@radix-ui/react-tabs";

function MainNavigation({ loggedIn, mainTab, year, onMainTabChange }){
  const parentValue = mainTab === "Actual Bracket" ? "results" : "game";

  return (
    <NavigationMenu.Root
      className="lc-nav-root"
      value={parentValue}
      onValueChange={(value) => {
        if(value === "results"){
          onMainTabChange("Actual Bracket");
          return;
        }
        if(value === "game" && !loggedIn){
          onMainTabChange("Actual Bracket");
        }
      }}
      delayDuration={120}
      skipDelayDuration={80}
    >
      <NavigationMenu.List className="lc-nav-list">
        <NavigationMenu.Item value="results" className="lc-nav-item">
          <NavigationMenu.Trigger className="lc-nav-trigger">
            Lightning Cup Tournament Results
          </NavigationMenu.Trigger>
          <NavigationMenu.Content className="lc-nav-content">
            <button
              className={`lc-nav-subitem ${mainTab === "Actual Bracket" ? "is-active" : ""}`}
              type="button"
              onClick={() => onMainTabChange("Actual Bracket")}
            >
              {year}
            </button>
          </NavigationMenu.Content>
        </NavigationMenu.Item>

        <NavigationMenu.Item value="game" className="lc-nav-item">
          <NavigationMenu.Trigger className="lc-nav-trigger">
            Lightning Cup Bracket Game
          </NavigationMenu.Trigger>
          <NavigationMenu.Content className="lc-nav-content">
            {loggedIn ? (
              <>
                <button
                  className={`lc-nav-subitem ${mainTab === "Your Bracket" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => onMainTabChange("Your Bracket")}
                >
                  Your Bracket
                </button>
                <button
                  className={`lc-nav-subitem ${mainTab === "Leaderboard" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => onMainTabChange("Leaderboard")}
                >
                  Leaderboard
                </button>
              </>
            ) : (
              <span className="lc-nav-subtext">Sign in to access bracket game views.</span>
            )}
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
