const SEASON_6_SHEET_NAME = "Season 6";
const SEASON_7_SHEET_NAME = "Season 7";
const SEASON_7_QUALIFIERS_SHEET_NAME = "Season 7 Qualifiers";
const SEASON_7_PROMOTIONS_SHEET_NAME = "Season 7 Promotions";
const FORMAT_SHEET_NAME = "Format";

const SCHEDULE_HEADERS = [
  "Week", "Div", "Seed", "Name", "R1", "R2", "R3", "W", "L", "+/-", "Result",
  "Seed", "Name", "R1", "R2", "R3", "W", "L", "+/-", "Result",
];

const SEASON_7_CONFIG = {
  season: SEASON_7_SHEET_NAME,
  sheetName: SEASON_7_SHEET_NAME,
  sourceSheetName: SEASON_6_SHEET_NAME,
  type: "season",
  standingsRows: [
    { title: "Division 1", headerRow: 2, startRow: 3, endRow: 12, ids: range(1, 10) },
    { title: "Division 2", headerRow: 13, startRow: 14, endRow: 23, ids: range(11, 20) },
    { title: "Division 3", headerRow: 24, startRow: 25, endRow: 34, ids: range(21, 30) },
  ],
  scheduleStartRow: 2,
  scheduleEndRow: 136,
  scheduleRange: "I1:AB136",
  standingsRange: "A1:G34",
};

const PROMOTIONS_CONFIG = {
  season: SEASON_7_SHEET_NAME,
  sheetName: SEASON_7_PROMOTIONS_SHEET_NAME,
  sourceSheetName: SEASON_6_SHEET_NAME,
  type: "promotions",
  standingsRows: [
    {
      title: "Promotion to D1",
      group: "Promotion to D1",
      headerRow: 2,
      startRow: 3,
      endRow: 7,
      note: "Top 2 -> D1",
      ids: ["D1-1", "D1-2", "D1-3", "D1-4", "D1-5"],
    },
    {
      title: "Promotion to D2",
      group: "Promotion to D2",
      headerRow: 9,
      startRow: 10,
      endRow: 13,
      note: "Top 2 -> D2",
      ids: ["D2-1", "D2-2", "D2-3", "D2-4"],
    },
  ],
  scheduleStartRow: 2,
  scheduleEndRow: 17,
  scheduleRange: "I1:AB17",
  standingsRange: "A1:H13",
};

function range(start, end){
  return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
}

function generateRoundRobin(playerIds){
  if(!Array.isArray(playerIds) || playerIds.length < 2){
    throw new Error("generateRoundRobin requires at least two players.");
  }

  const hasBye = playerIds.length % 2 === 1;
  const bye = "__BYE__";
  const rotation = hasBye ? [...playerIds, bye] : [...playerIds];
  const rounds = [];
  const roundsCount = rotation.length - 1;
  const matchesPerRound = rotation.length / 2;

  for(let roundIndex = 0; roundIndex < roundsCount; roundIndex += 1){
    const roundMatches = [];
    for(let matchIndex = 0; matchIndex < matchesPerRound; matchIndex += 1){
      const left = rotation[matchIndex];
      const right = rotation[rotation.length - 1 - matchIndex];
      if(left !== bye && right !== bye){
        roundMatches.push({ left, right });
      }
    }
    rounds.push(roundMatches);
    rotation.splice(1, 0, rotation.pop());
  }

  return rounds;
}

function buildDivisionSchedule(division, playerIds){
  return generateRoundRobin(playerIds).flatMap((matches, roundIndex) => (
    matches.map((match) => ({
      week: roundIndex + 1,
      division,
      leftId: match.left,
      rightId: match.right,
    }))
  ));
}

function buildSeasonSchedule(divisions = SEASON_7_CONFIG.standingsRows){
  const byDivision = divisions.map((division, index) => ({
    division: index + 1,
    rounds: generateRoundRobin(division.ids),
  }));

  return byDivision[0].rounds.flatMap((_, roundIndex) => (
    byDivision.flatMap(({ division, rounds }) => (
      rounds[roundIndex].map((match) => ({
        week: roundIndex + 1,
        division,
        leftId: match.left,
        rightId: match.right,
      }))
    ))
  ));
}

function buildPromotionSchedule(){
  const d1 = generateRoundRobin(PROMOTIONS_CONFIG.standingsRows[0].ids).flatMap((matches, roundIndex) => (
    matches.map((match) => ({
      week: roundIndex + 1,
      group: "Promotion to D1",
      division: "Promotion to D1",
      leftId: match.left,
      rightId: match.right,
    }))
  ));

  const d2 = generateRoundRobin(PROMOTIONS_CONFIG.standingsRows[1].ids).flatMap((matches, roundIndex) => (
    matches.map((match) => ({
      week: roundIndex + 1,
      group: "Promotion to D2",
      division: "Promotion to D2",
      leftId: match.left,
      rightId: match.right,
    }))
  ));

  return [...d1, ...d2];
}

function quoteSheetName(sheetName){
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function buildMatchRowFormulas(row, config){
  const sheet = quoteSheetName(config.sheetName);
  return {
    leftName: `=IF($K${row}="","",IFNA(VLOOKUP($K${row},${sheet}!$A:$B,2,FALSE),""))`,
    leftWins: `=IF(COUNT($M${row}:$O${row},$V${row}:$X${row})=0,"",SUMPRODUCT(--ISNUMBER($M${row}:$O${row}),--ISNUMBER($V${row}:$X${row}),--($M${row}:$O${row}<=$V${row}:$X${row})))`,
    leftLosses: `=IF(COUNT($M${row}:$O${row},$V${row}:$X${row})=0,"",SUMPRODUCT(--ISNUMBER($M${row}:$O${row}),--ISNUMBER($V${row}:$X${row}),--($M${row}:$O${row}>$V${row}:$X${row})))`,
    leftDiff: `=IF(COUNT($M${row}:$O${row},$V${row}:$X${row})=0,"",SUMPRODUCT(--ISNUMBER($M${row}:$O${row}),--ISNUMBER($V${row}:$X${row}),IF($V${row}:$X${row}-$M${row}:$O${row}>3,3,IF($V${row}:$X${row}-$M${row}:$O${row}<-3,-3,$V${row}:$X${row}-$M${row}:$O${row}))))`,
    leftResult: `=IF(OR($P${row}="",$Y${row}=""),"",IF($P${row}=$Y${row},"T",IF($P${row}>$Y${row},"W","L")))`,
    rightName: `=IF($T${row}="","",IFNA(VLOOKUP($T${row},${sheet}!$A:$B,2,FALSE),""))`,
    rightWins: `=IF(COUNT($M${row}:$O${row},$V${row}:$X${row})=0,"",SUMPRODUCT(--ISNUMBER($M${row}:$O${row}),--ISNUMBER($V${row}:$X${row}),--($V${row}:$X${row}<=$M${row}:$O${row})))`,
    rightLosses: `=IF(COUNT($M${row}:$O${row},$V${row}:$X${row})=0,"",SUMPRODUCT(--ISNUMBER($M${row}:$O${row}),--ISNUMBER($V${row}:$X${row}),--($V${row}:$X${row}>$M${row}:$O${row})))`,
    rightDiff: `=IF($R${row}="","",-$R${row})`,
    rightResult: `=IF(OR($P${row}="",$Y${row}=""),"",IF($Y${row}=$P${row},"T",IF($Y${row}>$P${row},"W","L")))`,
  };
}

function buildStandingsFormulas(row, config, headerRow){
  const start = config.scheduleStartRow;
  const end = config.scheduleEndRow;
  return [
    `=IF($B${row}="","",COUNTIFS($L$${start}:$L$${end},$B${row},$S$${start}:$S$${end},C$${headerRow})+COUNTIFS($U$${start}:$U$${end},$B${row},$AB$${start}:$AB$${end},C$${headerRow}))`,
    `=IF($B${row}="","",COUNTIFS($L$${start}:$L$${end},$B${row},$S$${start}:$S$${end},D$${headerRow})+COUNTIFS($U$${start}:$U$${end},$B${row},$AB$${start}:$AB$${end},D$${headerRow}))`,
    `=IF($B${row}="","",SUMIF($L$${start}:$L$${end},$B${row},$P$${start}:$P$${end})+SUMIF($U$${start}:$U$${end},$B${row},$Y$${start}:$Y$${end}))`,
    `=IF($B${row}="","",SUMIF($L$${start}:$L$${end},$B${row},$Q$${start}:$Q$${end})+SUMIF($U$${start}:$U$${end},$B${row},$Z$${start}:$Z$${end}))`,
    `=IF($B${row}="","",SUMIF($L$${start}:$L$${end},$B${row},$R$${start}:$R$${end})+SUMIF($U$${start}:$U$${end},$B${row},$AA$${start}:$AA$${end}))`,
  ];
}

function buildStandingsGrid(config, preservedNames = new Map()){
  const width = config.type === "promotions" ? 8 : 7;
  const height = config.type === "promotions" ? 13 : 34;
  const grid = Array.from({ length: height }, () => Array(width).fill(""));

  grid[0][1] = "Name";
  grid[0][2] = "Matches";
  grid[0][4] = "Games";
  grid[0][6] = config.type === "promotions" ? "+/-" : "Dif";

  config.standingsRows.forEach((section) => {
    const header = grid[section.headerRow - 1];
    header[1] = section.title;
    header[2] = "W";
    header[3] = "L";
    header[4] = "W";
    header[5] = "L";
    header[6] = "+/-";
    if(config.type === "promotions") header[7] = section.note;

    section.ids.forEach((id, idx) => {
      const rowNumber = section.startRow + idx;
      const row = grid[rowNumber - 1];
      row[0] = id;
      row[1] = preservedNames.get(String(id)) || "";
      row.splice(2, 5, ...buildStandingsFormulas(rowNumber, config, section.headerRow));
    });
  });

  return grid;
}

function buildScheduleGrid(schedule, config, preservedScores = new Map()){
  const grid = [SCHEDULE_HEADERS.slice()];

  schedule.forEach((match, idx) => {
    const rowNumber = config.scheduleStartRow + idx;
    const formulas = buildMatchRowFormulas(rowNumber, config);
    const score = preservedScores.get(matchIdentity(config.season, match)) || null;
    const direction = score && String(score.leftId) === String(match.rightId) && String(score.rightId) === String(match.leftId)
      ? "reversed"
      : "same";
    const leftScores = score ? (direction === "reversed" ? score.rightScores : score.leftScores) : ["", "", ""];
    const rightScores = score ? (direction === "reversed" ? score.leftScores : score.rightScores) : ["", "", ""];

    grid.push([
      match.week,
      match.division,
      match.leftId,
      formulas.leftName,
      ...leftScores,
      formulas.leftWins,
      formulas.leftLosses,
      formulas.leftDiff,
      formulas.leftResult,
      match.rightId,
      formulas.rightName,
      ...rightScores,
      formulas.rightWins,
      formulas.rightLosses,
      formulas.rightDiff,
      formulas.rightResult,
    ]);
  });

  return grid;
}

function buildSeason7WorkbookModel(preserved = {}){
  const names = preserved.names || new Map();
  const scores = preserved.scores || new Map();
  const seasonSchedule = buildSeasonSchedule();
  const promotionSchedule = buildPromotionSchedule();

  return {
    season7: {
      sheetName: SEASON_7_CONFIG.sheetName,
      standingsRange: SEASON_7_CONFIG.standingsRange,
      scheduleRange: SEASON_7_CONFIG.scheduleRange,
      standings: buildStandingsGrid(SEASON_7_CONFIG, names.get?.(SEASON_7_CONFIG.sheetName) || new Map()),
      schedule: buildScheduleGrid(seasonSchedule, SEASON_7_CONFIG, scores.get?.(SEASON_7_CONFIG.sheetName) || new Map()),
      scheduleRows: seasonSchedule,
    },
    promotions: {
      sheetName: PROMOTIONS_CONFIG.sheetName,
      standingsRange: PROMOTIONS_CONFIG.standingsRange,
      scheduleRange: PROMOTIONS_CONFIG.scheduleRange,
      standings: buildStandingsGrid(PROMOTIONS_CONFIG, names.get?.(PROMOTIONS_CONFIG.sheetName) || new Map()),
      schedule: buildScheduleGrid(promotionSchedule, PROMOTIONS_CONFIG, scores.get?.(PROMOTIONS_CONFIG.sheetName) || new Map()),
      scheduleRows: promotionSchedule,
    },
  };
}

function matchIdentity(season, match){
  const sideIds = [String(match.leftId), String(match.rightId)].sort();
  return [
    season,
    String(match.division || match.group || "").trim().toUpperCase(),
    String(match.week).trim().toUpperCase(),
    sideIds[0],
    sideIds[1],
  ].join("|");
}

function preserveManualInputs(sheet, config){
  const names = new Map();
  const scores = new Map();
  if(!sheet) return { names, scores };

  config.standingsRows.forEach((section) => {
    const values = sheet.getRange(section.startRow, 1, section.ids.length, 2).getValues();
    values.forEach(([id, name], idx) => {
      const key = String(id || section.ids[idx] || "").trim();
      const playerName = String(name || "").trim();
      if(key && playerName) names.set(key, playerName);
    });
  });

  const rowCount = config.scheduleEndRow - config.scheduleStartRow + 1;
  const values = sheet.getRange(config.scheduleStartRow, 9, rowCount, 20).getValues();
  values.forEach((row) => {
    const match = {
      week: row[0],
      division: row[1],
      leftId: row[2],
      rightId: row[11],
    };
    if(!match.week || !match.division || !match.leftId || !match.rightId) return;
    const leftScores = row.slice(4, 7);
    const rightScores = row.slice(13, 16);
    if([...leftScores, ...rightScores].every((value) => String(value ?? "").trim() === "")) return;
    scores.set(matchIdentity(config.season, match), {
      leftId: match.leftId,
      rightId: match.rightId,
      leftScores,
      rightScores,
    });
  });

  return { names, scores };
}

function validateRoundRobinSchedule(schedule, groups){
  const errors = [];
  groups.forEach((group) => {
    const groupMatches = schedule.filter((match) => String(match.division) === String(group.division));
    const pairCounts = new Map();
    const playerCounts = new Map();
    const weeklyCounts = new Map();
    const expectedPairs = group.ids.length * (group.ids.length - 1) / 2;

    groupMatches.forEach((match) => {
      if(!group.ids.includes(match.leftId) || !group.ids.includes(match.rightId)){
        errors.push(`Cross-group matchup in ${group.division}: ${match.leftId} vs ${match.rightId}`);
      }
      const pairKey = [String(match.leftId), String(match.rightId)].sort().join("|");
      pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      playerCounts.set(match.leftId, (playerCounts.get(match.leftId) || 0) + 1);
      playerCounts.set(match.rightId, (playerCounts.get(match.rightId) || 0) + 1);
      const weekKey = `${match.week}|${match.leftId}`;
      const weekRightKey = `${match.week}|${match.rightId}`;
      weeklyCounts.set(weekKey, (weeklyCounts.get(weekKey) || 0) + 1);
      weeklyCounts.set(weekRightKey, (weeklyCounts.get(weekRightKey) || 0) + 1);
    });

    if(pairCounts.size !== expectedPairs) errors.push(`${group.division} has ${pairCounts.size} pairings; expected ${expectedPairs}`);
    pairCounts.forEach((count, pair) => {
      if(count !== 1) errors.push(`${group.division} pairing ${pair} occurs ${count} times`);
    });
    group.ids.forEach((id) => {
      const expectedMatches = group.ids.length - 1;
      if((playerCounts.get(id) || 0) !== expectedMatches){
        errors.push(`${group.division} player ${id} has ${playerCounts.get(id) || 0} matches; expected ${expectedMatches}`);
      }
    });
    weeklyCounts.forEach((count, key) => {
      if(count !== 1) errors.push(`${group.division} duplicate weekly appearance ${key}`);
    });
  });

  return errors;
}

function validateSeason7WorkbookModel(model = buildSeason7WorkbookModel()){
  const errors = [];
  const seasonSchedule = model.season7.scheduleRows;
  const promotionSchedule = model.promotions.scheduleRows;

  if(model.season7.standings.length !== 34) errors.push("Season 7 standings must end at row 34.");
  if(model.season7.schedule.length !== 136) errors.push("Season 7 schedule must include header plus 135 match rows.");
  if(model.promotions.standings.length !== 13) errors.push("Promotions standings must end at row 13.");
  if(model.promotions.schedule.length !== 17) errors.push("Promotions schedule must include header plus 16 match rows.");

  const seasonGroups = SEASON_7_CONFIG.standingsRows.map((section, index) => ({
    division: index + 1,
    ids: section.ids,
  }));
  errors.push(...validateRoundRobinSchedule(seasonSchedule, seasonGroups));

  const weekCounts = new Map();
  seasonSchedule.forEach((match) => {
    weekCounts.set(match.week, (weekCounts.get(match.week) || 0) + 1);
  });
  range(1, 9).forEach((week) => {
    if(weekCounts.get(week) !== 15) errors.push(`Week ${week} has ${weekCounts.get(week) || 0} matches; expected 15`);
  });
  seasonSchedule.forEach((match, idx) => {
    const expectedWeek = Math.floor(idx / 15) + 1;
    const expectedDivision = Math.floor((idx % 15) / 5) + 1;
    if(match.week !== expectedWeek || match.division !== expectedDivision){
      errors.push(`Season 7 row ${idx + 2} is out of week/division order.`);
    }
  });

  errors.push(...validateRoundRobinSchedule(promotionSchedule, [
    { division: "Promotion to D1", ids: PROMOTIONS_CONFIG.standingsRows[0].ids },
    { division: "Promotion to D2", ids: PROMOTIONS_CONFIG.standingsRows[1].ids },
  ]));

  const d1PromotionRounds = new Map();
  const d2PromotionRounds = new Map();
  promotionSchedule.forEach((match) => {
    const target = match.division === "Promotion to D1" ? d1PromotionRounds : d2PromotionRounds;
    target.set(match.week, (target.get(match.week) || 0) + 1);
  });
  range(1, 5).forEach((roundNumber) => {
    if(d1PromotionRounds.get(roundNumber) !== 2) errors.push(`Promotion to D1 round ${roundNumber} must have two matches.`);
  });
  range(1, 3).forEach((roundNumber) => {
    if(d2PromotionRounds.get(roundNumber) !== 2) errors.push(`Promotion to D2 round ${roundNumber} must have two matches.`);
  });

  const formulas = [
    ...model.season7.standings.flat(),
    ...model.season7.schedule.flat(),
    ...model.promotions.standings.flat(),
    ...model.promotions.schedule.flat(),
  ].filter((value) => String(value).startsWith("="));
  if(formulas.some((formula) => /Season 6|2:\$?85|2:\$?84/.test(formula))){
    errors.push("Generated formulas contain stale Season 6 references or row bounds.");
  }
  if(!formulas.some((formula) => /\$L\$2:\$L\$136/.test(formula))){
    errors.push("Season 7 standings formulas must reference schedule rows 2-136.");
  }
  if(!formulas.some((formula) => /\$L\$2:\$L\$17/.test(formula))){
    errors.push("Promotions standings formulas must reference schedule rows 2-17.");
  }

  return errors;
}

function upsertSheet(spreadsheet, name, sourceName){
  let sheet = spreadsheet.getSheetByName(name);
  if(sheet) return { sheet, existed: true };

  const source = spreadsheet.getSheetByName(sourceName);
  sheet = source ? source.copyTo(spreadsheet).setName(name) : spreadsheet.insertSheet(name);
  return { sheet, existed: false };
}

function copySeasonFormatting(sourceSheet, targetSheet, config){
  if(!sourceSheet || !targetSheet) return;
  const maxRows = config.type === "promotions" ? 17 : 136;
  const maxColumns = 28;

  for(let col = 1; col <= maxColumns; col += 1){
    targetSheet.setColumnWidth(col, sourceSheet.getColumnWidth(Math.min(col, sourceSheet.getMaxColumns())));
  }
  for(let row = 1; row <= maxRows; row += 1){
    const sourceRow = row <= 85 ? row : 85;
    targetSheet.setRowHeight(row, sourceSheet.getRowHeight(sourceRow));
  }

  const copiedRows = Math.min(maxRows, 85);
  sourceSheet.getRange(1, 1, copiedRows, maxColumns)
    .copyTo(targetSheet.getRange(1, 1, copiedRows, maxColumns), { formatOnly: true });
  for(let row = copiedRows + 1; row <= maxRows; row += 1){
    sourceSheet.getRange(85, 1, 1, maxColumns)
      .copyTo(targetSheet.getRange(row, 1, 1, maxColumns), { formatOnly: true });
  }

  targetSheet.setFrozenRows(sourceSheet.getFrozenRows());
  targetSheet.setFrozenColumns(sourceSheet.getFrozenColumns());
  copyConditionalFormatting(sourceSheet, targetSheet, maxRows, maxColumns);
  copyProtectedRanges(sourceSheet, targetSheet, maxRows, maxColumns);
}

function copyConditionalFormatting(sourceSheet, targetSheet, maxRows, maxColumns){
  const copiedRules = [];
  sourceSheet.getConditionalFormatRules().forEach((rule) => {
    const mappedRanges = rule.getRanges()
      .map((sourceRange) => mapSourceRangeToTarget(sourceRange, targetSheet, maxRows, maxColumns))
      .filter(Boolean);
    if(!mappedRanges.length) return;
    copiedRules.push(rule.copy().setRanges(mappedRanges).build());
  });

  const retainedRules = targetSheet.getConditionalFormatRules().filter((rule) => (
    rule.getRanges().every((range) => range.getRow() > maxRows || range.getColumn() > maxColumns)
  ));
  targetSheet.setConditionalFormatRules([...retainedRules, ...copiedRules]);
}

function mapSourceRangeToTarget(sourceRange, targetSheet, maxRows, maxColumns){
  const row = sourceRange.getRow();
  const column = sourceRange.getColumn();
  if(row > 85 || column > maxColumns) return null;

  const width = Math.min(sourceRange.getNumColumns(), maxColumns - column + 1);
  if(width <= 0) return null;

  const sourceEndRow = row + sourceRange.getNumRows() - 1;
  let height = sourceRange.getNumRows();
  if(sourceEndRow >= 85 || (column >= 9 && row <= 85)){
    height = maxRows - row + 1;
  }else if(column <= 8 && sourceEndRow >= 30){
    height = Math.min(maxRows, 34) - row + 1;
  }
  height = Math.min(height, maxRows - row + 1);
  if(height <= 0) return null;

  return targetSheet.getRange(row, column, height, width);
}

function copyProtectedRanges(sourceSheet, targetSheet, maxRows, maxColumns){
  if(typeof SpreadsheetApp === "undefined") return;

  try{
    const type = SpreadsheetApp.ProtectionType.RANGE;
    targetSheet.getProtections(type).forEach((protection) => {
      const range = protection.getRange();
      if(range.getRow() <= maxRows && range.getColumn() <= maxColumns){
        protection.remove();
      }
    });

    sourceSheet.getProtections(type).forEach((sourceProtection) => {
      const targetRange = mapSourceRangeToTarget(sourceProtection.getRange(), targetSheet, maxRows, maxColumns);
      if(!targetRange) return;

      const targetProtection = targetRange.protect();
      targetProtection.setDescription(sourceProtection.getDescription());
      targetProtection.setWarningOnly(sourceProtection.isWarningOnly());
      if(sourceProtection.isWarningOnly()) return;

      const editors = sourceProtection.getEditors();
      if(editors.length) targetProtection.addEditors(editors);
      if(sourceProtection.canDomainEdit()){
        targetProtection.setDomainEdit(true);
      }
    });
  }catch(error){
    // Protection APIs depend on the executing account's sheet permissions.
  }
}

function writeSheetModel(sheet, model){
  sheet.getRange(model.standingsRange).clearContent();
  sheet.getRange(model.scheduleRange).clearContent();
  sheet.getRange(1, 1, model.standings.length, model.standings[0].length).setValues(model.standings);
  sheet.getRange(1, 9, model.schedule.length, model.schedule[0].length).setValues(model.schedule);
}

function orderSeason7Sheets(spreadsheet){
  const season = spreadsheet.getSheetByName(SEASON_7_SHEET_NAME);
  const qualifiers = spreadsheet.getSheetByName(SEASON_7_QUALIFIERS_SHEET_NAME) || spreadsheet.getSheetByName("Qualifiers");
  const promotions = spreadsheet.getSheetByName(SEASON_7_PROMOTIONS_SHEET_NAME);
  const format = spreadsheet.getSheetByName(FORMAT_SHEET_NAME);

  if(season && qualifiers && season.getIndex() > qualifiers.getIndex()){
    spreadsheet.setActiveSheet(season);
    spreadsheet.moveActiveSheet(qualifiers.getIndex());
  }
  if(promotions && qualifiers){
    spreadsheet.setActiveSheet(promotions);
    spreadsheet.moveActiveSheet(qualifiers.getIndex() + 1);
  }
  if(format && promotions){
    spreadsheet.setActiveSheet(format);
    spreadsheet.moveActiveSheet(promotions.getIndex() + 1);
  }
}

function buildSuperLeagueSeason7Workbook(spreadsheet){
  const ss = spreadsheet || SpreadsheetApp.getActive();
  const seasonUpsert = upsertSheet(ss, SEASON_7_CONFIG.sheetName, SEASON_7_CONFIG.sourceSheetName);
  const promotionsUpsert = upsertSheet(ss, PROMOTIONS_CONFIG.sheetName, PROMOTIONS_CONFIG.sourceSheetName);
  const seasonSheet = seasonUpsert.sheet;
  const promotionsSheet = promotionsUpsert.sheet;
  const sourceSheet = ss.getSheetByName(SEASON_6_SHEET_NAME);
  const seasonPreserved = seasonUpsert.existed ? preserveManualInputs(seasonSheet, SEASON_7_CONFIG) : { names: new Map(), scores: new Map() };
  const promotionsPreserved = promotionsUpsert.existed ? preserveManualInputs(promotionsSheet, PROMOTIONS_CONFIG) : { names: new Map(), scores: new Map() };

  const preserved = {
    names: new Map([
      [SEASON_7_CONFIG.sheetName, seasonPreserved.names],
      [PROMOTIONS_CONFIG.sheetName, promotionsPreserved.names],
    ]),
    scores: new Map([
      [SEASON_7_CONFIG.sheetName, seasonPreserved.scores],
      [PROMOTIONS_CONFIG.sheetName, promotionsPreserved.scores],
    ]),
  };
  const model = buildSeason7WorkbookModel(preserved);

  copySeasonFormatting(sourceSheet, seasonSheet, SEASON_7_CONFIG);
  copySeasonFormatting(sourceSheet, promotionsSheet, PROMOTIONS_CONFIG);
  writeSheetModel(seasonSheet, model.season7);
  writeSheetModel(promotionsSheet, model.promotions);
  orderSeason7Sheets(ss);

  const validationErrors = validateSeason7WorkbookModel(model);
  if(validationErrors.length){
    throw new Error(validationErrors.join("\n"));
  }
  return model;
}

if(typeof globalThis !== "undefined"){
  globalThis.buildSuperLeagueSeason7Workbook = buildSuperLeagueSeason7Workbook;
}

if(typeof module !== "undefined"){
  module.exports = {
    SEASON_7_CONFIG,
    PROMOTIONS_CONFIG,
    generateRoundRobin,
    buildDivisionSchedule,
    buildSeasonSchedule,
    buildPromotionSchedule,
    buildStandingsFormulas,
    buildMatchRowFormulas,
    buildSeason7WorkbookModel,
    matchIdentity,
    preserveManualInputs,
    validateSeason7WorkbookModel,
  };
}
