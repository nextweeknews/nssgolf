import test from "node:test";
import assert from "node:assert/strict";

import { adminUrl, parseAdminRoute, routeFromEmbeddedPage } from "./dashboard-core.mjs";

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
  assert.equal(parseAdminRoute("?section=action-logs").frameUrl, "/admin/action-logs.html?embed=1");
});

test("preserves result editor and signup subview state in the dashboard URL", () => {
  assert.equal(
    routeFromEmbeddedPage("/admin/tournament-results.html", "?eventKey=proleague&season=7&stage=3&embed=1"),
    "/admin/?section=results-editor&eventKey=proleague&season=7&stage=3",
  );
  assert.equal(
    routeFromEmbeddedPage("/event-signups.html", "?event=summer&embed=1"),
    "/admin/?section=event-signups&event=summer",
  );
  assert.equal(adminUrl("action-logs"), "/admin/?section=action-logs");
});
