import React from "react";
import { createRoot } from "react-dom/client";
import * as Tabs from "@radix-ui/react-tabs";

function LeagueTabs({ tabs, initialTab, onTabChange }){
  const [activeTab, setActiveTab] = React.useState(initialTab || tabs[0]?.value || "");

  const handleValueChange = (value) => {
    setActiveTab(value);
    onTabChange?.(value);
  };

  return (
    <Tabs.Root className="home-league-tabs-root" value={activeTab} onValueChange={handleValueChange}>
      <Tabs.List className="home-league-tabs-list" aria-label="League sections">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            className="home-league-tabs-trigger"
            id={tab.id}
            value={tab.value}
            aria-controls={tab.controls}
          >
            <span className="home-league-tabs-trigger-label">{tab.label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function mountHomeLeagueTabs(target, options = {}){
  if(!target) return null;

  const root = createRoot(target);
  root.render(
    <LeagueTabs
      tabs={Array.isArray(options.tabs) ? options.tabs : []}
      initialTab={options.initialTab}
      onTabChange={options.onTabChange}
    />
  );

  return {
    unmount(){
      root.unmount();
    },
  };
}
