import React from "react";
import { createRoot } from "react-dom/client";
import * as Tabs from "@radix-ui/react-tabs";

function SuperLeagueTabs({ tabs, activeTab, onTabChange }){
  return (
    <Tabs.Root className="superleague-tabs-root" value={activeTab} onValueChange={onTabChange}>
      <Tabs.List className="superleague-tabs-list" aria-label="Super League sections">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            className="superleague-tabs-trigger"
            id={tab.id}
            value={tab.value}
            aria-controls={tab.controls}
          >
            <span className="superleague-tabs-trigger-label">{tab.label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function mountSuperLeagueTabs(target, options = {}){
  if(!target) return null;

  const root = createRoot(target);
  const tabs = Array.isArray(options.tabs) ? options.tabs : [];

  return {
    render(activeTab){
      root.render(
        <SuperLeagueTabs
          tabs={tabs}
          activeTab={activeTab || tabs[0]?.value || ""}
          onTabChange={options.onTabChange}
        />
      );
    },
    unmount(){
      root.unmount();
    },
  };
}
