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
