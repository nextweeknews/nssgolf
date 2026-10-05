"use strict";

const path = require("node:path");

process.env.FONTCONFIG_FILE ||= path.join(__dirname, "fontconfig.xml");

const sharp = require("sharp");

const INTER_FONT = path.join(__dirname, "fonts", "InterVariable.ttf");
const SUPER_LEAGUE_LOGO = path.join(__dirname, "assets", "super-league-logo.png");
const WORKER_URL = "https://small-mud-2771.nextweekmedia.workers.dev/";
const SHEET_ID = "1BbT8t6erCVdx-Bdshv_hax9r9JSRzU1WygjWxW3vPkY";
const RESULTS_URL = "https://nssgolf.com/superleague";
const COMPONENTS_V2_FLAG = 1 << 15;
const SUPER_LEAGUE_PURPLE = "#ba61df";
const WEBSITE_BACKGROUND = "#020b18";
const WEBSITE_MUTED = "#cbd5e1";
const WEBSITE_BORDER = "#64748b";

const OUTPUT_SCALE = 2;
const CANVAS_WIDTH = 1200;
const DIVISION_CANVAS_WIDTH = 1600;
const TABLE_X = 48;
const TABLE_WIDTH = 1104;
const DIVISION_TABLE_WIDTH = 1504;
const HEADER_Y = 84;
const HEADER_HEIGHT = 52;
const ROWS_Y = 150;
const ROW_HEIGHT = 70;
const ROW_GAP = 8;
const ROW_RADIUS = 14;
const LEADERBOARD_FILENAMES = [
  "super-league-header.png",
  "division-1.png",
  "division-2.png",
  "division-3.png",
  "super-league-legend.png",
];

const DIVISION_COLUMNS = [
  { key: "rank", label: "RANK", width: 130, size: 38, weight: 850 },
  { key: "player", label: "PLAYER", width: 754, size: 38, weight: 850 },
  { key: "matches", label: "W-L", width: 190, size: 36, weight: 800 },
  { key: "games", label: "ROUNDS", width: 230, size: 36, weight: 800 },
  { key: "diffText", label: "DIFF.", width: 200, size: 36, weight: 800 },
];

const DIVISION_COLORS = {
  "Division 1": "#fcd34d",
  "Division 2": "#e5e7eb",
  "Division 3": "#fdba74",
};

const ROW_COLORS = {
  "": "#1d2437",
  "row-highlight-gold": "#554917",
  "row-highlight-green": "#164d2c",
  "row-highlight-blue": "#1c5468",
  "row-highlight-orange": "#5d3c20",
  "row-highlight-red": "#591f2f",
};

const FORMAT_MOVEMENT_ROWS_S6 = [
  ["row-highlight-gold", "row-highlight-green", "row-highlight-green"],
  ["row-highlight-gold", "row-highlight-green", "row-highlight-green"],
  ["row-highlight-gold", "row-highlight-blue", "row-highlight-blue"],
  ["row-highlight-gold", "", ""],
  ["", "", ""],
  ["", "", ""],
  ["row-highlight-orange", "row-highlight-orange", "row-highlight-red"],
  ["row-highlight-red", "row-highlight-red", "row-highlight-red"],
];

const FORMAT_MOVEMENT_ROWS_S7 = [
  ["row-highlight-gold", "row-highlight-green", "row-highlight-green"],
  ["row-highlight-gold", "row-highlight-green", "row-highlight-green"],
  ["row-highlight-gold", "row-highlight-blue", "row-highlight-blue"],
  ["row-highlight-gold", "", ""],
  ["", "", ""],
  ["", "", ""],
  ["", "", "row-highlight-red"],
  ["row-highlight-orange", "row-highlight-orange", "row-highlight-red"],
  ["row-highlight-red", "row-highlight-red", "row-highlight-red"],
  ["row-highlight-red", "row-highlight-red", "row-highlight-red"],
];

function seasonLayout(seasonNumber) {
  if (seasonNumber === 7) {
    return {
      divisions: [
        { title: "Division 1", range: "B3:G12" },
        { title: "Division 2", range: "B14:G23" },
        { title: "Division 3", range: "B25:G34" },
      ],
      scheduleRange: "I2:AB136",
    };
  }

  return {
    divisions: [
      { title: "Division 1", range: "B3:G10" },
      { title: "Division 2", range: "B13:G20" },
      { title: "Division 3", range: "B23:G30" },
    ],
    scheduleRange: "I2:AB85",
  };
}

function normalizeValues(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.values)) return response.values;
  if (Array.isArray(response.data?.values)) return response.data.values;
  if (Array.isArray(response.result?.values)) return response.result.values;
  return [];
}

function parseGvizResponse(text) {
  const match = String(text || "").match(/google\.visualization\.Query\.setResponse\((.*)\);?\s*$/s);
  if (!match) throw new Error("Unable to parse Google Sheets response.");
  const payload = JSON.parse(match[1]);
  return (payload?.table?.rows || []).map((row) =>
    (row.c || []).map((cell) => cell?.v ?? "")
  );
}

async function fetchRange(a1, sheetName, fetchImpl = fetch) {
  const range = `'${sheetName}'!${a1}`;
  const payload = { sheetId: SHEET_ID, range };

  try {
    const response = await fetchImpl(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return normalizeValues(await response.json());
  } catch {}

  try {
    const url = new URL(WORKER_URL);
    url.searchParams.set("sheetId", SHEET_ID);
    url.searchParams.set("range", range);
    const response = await fetchImpl(url);
    if (response.ok) return normalizeValues(await response.json());
  } catch {}

  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  url.searchParams.set("sheet", sheetName);
  url.searchParams.set("range", a1);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Super League standings request failed (${response.status}).`);
  }
  return parseGvizResponse(await response.text());
}

function numOrZero(value) {
  const number = Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : 0;
}

function formatDiff(value) {
  const number = numOrZero(value);
  return number > 0 ? `+${number}` : String(number);
}

function mapRows(values) {
  return values
    .map((row = [], sourceOrder) => {
      const player = String(row[0] ?? "").trim();
      const matchesWon = numOrZero(row[1]);
      const matchesLost = numOrZero(row[2]);
      const gamesWon = numOrZero(row[3]);
      const gamesLost = numOrZero(row[4]);
      const diff = numOrZero(row[5]);
      return {
        player,
        matchesWon,
        matchesLost,
        gamesWon,
        gamesLost,
        diff,
        sourceOrder,
        matches: `${matchesWon}-${matchesLost}`,
        games: `${gamesWon}-${gamesLost}`,
        diffText: formatDiff(diff),
      };
    })
    .filter((row) => row.player);
}

function normalizeDivisionValue(value) {
  const text = String(value ?? "").trim();
  return text.match(/(\d+)/)?.[1] || text;
}

function comparePctDesc(aWins, aLosses, bWins, bLosses) {
  const aTotal = aWins + aLosses;
  const bTotal = bWins + bLosses;
  if (aTotal === 0 && bTotal === 0) return 0;
  if (aTotal === 0) return bWins > 0 ? 1 : -1;
  if (bTotal === 0) return aWins > 0 ? -1 : 1;
  const left = aWins * bTotal;
  const right = bWins * aTotal;
  return left === right ? 0 : left > right ? -1 : 1;
}

function compareRoundDiffDesc(aWins, aLosses, bWins, bLosses) {
  const aDiff = aWins - aLosses;
  const bDiff = bWins - bLosses;
  return aDiff === bDiff ? 0 : bDiff - aDiff;
}

function getHeadToHeadOutcome(headToHeadMap, playerA, playerB) {
  const aKey = String(playerA ?? "").trim().toUpperCase();
  const bKey = String(playerB ?? "").trim().toUpperCase();
  if (!aKey || !bKey) return null;
  const aVs = headToHeadMap.get(aKey);
  if (aVs?.has(bKey)) return aVs.get(bKey);
  const bVs = headToHeadMap.get(bKey);
  if (bVs?.has(aKey)) return bVs.get(aKey) === 1 ? -1 : 1;
  return null;
}

function buildHeadToHeadByDivision(scheduleRows) {
  const byDivision = new Map();
  for (const row of scheduleRows) {
    const division = normalizeDivisionValue(row?.[1]);
    const player1 = String(row?.[3] ?? "").trim();
    const player2 = String(row?.[12] ?? "").trim();
    const result1 = String(row?.[10] ?? "").trim().toUpperCase();
    const result2 = String(row?.[19] ?? "").trim().toUpperCase();
    if (!division || !player1 || !player2) continue;
    if (!((result1 === "W" && result2 === "L") || (result1 === "L" && result2 === "W"))) continue;

    if (!byDivision.has(division)) byDivision.set(division, new Map());
    const divisionMap = byDivision.get(division);
    const player1Key = player1.toUpperCase();
    const player2Key = player2.toUpperCase();
    if (!divisionMap.has(player1Key)) divisionMap.set(player1Key, new Map());
    if (!divisionMap.has(player2Key)) divisionMap.set(player2Key, new Map());
    const player1Won = result1 === "W";
    divisionMap.get(player1Key).set(player2Key, player1Won ? 1 : -1);
    divisionMap.get(player2Key).set(player1Key, player1Won ? -1 : 1);
  }
  return byDivision;
}

function computeHeadToHeadPct(row, group, headToHeadMap) {
  let wins = 0;
  let losses = 0;
  for (const other of group) {
    if (other.playerKey === row.playerKey) continue;
    const outcome = getHeadToHeadOutcome(headToHeadMap, row.playerKey, other.playerKey);
    if (outcome === 1) wins += 1;
    if (outcome === -1) losses += 1;
  }
  return wins + losses ? wins / (wins + losses) : null;
}

function rankDivisionRows(rows, divisionTitle, headToHeadByDivision, seasonNumber) {
  const divisionKey = normalizeDivisionValue(divisionTitle);
  const headToHeadMap = headToHeadByDivision.get(divisionKey) || new Map();
  const useHeadToHead = seasonNumber >= 6;
  const ranked = rows.map((row) => ({ ...row, playerKey: row.player.toUpperCase() }));
  ranked.sort((a, b) => comparePctDesc(a.matchesWon, a.matchesLost, b.matchesWon, b.matchesLost));

  const ordered = [];
  for (let index = 0; index < ranked.length;) {
    const group = [ranked[index]];
    let end = index + 1;
    while (
      end < ranked.length &&
      comparePctDesc(
        ranked[index].matchesWon,
        ranked[index].matchesLost,
        ranked[end].matchesWon,
        ranked[end].matchesLost
      ) === 0
    ) {
      group.push(ranked[end]);
      end += 1;
    }

    if (group.length === 2) {
      const headToHead = getHeadToHeadOutcome(headToHeadMap, group[0].playerKey, group[1].playerKey);
      if (useHeadToHead && headToHead === -1) group.reverse();
      if (!(useHeadToHead && Math.abs(headToHead) === 1)) {
        const gamesComparison = compareRoundDiffDesc(
          group[0].gamesWon,
          group[0].gamesLost,
          group[1].gamesWon,
          group[1].gamesLost
        );
        if (gamesComparison > 0) group.reverse();
        if (gamesComparison === 0 && group[0].diff !== group[1].diff && group[0].diff > group[1].diff) {
          group.reverse();
        }
        const stillTied = gamesComparison === 0 && group[0].diff === group[1].diff;
        group[0].tied = stillTied;
        group[1].tied = stillTied;
      } else {
        group[0].tied = false;
        group[1].tied = false;
      }
    } else if (group.length > 2) {
      const withHeadToHead = group.map((row) => ({
        ...row,
        headToHeadPct: useHeadToHead ? computeHeadToHeadPct(row, group, headToHeadMap) : null,
      }));
      const uniqueHeadToHeadPcts = new Set(withHeadToHead.map((row) => row.headToHeadPct));
      const canUseHeadToHead = useHeadToHead && !(uniqueHeadToHeadPcts.size === 1 && uniqueHeadToHeadPcts.has(null));
      withHeadToHead.sort((a, b) => {
        if (canUseHeadToHead && a.headToHeadPct !== b.headToHeadPct) {
          if (a.headToHeadPct === null) return 1;
          if (b.headToHeadPct === null) return -1;
          return b.headToHeadPct - a.headToHeadPct;
        }
        const gamesComparison = compareRoundDiffDesc(a.gamesWon, a.gamesLost, b.gamesWon, b.gamesLost);
        if (gamesComparison !== 0) return gamesComparison;
        if (a.diff !== b.diff) return a.diff - b.diff;
        return a.sourceOrder - b.sourceOrder;
      });
      for (let groupIndex = 0; groupIndex < withHeadToHead.length; groupIndex += 1) {
        const row = withHeadToHead[groupIndex];
        const previous = withHeadToHead[groupIndex - 1];
        if (!previous) {
          row.tied = false;
          continue;
        }
        const sameHeadToHead = !useHeadToHead || row.headToHeadPct === previous.headToHeadPct;
        const sameGames = compareRoundDiffDesc(
          row.gamesWon,
          row.gamesLost,
          previous.gamesWon,
          previous.gamesLost
        ) === 0;
        row.tied = sameHeadToHead && sameGames && row.diff === previous.diff;
        if (row.tied) previous.tied = true;
      }
      group.splice(0, group.length, ...withHeadToHead);
    } else {
      group[0].tied = false;
    }

    ordered.push(...group);
    index = end;
  }

  let displayRank = 1;
  ordered.forEach((row, index) => {
    if (index > 0) {
      const previous = ordered[index - 1];
      const samePrimary = comparePctDesc(
        row.matchesWon,
        row.matchesLost,
        previous.matchesWon,
        previous.matchesLost
      ) === 0;
      const sameGames = compareRoundDiffDesc(
        row.gamesWon,
        row.gamesLost,
        previous.gamesWon,
        previous.gamesLost
      ) === 0;
      if (!(row.tied && previous.tied && samePrimary && sameGames && row.diff === previous.diff)) {
        displayRank = index + 1;
      }
    }
    row.rank = row.tied ? `T${displayRank}` : String(displayRank);
  });

  const rankCounts = new Map();
  for (const row of ordered) {
    const rank = String(row.rank).replace(/^T/, "");
    rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
  }
  for (const row of ordered) {
    if (String(row.rank).startsWith("T") && rankCounts.get(String(row.rank).slice(1)) === 1) {
      row.rank = String(row.rank).slice(1);
    }
  }
  return ordered;
}

function getDivisionRankHighlight(divisionTitle, rankPosition, seasonNumber) {
  const divisionIndex = Number(normalizeDivisionValue(divisionTitle));
  const movementRows = seasonNumber >= 7 ? FORMAT_MOVEMENT_ROWS_S7 : FORMAT_MOVEMENT_ROWS_S6;
  return movementRows[rankPosition - 1]?.[divisionIndex - 1] || "";
}

function applyRowHighlights(rows, divisionTitle, seasonNumber) {
  for (let index = 0; index < rows.length;) {
    const row = rows[index];
    if (!String(row.rank).startsWith("T")) {
      row.highlightClass = getDivisionRankHighlight(divisionTitle, index + 1, seasonNumber);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < rows.length && rows[end].rank === row.rank) end += 1;
    const highlights = new Set();
    for (let position = index + 1; position <= end; position += 1) {
      highlights.add(getDivisionRankHighlight(divisionTitle, position, seasonNumber));
    }
    const highlight = highlights.size === 1 ? [...highlights][0] : "";
    for (let tiedIndex = index; tiedIndex < end; tiedIndex += 1) {
      rows[tiedIndex].highlightClass = highlight;
    }
    index = end;
  }
  return rows;
}

function topTenRows(rows) {
  return rows.filter((row) => Number(String(row.rank).replace(/^T/, "")) <= 10);
}

function isSuperLeagueDisplayMessage(message, botUserId) {
  if (!message || message.webhookId || message.author?.id !== botUserId) {
    return false;
  }

  const attachmentNames = new Set(
    Array.from(message.attachments?.values?.() || [], (attachment) => attachment.name)
  );
  return LEADERBOARD_FILENAMES.every((filename) => attachmentNames.has(filename));
}

async function findSuperLeagueDisplayMessageInPages(fetchPage, botUserId) {
  let before;
  while (true) {
    const messages = Array.from((await fetchPage(before)).values());
    const message = messages.find((candidate) => isSuperLeagueDisplayMessage(candidate, botUserId));
    if (message || messages.length < 100) {
      return message || null;
    }
    before = messages.at(-1)?.id;
    if (!before) {
      return null;
    }
  }
}

async function loadSuperLeagueStandings(seasonNumber, fetchImpl = fetch) {
  const layout = seasonLayout(seasonNumber);
  const values = await Promise.all([
    ...layout.divisions.map((division) => fetchRange(division.range, `Season ${seasonNumber}`, fetchImpl)),
    fetchRange(layout.scheduleRange, `Season ${seasonNumber}`, fetchImpl),
  ]);
  const headToHead = buildHeadToHeadByDivision(values[layout.divisions.length] || []);
  return layout.divisions.map((division, index) => ({
    ...division,
    rows: applyRowHighlights(
      topTenRows(
        rankDivisionRows(mapRows(values[index] || []), division.title, headToHead, seasonNumber)
      ),
      division.title,
      seasonNumber
    ),
  }));
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function addText(layers, text, x, y, size, weight, color, anchor = "center", letterSpacing = 0) {
  layers.push({ text, x, y, size, weight, color, anchor, letterSpacing });
}

async function renderTextLayer({ text, x, y, size, weight, color, anchor, letterSpacing }) {
  const spacing = letterSpacing ? ` letter_spacing="${Math.round(letterSpacing * 1024)}"` : "";
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${color}" font_size="${size * 1024}" font_weight="${weight}"${spacing}>${escapeXml(text)}</span>`,
      font: "Inter Variable",
      fontfile: INTER_FONT,
      rgba: true,
      dpi: 72 * OUTPUT_SCALE,
    },
  }).png().toBuffer({ resolveWithObject: true });
  return {
    input: data,
    left: Math.round(x * OUTPUT_SCALE - (anchor === "center" ? info.width / 2 : 0)),
    top: Math.round(y * OUTPUT_SCALE - info.height / 2),
  };
}

async function renderSvgImage(width, height, markup, textLayers) {
  const background = await sharp(Buffer.from(`
    <svg width="${width * OUTPUT_SCALE}" height="${height * OUTPUT_SCALE}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${markup}
    </svg>
  `)).png().toBuffer();
  const composites = [];
  for (const layer of textLayers) {
    composites.push(await renderTextLayer(layer));
  }
  return sharp(background)
    .composite(composites)
    .png()
    .toBuffer();
}

function rowMarkup(rows, textLayers) {
  return rows.map((row, rowIndex) => {
    const rowY = ROWS_Y + rowIndex * (ROW_HEIGHT + ROW_GAP);
    let columnX = TABLE_X;
    for (const column of DIVISION_COLUMNS) {
      const value = String(row[column.key] ?? "").toUpperCase();
      const playerSize = column.key === "player" && value.length > 20 ? 32 : column.size;
      addText(
        textLayers,
        value,
        columnX + column.width / 2,
        rowY + ROW_HEIGHT / 2,
        playerSize,
        column.weight,
        "#e9eef8"
      );
      columnX += column.width;
    }
    return `<rect x="${TABLE_X}" y="${rowY}" width="${DIVISION_TABLE_WIDTH}" height="${ROW_HEIGHT}" rx="${ROW_RADIUS}" fill="${ROW_COLORS[row.highlightClass] || ROW_COLORS[""]}"/>`;
  }).join("");
}

async function renderDivisionImage(division, imageHeight) {
  const textLayers = [];
  addText(textLayers, division.title.toUpperCase(), TABLE_X + 2, 34, 40, 900, WEBSITE_BACKGROUND, "left", 1);
  addText(textLayers, division.title.toUpperCase(), TABLE_X, 32, 40, 900, DIVISION_COLORS[division.title], "left", 1);

  let columnX = TABLE_X;
  for (const column of DIVISION_COLUMNS) {
    addText(
      textLayers,
      column.label,
      columnX + column.width / 2,
      HEADER_Y + HEADER_HEIGHT / 2,
      21,
      800,
      WEBSITE_MUTED,
      "center",
      2.5
    );
    columnX += column.width;
  }

  return renderSvgImage(DIVISION_CANVAS_WIDTH, imageHeight, `
    <line x1="${TABLE_X}" y1="62" x2="${TABLE_X + DIVISION_TABLE_WIDTH}" y2="62" stroke="${WEBSITE_BORDER}" stroke-width="4"/>
    <rect x="${TABLE_X}" y="${HEADER_Y}" width="${DIVISION_TABLE_WIDTH}" height="${HEADER_HEIGHT}" rx="${ROW_RADIUS}" fill="#252e41"/>
    ${rowMarkup(division.rows, textLayers)}
  `, textLayers);
}

async function buildDivisionImages(divisions) {
  const maxRows = Math.max(10, ...divisions.map((division) => division.rows.length));
  const imageHeight = ROWS_Y + maxRows * ROW_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP + 48;
  const images = [];
  for (const division of divisions) {
    images.push(await renderDivisionImage(division, imageHeight));
  }
  return images;
}

async function renderHeaderImage(seasonNumber) {
  const width = CANVAS_WIDTH * OUTPUT_SCALE;
  const height = 420 * OUTPUT_SCALE;
  const { data: logo, info } = await sharp(SUPER_LEAGUE_LOGO)
    .trim()
    .resize({ width: 1800, height: 650, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const text = await renderTextLayer({
    text: `SEASON ${seasonNumber} STANDINGS`,
    x: CANVAS_WIDTH / 2,
    y: 385,
    size: 38,
    weight: 850,
    color: SUPER_LEAGUE_PURPLE,
    anchor: "center",
    letterSpacing: 4,
  });
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: logo, left: Math.round((width - info.width) / 2), top: 10 },
      text,
    ])
    .png()
    .toBuffer();
}

async function renderLegendImage() {
  const textLayers = [];
  addText(textLayers, "STANDINGS LEGEND", 80, 50, 26, 850, WEBSITE_MUTED, "left", 2.5);
  addText(textLayers, "SUPER LEAGUE D1 PLAYOFFS", 118, 95, 22, 800, "#e9eef8", "left", 0.5);
  addText(textLayers, "MOVES UP DIVISION", 118, 145, 22, 800, "#e9eef8", "left", 0.5);
  addText(textLayers, "PLAYOFF TO MOVE UP/DOWN DIVISION", 152, 195, 22, 800, "#e9eef8", "left", 0.5);
  addText(textLayers, "REMAINS IN DIVISION, OR TIED BETWEEN MULTIPLE OUTCOMES", 118, 245, 22, 800, "#e9eef8", "left", 0.5);
  addText(textLayers, "MOVES DOWN DIVISION, OR TO QUALIFIER TOURNAMENT", 118, 295, 22, 800, "#e9eef8", "left", 0.5);

  const swatch = (x, y, color) =>
    `<rect x="${x}" y="${y}" width="24" height="24" rx="5" fill="${color}" stroke="#64748b" stroke-width="1"/>`;
  return renderSvgImage(CANVAS_WIDTH, 352, `
    <rect x="${TABLE_X}" y="18" width="${TABLE_WIDTH}" height="316" rx="18" fill="#172033" stroke="#334155" stroke-width="2"/>
    ${swatch(80, 83, ROW_COLORS["row-highlight-gold"])}
    ${swatch(80, 133, ROW_COLORS["row-highlight-green"])}
    ${swatch(80, 183, ROW_COLORS["row-highlight-blue"])}
    ${swatch(112, 183, ROW_COLORS["row-highlight-orange"])}
    ${swatch(80, 233, ROW_COLORS[""])}
    ${swatch(80, 283, ROW_COLORS["row-highlight-red"])}
  `, textLayers);
}

async function buildLeaderboardImages(divisions, seasonNumber) {
  return [
    await renderHeaderImage(seasonNumber),
    ...(await buildDivisionImages(divisions)),
    await renderLegendImage(),
  ];
}

function buildMessagePayload(seasonNumber, now = new Date()) {
  const timestamp = Math.floor(now.getTime() / 1000);
  const descriptions = [
    `Super League Season ${seasonNumber} standings header`,
    ...[1, 2, 3].map((division) => `Super League Season ${seasonNumber} Division ${division} standings`),
    "Super League standings legend",
  ];
  const media = LEADERBOARD_FILENAMES.map((filename, index) => ({
    type: 12,
    items: [{
      media: { url: `attachment://${filename}` },
      description: descriptions[index],
    }],
  }));
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: 0xba61df,
      components: [
        ...media,
        {
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: "Full & Previous Season Results",
            url: RESULTS_URL,
          }],
        },
        { type: 10, content: `Updated <t:${timestamp}:R>` },
      ],
    }],
  };
}

module.exports = {
  LEADERBOARD_FILENAMES,
  RESULTS_URL,
  applyRowHighlights,
  buildDivisionImages,
  buildHeadToHeadByDivision,
  buildLeaderboardImages,
  buildMessagePayload,
  findSuperLeagueDisplayMessageInPages,
  getDivisionRankHighlight,
  isSuperLeagueDisplayMessage,
  loadSuperLeagueStandings,
  mapRows,
  rankDivisionRows,
  renderTextLayer,
  seasonLayout,
  topTenRows,
};
