import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../superleague/index.html", import.meta.url);

test("playoff connector stays hidden until its matchup anchors are positioned", async () => {
  const source = await readFile(pagePath, "utf8");
  const layoutStart = source.indexOf("function updatePlayoffBracketLayout()");
  const layoutEnd = source.indexOf("function renderScheduleWeek()", layoutStart);
  const layoutSource = source.slice(layoutStart, layoutEnd);

  assert.match(source, /\.playoff-connector\{[\s\S]*?visibility:hidden;/);
  assert.match(source, /\.playoff-connector\.is-positioned\{ visibility:visible; \}/);
  assert.ok(layoutSource.indexOf('classList.remove("is-positioned")') < layoutSource.indexOf("getBoundingClientRect()"));
  assert.ok(layoutSource.indexOf('classList.add("is-positioned")') > layoutSource.indexOf('setProperty("--champ-center"'));
});

test("Season 7 standings highlights match the 10-player movement rules", async () => {
  const source = await readFile(pagePath, "utf8");
  const rowsMatch = source.match(/const FORMAT_MOVEMENT_ROWS_S7 = (\[[\s\S]*?\n    \]);/);
  const functionStart = source.indexOf("function getDivisionRankHighlight(");
  const functionEnd = source.indexOf("function applyRowHighlights(", functionStart);

  assert.ok(rowsMatch);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const movementRows = Function(`"use strict"; return (${rowsMatch[1]});`)();
  const getHighlight = Function(
    "FORMAT_MOVEMENT_ROWS_S7",
    "FORMAT_MOVEMENT_ROWS_S6",
    "getActiveSeasonNumber",
    `${source.slice(functionStart, functionEnd)}; return getDivisionRankHighlight;`,
  )(movementRows, [], () => 7);

  assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => getHighlight("Division 1", index + 1)),
    ["row-highlight-gold", "row-highlight-gold", "row-highlight-gold", "row-highlight-gold", "", "", "", "row-highlight-orange", "row-highlight-red", "row-highlight-red"],
  );
  assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => getHighlight("Division 2", index + 1)),
    ["row-highlight-green", "row-highlight-green", "row-highlight-blue", "", "", "", "", "row-highlight-orange", "row-highlight-red", "row-highlight-red"],
  );
  assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => getHighlight("Division 3", index + 1)),
    ["row-highlight-green", "row-highlight-green", "row-highlight-blue", "", "", "", "row-highlight-red", "row-highlight-red", "row-highlight-red", "row-highlight-red"],
  );
});
