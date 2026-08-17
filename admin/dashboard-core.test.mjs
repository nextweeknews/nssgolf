import test from "node:test";
import assert from "node:assert/strict";

import { RESULT_EVENTS, adminUrl, parseAdminRoute, routeFromEmbeddedPage, tournamentPublicUrl } from "./dashboard-core.mjs";

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
  assert.equal(parseAdminRoute("?section=event-signups&event=summer").frameUrl, "/event-signups.html?event=summer&embed=1");
  assert.equal(parseAdminRoute("?section=build-list").frameUrl, "/build.html?embed=1");
  assert.equal(parseAdminRoute("?section=championship-points").frameUrl, "/championship.html?view=settings&embed=1");
  assert.equal(parseAdminRoute("?section=custom-player-urls").frameUrl, "/admin-settings.html?embed=1");
  assert.equal(
    parseAdminRoute("?section=action-logs").frameUrl,
    "/admin/action-logs.html?embed=1&v=20260817-no-description",
  );
});

test("preserves result editor and signup subview state in the dashboard URL", () => {
  assert.equal(
    parseAdminRoute("?section=results-editor&eventKey=proleague&season=7&stage=3").frameUrl,
    "/admin/tournament-results.html?eventKey=proleague&season=7&stage=3&embed=1&v=20260817-player-order",
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
