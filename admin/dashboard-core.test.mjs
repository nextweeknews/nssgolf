import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { ADMIN_SECTIONS, RESULT_EVENTS, adminUrl, parseAdminRoute, routeFromEmbeddedPage, tournamentPublicUrl } from "./dashboard-core.mjs";
import { actionLogCellCount, actionLogChangeRows, actionLogTimestamp, addUndoChangeContext } from "./action-logs-core.mjs";
import { normalizeSeasonConfiguration, seasonConfigurationRpcParams } from "../season-configuration-core.mjs";

test("matches the sidebar event order and colors", () => {
  assert.deepEqual(
    RESULT_EVENTS.map(({ key, label, color }) => ({ key, label, color })),
    [
      { key:"proleague", label:"Shotgun Pro League", color:"#7dd3fc" },
      { key:"superleague", label:"Super League", color:"#d176ff" },
      { key:"worldopen", label:"World Open", color:"#5dff9c" },
      { key:"lightningcup", label:"Lightning Cup", color:"#f6ff6a" },
      { key:"noptational", label:"The Noptational", color:"#818cf8" },
      { key:"championship", label:"World Championship", color:"#bef264" },
      { key:"masters", label:"World Golf Masters", color:"#facc15" },
      { key:"worldcup", label:"World Cup", color:"#60a5fa" },
    ],
  );
});

test("defaults the dashboard to its landing page", () => {
  assert.deepEqual(parseAdminRoute(""), {
    section:"home",
    eventKey:"",
    groupLabel:"Admin",
    label:"Overview",
    frameUrl:"/admin/landing.html",
    canonicalUrl:"/admin/",
  });
});

test("maps every standalone admin surface into the dashboard frame", () => {
  assert.deepEqual(ADMIN_SECTIONS.map(({ key }) => key), [
    "season-configuration",
    "event-signups",
    "build-list",
    "championship-points",
    "custom-player-urls",
    "action-logs",
  ]);
  assert.equal(parseAdminRoute("?section=season-configuration").frameUrl, "/admin/season-configuration.html?embed=1&v=20260818-season-configuration");
  assert.equal(parseAdminRoute("?section=event-signups&event=summer").frameUrl, "/event-signups.html?event=summer&embed=1&v=20260818-season-configuration");
  assert.equal(parseAdminRoute("?section=build-list").frameUrl, "/build.html?embed=1&v=20260818-season-configuration");
  assert.equal(parseAdminRoute("?section=championship-points").frameUrl, "/championship.html?view=settings&embed=1&v=20260818-season-configuration");
  assert.equal(parseAdminRoute("?section=custom-player-urls").frameUrl, "/admin-settings.html?embed=1&v=20260818-season-configuration");
  assert.equal(
    parseAdminRoute("?section=action-logs").frameUrl,
    "/admin/action-logs.html?embed=1&v=20260818-season-configuration",
  );
});

test("normalizes public season configuration rows for existing config consumers", () => {
  const configuration = normalizeSeasonConfiguration({
    ranked_league_season:14,
    shotgun_pro_league_season:8,
    shotgun_pro_league_stage:2,
    super_league_season:7,
  });
  assert.deepEqual(configuration, {
    rankedLeagueSeason:14,
    shotgunProLeagueSeason:8,
    shotgunProLeagueStage:2,
    superLeagueSeason:7,
  });
  const expectedConfiguration = normalizeSeasonConfiguration();
  assert.deepEqual(seasonConfigurationRpcParams(configuration, expectedConfiguration), {
    p_ranked_league_season:14,
    p_shotgun_pro_league_season:8,
    p_shotgun_pro_league_stage:2,
    p_super_league_season:7,
    p_expected_configuration:expectedConfiguration,
  });
  assert.deepEqual(normalizeSeasonConfiguration({ rankedLeagueSeason:6, shotgunProLeagueStage:8 }), {
    rankedLeagueSeason:13,
    shotgunProLeagueSeason:7,
    shotgunProLeagueStage:3,
    superLeagueSeason:6,
  });
});

test("uses the public configuration row while preserving config.js exports", async () => {
  const source = await readFile(new URL("../config.js", import.meta.url), "utf8");
  assert.match(source, /\/rest\/v1\/season_configuration/);
  assert.match(source, /cache:"no-store"/);
  assert.match(source, /NSSGOLF_SUPABASE_CONFIG/);
  assert.match(source, /export const CURRENT_RANKED_LEAGUE_SEASON/);
  assert.match(source, /export const SHOTGUN_PRO_LEAGUE_DEFAULT_SEASON/);
  assert.match(source, /export const SHOTGUN_PRO_LEAGUE_DEFAULT_STAGE/);
  assert.match(source, /export const SUPER_LEAGUE_SEASON/);
});

test("renders the season editor in the requested order and saves only through its RPC", async () => {
  const [page, script] = await Promise.all([
    readFile(new URL("./season-configuration.html", import.meta.url), "utf8"),
    readFile(new URL("./season-configuration.js", import.meta.url), "utf8"),
  ]);
  assert.ok(page.indexOf("Ranked League") < page.indexOf("Shotgun Pro League"));
  assert.ok(page.indexOf("Shotgun Pro League") < page.indexOf("Super League"));
  assert.match(script, /\.rpc\(\s*"update_season_configuration"/);
  assert.match(script, /if\(!embedded\)\{[\s\S]*?getSession\(\)/);
  assert.match(script, /seasonConfigurationRpcParams\(configuration, initialConfiguration\)/);
  assert.doesNotMatch(script, /\.from\("season_configuration"\)[\s\S]{0,200}?\.update\(/);
});

test("loads embedded Championship Points without painting the public Championship view", async () => {
  const [page, embedScript] = await Promise.all([
    readFile(new URL("../championship.html", import.meta.url), "utf8"),
    readFile(new URL("./dashboard-embed.js", import.meta.url), "utf8"),
  ]);

  assert.match(embedScript, /pathname === "\/championship\.html" && params\.get\("view"\) === "settings"/);
  assert.match(page, /html\.admin-settings-embedded \.card\{ display:none; \}/);
  assert.match(page, /if\(isEmbeddedSettingsView\)\{[\s\S]*?loadChampionshipSettings\(\),[\s\S]*?refreshAdminState\(\),[\s\S]*?if\(state\.isAdmin\) return;/);
});

test("anchors the entire mobile admin shell to visual-viewport keyboard shifts", async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL("./dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("./dashboard.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /visualViewport\?\.addEventListener\("resize", syncAdminViewportAnchor/);
  assert.match(script, /--admin-visual-offset-left/);
  assert.match(script, /--admin-visual-offset-top/);
  assert.match(script, /--admin-visual-width/);
  assert.match(script, /--admin-visual-height/);
  assert.match(script, /setTimeout\(applyAdminViewportAnchor, 400\)/);
  assert.match(styles, /\.admin-shell\{[\s\S]*?width:var\(--admin-visual-width,100%\);[\s\S]*?height:var\(--admin-visual-height,100dvh\);[\s\S]*?transform:translate\(var\(--admin-visual-offset-left,0px\),var\(--admin-visual-offset-top,0px\)\);/);
});

test("preserves result editor and signup subview state in the dashboard URL", () => {
  assert.equal(
    parseAdminRoute("?section=results-editor&eventKey=proleague&season=7&stage=3").frameUrl,
    "/admin/tournament-results.html?eventKey=proleague&season=7&stage=3&embed=1&v=20260818-season-configuration",
  );
  assert.equal(
    routeFromEmbeddedPage("/admin/tournament-results.html", "?eventKey=proleague&season=7&stage=3&embed=1"),
    "/admin/?section=results-editor&eventKey=proleague&season=7&stage=3",
  );
  assert.equal(tournamentPublicUrl("worldopen", new URLSearchParams("view=round-5")), "/worldopen/index.html?round=5");
  assert.equal(
    tournamentPublicUrl("lightningcup", new URLSearchParams("view=wuhu-island")),
    "/lightningcup/index.html?view=results&region=wuhu-island",
  );
  assert.equal(
    routeFromEmbeddedPage("/event-signups.html", "?event=summer&embed=1"),
    "/admin/?section=event-signups&event=summer",
  );
  assert.equal(adminUrl("action-logs"), "/admin/?section=action-logs");
});

test("maps result editors to their matching public pages and Google Sheets", () => {
  assert.equal(tournamentPublicUrl("masters", new URLSearchParams("view=qualifiers")), "/masters.html?view=qualifiers");
  assert.equal(tournamentPublicUrl("championship"), "/championship.html");
  assert.equal(
    tournamentPublicUrl("worldcup", new URLSearchParams("year=2024&view=group-stage")),
    "/worldcup.html?year=2024&tab=group",
  );
  assert.equal(
    tournamentPublicUrl("proleague", new URLSearchParams("season=7&stage=3")),
    "/proleague/index.html?season=7&stage=3",
  );
  assert.equal(
    tournamentPublicUrl("superleague", new URLSearchParams("season=6&view=qualifier-winners")),
    "/superleague/index.html?season=6&page=qualifiers",
  );
  assert.equal(
    parseAdminRoute("?section=results-editor&eventKey=masters").sheetUrl,
    "https://docs.google.com/spreadsheets/d/16r1G1StlWQflPjAqFbHip_Y3hRo85F6iS3jYyK25CwE/edit",
  );
});

test("formats action-log rows without exposing raw range payloads", () => {
  const change = {
    range:"'Bracket'!D4:E4",
    playerName:"Aidan",
    headers:["R1", "R2"],
    before:[[3, ""]],
    after:[[1, -2]],
  };
  assert.equal(actionLogTimestamp("2026-08-17T12:00:00Z", "en-US").includes("August 17, 2026"), true);
  assert.equal(actionLogCellCount({ changes:[change] }), 2);
  assert.deepEqual(actionLogChangeRows(change), [
    { playerName:"Aidan", header:"R1", before:"3", after:"1", beforeBlank:false, afterBlank:false },
    { playerName:"Aidan", header:"R2", before:"blank", after:"-2", beforeBlank:true, afterBlank:false },
  ]);
});

test("carries player and header context into displayed undo changes", () => {
  const logs = addUndoChangeContext([
    {
      action_id:"undo",
      action_type:"undo",
      target_action_id:"edit",
      changes:[{ range:"'Bracket'!D4", before:[[1]], after:[[3]] }],
    },
    {
      action_id:"edit",
      action_type:"edit",
      changes:[{ range:"'Bracket'!D4", playerName:"Aidan", headers:["R1"], before:[[3]], after:[[1]] }],
    },
  ]);
  assert.equal(logs[0].changes[0].playerName, "Aidan");
  assert.deepEqual(logs[0].changes[0].headers, ["R1"]);
  assert.deepEqual(logs[0].changes[0].before, [[1]]);
});
