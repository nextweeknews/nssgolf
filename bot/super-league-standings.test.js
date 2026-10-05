"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");

const {
  LEADERBOARD_FILENAMES,
  applyRowHighlights,
  buildDivisionImages,
  buildHeadToHeadByDivision,
  buildLeaderboardImages,
  buildMessagePayload,
  findSuperLeagueDisplayMessageInPages,
  isSuperLeagueDisplayMessage,
  mapRows,
  rankDivisionRows,
  renderTextLayer,
  seasonLayout,
  topTenRows,
} = require("./super-league-standings");

const divisionValues = [
  ["Aidan", "7", "2", "14", "5", "9"],
  ["Balt", "7", "2", "13", "6", "7"],
  ["Ciberian", "6", "3", "13", "7", "6"],
  ["Dan", "5", "4", "11", "9", "2"],
  ["Eli", "4", "5", "10", "10", "0"],
  ["Fran", "4", "5", "9", "11", "-2"],
  ["Gus", "3", "6", "8", "12", "-4"],
  ["Hana", "2", "7", "6", "14", "-8"],
  ["Ian", "1", "8", "4", "16", "-12"],
  ["Jonas", "0", "9", "2", "18", "-16"],
];

function completedScheduleRow(division, winner, loser) {
  const row = Array(20).fill("");
  row[1] = division;
  row[3] = winner;
  row[10] = "W";
  row[12] = loser;
  row[19] = "L";
  return row;
}

test("uses the website's current three-division Season 7 layout", () => {
  assert.deepEqual(seasonLayout(7), {
    divisions: [
      { title: "Division 1", range: "B3:G12" },
      { title: "Division 2", range: "B14:G23" },
      { title: "Division 3", range: "B25:G34" },
    ],
    scheduleRange: "I2:AB136",
  });
});

test("matches website ranking, score formatting, and head-to-head ordering", () => {
  const headToHead = buildHeadToHeadByDivision([
    completedScheduleRow("Division 1", "Balt", "Aidan"),
  ]);
  const rows = rankDivisionRows(mapRows(divisionValues), "Division 1", headToHead, 7);

  assert.deepEqual(rows.slice(0, 2).map((row) => row.player), ["Balt", "Aidan"]);
  assert.deepEqual(rows.slice(0, 2).map((row) => row.rank), ["1", "2"]);
  assert.equal(rows[0].matches, "7-2");
  assert.equal(rows[0].games, "13-6");
  assert.equal(rows[0].diffText, "+7");
});

test("preserves everyone tied at the top-10 cutoff", () => {
  assert.deepEqual(
    topTenRows([
      { rank: "9", player: "Ciberian" },
      { rank: "T10", player: "Ap13" },
      { rank: "T10", player: "Anderson" },
      { rank: "12", player: "Tim/TJS" },
    ]).map((row) => row.player),
    ["Ciberian", "Ap13", "Anderson"]
  );
});

test("matches the website's Season 7 movement colors", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ rank: String(index + 1) }));
  assert.deepEqual(
    applyRowHighlights(structuredClone(rows), "Division 1", 7).map((row) => row.highlightClass),
    ["row-highlight-gold", "row-highlight-gold", "row-highlight-gold", "row-highlight-gold", "", "", "", "row-highlight-orange", "row-highlight-red", "row-highlight-red"]
  );
  assert.deepEqual(
    applyRowHighlights(structuredClone(rows), "Division 3", 7).map((row) => row.highlightClass),
    ["row-highlight-green", "row-highlight-green", "row-highlight-blue", "", "", "", "row-highlight-red", "row-highlight-red", "row-highlight-red", "row-highlight-red"]
  );
});

test("renders bundled Inter without missing-glyph boxes or undersized Linux text", async () => {
  const layer = (text) => renderTextLayer({
    text,
    x: 0,
    y: 0,
    size: 30,
    weight: 850,
    color: "#fff5ff",
    anchor: "left",
    letterSpacing: 0,
  });
  const [narrow, wide] = await Promise.all([layer("IIII"), layer("WWWW")]);
  const [narrowMetadata, wideMetadata] = await Promise.all([
    sharp(narrow.input).metadata(),
    sharp(wide.input).metadata(),
  ]);

  assert.ok(narrowMetadata.height >= 40);
  assert.ok(wideMetadata.width > narrowMetadata.width * 2);
});

test("identifies only the persistent bot-authored Super League display", () => {
  const message = {
    author: { id: "bot-1" },
    webhookId: null,
    attachments: new Map(LEADERBOARD_FILENAMES.map((name, index) => [index, { name }])),
  };

  assert.equal(isSuperLeagueDisplayMessage(message, "bot-1"), true);
  assert.equal(isSuperLeagueDisplayMessage({ ...message, webhookId: "interaction" }, "bot-1"), false);
  assert.equal(isSuperLeagueDisplayMessage({ ...message, author: { id: "bot-2" } }, "bot-1"), false);
  assert.equal(
    isSuperLeagueDisplayMessage({ ...message, attachments: new Map([[0, { name: "division-1.png" }]]) }, "bot-1"),
    false
  );
});

test("finds a persistent Super League display beyond the newest 100 messages", async () => {
  const newerMessages = new Map(
    Array.from({ length: 100 }, (_, index) => [`new-${index}`, { id: `new-${index}` }])
  );
  const display = {
    id: "display",
    author: { id: "bot-1" },
    webhookId: null,
    attachments: new Map(LEADERBOARD_FILENAMES.map((name, index) => [index, { name }])),
  };
  const pages = [newerMessages, new Map([[display.id, display]])];
  const beforeValues = [];

  const result = await findSuperLeagueDisplayMessageInPages((before) => {
    beforeValues.push(before);
    return pages.shift();
  }, "bot-1");

  assert.equal(result, display);
  assert.deepEqual(beforeValues, [undefined, "new-99"]);
});

test("renders five separate transparent Discord images and ordered components", async () => {
  const rows = applyRowHighlights(
    rankDivisionRows(mapRows(divisionValues), "Division 1", new Map(), 7),
    "Division 1",
    7
  );
  const divisions = [1, 2, 3].map((division) => ({
    title: `Division ${division}`,
    rows: rows.map((row) => ({ ...row })),
  }));
  const divisionImages = await buildDivisionImages(divisions);
  const divisionMetadata = await Promise.all(divisionImages.map((image) => sharp(image).metadata()));

  assert.equal(divisionImages.length, 3);
  assert.deepEqual(divisionMetadata.map(({ format, width, height, hasAlpha }) => ({ format, width, height, hasAlpha })), [
    { format: "png", width: 3200, height: 1940, hasAlpha: true },
    { format: "png", width: 3200, height: 1940, hasAlpha: true },
    { format: "png", width: 3200, height: 1940, hasAlpha: true },
  ]);
  for (const image of divisionImages) {
    const titleStats = await sharp(image)
      .extract({ left: 96, top: 20, width: 700, height: 120 })
      .stats();
    assert.ok(titleStats.channels[3].mean > 5);
    for (let rowIndex = 0; rowIndex < 10; rowIndex += 1) {
      const rowCenter = (150 + rowIndex * 78 + 35) * 2;
      const rowPixel = await sharp(image)
        .extract({ left: 100, top: rowCenter, width: 1, height: 1 })
        .raw()
        .toBuffer();
      assert.equal(rowPixel[3], 255);
      const rightRowPixel = await sharp(image)
        .extract({ left: 3100, top: rowCenter, width: 1, height: 1 })
        .raw()
        .toBuffer();
      assert.equal(rightRowPixel[3], 255);
      const rankTextStats = await sharp(image)
        .extract({ left: 160, top: rowCenter - 30, width: 100, height: 60 })
        .stats();
      assert.ok(rankTextStats.channels[0].stdev > 10);
    }
  }

  const images = await buildLeaderboardImages(divisions, 7);
  const metadata = await Promise.all(images.map((image) => sharp(image).metadata()));
  assert.equal(images.length, 5);
  assert.deepEqual(LEADERBOARD_FILENAMES, [
    "super-league-header.png",
    "division-1.png",
    "division-2.png",
    "division-3.png",
    "super-league-legend.png",
  ]);
  assert.deepEqual(metadata.map(({ format, width, height, hasAlpha }) => ({ format, width, height, hasAlpha })), [
    { format: "png", width: 2400, height: 840, hasAlpha: true },
    { format: "png", width: 3200, height: 1940, hasAlpha: true },
    { format: "png", width: 3200, height: 1940, hasAlpha: true },
    { format: "png", width: 3200, height: 1940, hasAlpha: true },
    { format: "png", width: 2400, height: 704, hasAlpha: true },
  ]);
  for (const image of images) {
    const stats = await sharp(image).stats();
    assert.equal(stats.channels[3].min, 0);
    assert.equal(stats.channels[3].max, 255);
    const corner = await sharp(image)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    assert.equal(corner[3], 0);
  }

  const payload = buildMessagePayload(7, new Date("2026-10-05T00:00:00Z"));
  const components = payload.components[0].components;
  assert.equal(payload.flags, 32768);
  assert.equal(payload.components[0].accent_color, 0xba61df);
  assert.deepEqual(
    components.slice(0, 5).map((component) => component.items[0].media.url),
    LEADERBOARD_FILENAMES.map((filename) => `attachment://${filename}`)
  );
  assert.equal(components[5].components[0].url, "https://nssgolf.com/superleague");
  assert.equal(components[6].content, "Updated <t:1791158400:R>");
});
