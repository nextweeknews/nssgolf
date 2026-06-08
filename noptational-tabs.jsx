import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as Tabs from "@radix-ui/react-tabs";

function FormatTable(){
  const levels = [
    { level: "Level 1", course: "Classic", holes: "9 holes", rounds: "2 rounds", scoreMinimum: "-12" },
    { level: "Level 2", course: "Resort", holes: "9 holes", rounds: "2 rounds", scoreMinimum: "-10" },
    { level: "Level 3", course: "Bonus", holes: "3 holes", rounds: "3 rounds", scoreMinimum: "-3" },
    { level: "Level 4", course: "18 Hole", holes: "18 holes", rounds: "2 rounds", scoreMinimum: "-22" },
  ];

  return (
    <div className="format-table-wrap">
      <table className="format-table">
        <thead>
          <tr>
            <th>Level</th>
            <th>Course</th>
            <th>Length</th>
            <th>Rounds</th>
            <th>Score Minimum</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level) => (
            <tr key={level.level}>
              <td>{level.level}</td>
              <td>{level.course}</td>
              <td>{level.holes}</td>
              <td>{level.rounds}</td>
              <td><span className="format-pill">{level.scoreMinimum}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormatPanel(){
  return (
    <div className="format-content">
      <section className="format-hero">
        <h2 className="format-title">All 21 Holes Count</h2>
        <p className="format-copy">
          This tournament will have all 21 holes played across multiple levels, with a minimum score cutoff. Do not give up early in any round, because your score from every level counts toward your final score total.
        </p>
        <div className="format-callout">Champion title: TopNotchOne</div>
      </section>

      <section className="format-section">
        <h3 className="format-section-title">Layout</h3>
        <p className="format-copy">
          Four different levels are played. Each level has a required score minimum, meaning players can be eliminated for not shooting that level's score minimum in at least one played round.
        </p>
        <FormatTable />
      </section>

      <section className="format-section">
        <h3 className="format-section-title">Flights</h3>
        <div className="format-rule-grid">
          <div className="format-rule-card">
            <div className="format-rule-label">Scheduling</div>
            <p className="format-rule-text">Rounds will be available through pre-scheduled flights, similar to The Shotgun Pro League.</p>
          </div>
          <div className="format-rule-card">
            <div className="format-rule-label">Availability</div>
            <p className="format-rule-text">Flights will be available on weekends with a variety of sign-up times.</p>
          </div>
          <div className="format-rule-card">
            <div className="format-rule-label">Exceptions</div>
            <p className="format-rule-text">Extenuating circumstances can be scheduled with Noptotch1s and/or an Admin.</p>
          </div>
          <div className="format-rule-card">
            <div className="format-rule-label">Flight Format</div>
            <p className="format-rule-text">Flights play two rounds back to back, but players may play both rounds together or split games between flights.</p>
          </div>
          <div className="format-rule-card">
            <div className="format-rule-label">Required Scoring</div>
            <p className="format-rule-text">Even after meeting or exceeding the score minimum in the first round, two rounds are required for proper scoring.</p>
          </div>
        </div>
      </section>

      <section className="format-section">
        <h3 className="format-section-title">Rules</h3>
        <div className="format-rule-grid">
          <div className="format-rule-card">
            <div className="format-rule-label">Completion</div>
            <p className="format-rule-text">Players must complete both rounds per level. Screenshots must be submitted no later than the Tuesday after the previous flights conclude.</p>
          </div>
          <div className="format-rule-card">
            <div className="format-rule-label">Authentication</div>
            <p className="format-rule-text">Final-score screenshots are required in the Level 1, 2, 3, or 4 submissions thread. Make sure multiple players, if not the whole lobby, are screenshotting or streaming each round.</p>
          </div>
          <div className="format-rule-card">
            <div className="format-rule-label">Disconnects</div>
            <p className="format-rule-text">In case of a DC, replay the appropriate level and combine scores from the DC round and the new round from the point of disconnection. Screenshots from before and after the DC round and the new round are required.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function NoptationalTabs(){
  return (
    <Tabs.Root className="nopt-tabs-root" defaultValue="leaderboard">
      <Tabs.List className="nopt-tabs-list" aria-label="Noptational sections">
        <Tabs.Trigger className="nopt-tabs-trigger" value="leaderboard">Leaderboard</Tabs.Trigger>
        <Tabs.Trigger className="nopt-tabs-trigger" value="format">Format</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content className="nopt-tabs-content" value="leaderboard" forceMount>
        <div id="leaderboardShell" className="leaderboard-shell">
          <div className="empty-state">
            <p className="status">Loading leaderboard...</p>
          </div>
        </div>
      </Tabs.Content>
      <Tabs.Content className="nopt-tabs-content" value="format" forceMount>
        <FormatPanel />
      </Tabs.Content>
    </Tabs.Root>
  );
}

export function mountNoptationalTabs(mountEl){
  if(!mountEl) return null;
  const root = createRoot(mountEl);
  flushSync(() => {
    root.render(<NoptationalTabs />);
  });
  return {
    unmount(){
      root.unmount();
    },
  };
}
