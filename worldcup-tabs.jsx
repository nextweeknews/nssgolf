import React from "react";
import { createRoot } from "react-dom/client";
import * as Tabs from "@radix-ui/react-tabs";

function WorldCupTabs({ tabs, activeTab, onTabChange }){
  return (
    <Tabs.Root className="worldcup-tabs-root" value={activeTab} onValueChange={onTabChange}>
      <Tabs.List className="worldcup-tabs-list" aria-label="World Cup sections">
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            className="worldcup-tabs-trigger"
            value={tab.value}
            id={tab.id}
            aria-controls={tab.controls}
          >
            <span className="worldcup-tabs-trigger-label">{tab.label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

export function mountWorldCupTabs(target, options = {}){
  if(!target) return null;
  const root = createRoot(target);
  const tabs = Array.isArray(options.tabs) ? options.tabs : [];

  return {
    render(activeTab){
      root.render(
        <WorldCupTabs
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
