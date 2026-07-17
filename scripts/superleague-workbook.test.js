const assert = require("node:assert/strict");
const {
  PROMOTIONS_CONFIG,
  SEASON_7_CONFIG,
  buildPromotionSchedule,
  buildSeason7WorkbookModel,
  buildSeasonSchedule,
  generateRoundRobin,
  validateSeason7WorkbookModel,
} = require("./superleague-workbook");

function countBy(items, keyFn){
  const counts = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function pairKey(match){
  return [String(match.leftId), String(match.rightId)].sort().join("|");
}

function assertCompleteRoundRobin(schedule, ids, label){
  const pairCounts = countBy(schedule, pairKey);
  assert.equal(pairCounts.size, ids.length * (ids.length - 1) / 2, `${label} unique pair count`);
  pairCounts.forEach((count, pair) => {
    assert.equal(count, 1, `${label} pair ${pair}`);
  });

  const playerCounts = countBy(schedule.flatMap((match) => [match.leftId, match.rightId]), String);
  ids.forEach((id) => {
    assert.equal(playerCounts.get(String(id)), ids.length - 1, `${label} player ${id} match count`);
  });
}

function assertNoBye(schedule){
  schedule.forEach((match) => {
    assert.notEqual(String(match.leftId).toUpperCase(), "BYE");
    assert.notEqual(String(match.rightId).toUpperCase(), "BYE");
  });
}

{
  const rounds = generateRoundRobin([1, 2, 3, 4, 5]);
  assert.equal(rounds.length, 5);
  rounds.forEach((round) => assert.equal(round.length, 2));
  assertNoBye(rounds.flat());
}

{
  const schedule = buildSeasonSchedule();
  assert.equal(schedule.length, 135);

  for(let week = 1; week <= 9; week += 1){
    const weekMatches = schedule.filter((match) => match.week === week);
    assert.equal(weekMatches.length, 15, `week ${week} total`);
    for(let division = 1; division <= 3; division += 1){
      assert.equal(
        weekMatches.filter((match) => match.division === division).length,
        5,
        `week ${week} division ${division}`,
      );
    }
  }

  schedule.forEach((match, index) => {
    assert.equal(match.week, Math.floor(index / 15) + 1, `row ${index + 2} week`);
    assert.equal(match.division, Math.floor((index % 15) / 5) + 1, `row ${index + 2} division`);
  });

  SEASON_7_CONFIG.standingsRows.forEach((section, index) => {
    const division = index + 1;
    const divisionSchedule = schedule.filter((match) => match.division === division);
    assert.equal(divisionSchedule.length, 45, `division ${division} total matches`);
    assertCompleteRoundRobin(divisionSchedule, section.ids, `division ${division}`);
  });
}

{
  const schedule = buildPromotionSchedule();
  assert.equal(schedule.length, 16);
  assertNoBye(schedule);

  const d1 = schedule.filter((match) => match.division === "Promotion to D1");
  const d2 = schedule.filter((match) => match.division === "Promotion to D2");
  assert.equal(d1.length, 10);
  assert.equal(d2.length, 6);

  for(let round = 1; round <= 5; round += 1){
    assert.equal(d1.filter((match) => match.week === round).length, 2, `D1 promotion round ${round}`);
  }
  for(let round = 1; round <= 3; round += 1){
    assert.equal(d2.filter((match) => match.week === round).length, 2, `D2 promotion round ${round}`);
  }

  assertCompleteRoundRobin(d1, PROMOTIONS_CONFIG.standingsRows[0].ids, "promotion D1");
  assertCompleteRoundRobin(d2, PROMOTIONS_CONFIG.standingsRows[1].ids, "promotion D2");
}

{
  const model = buildSeason7WorkbookModel();
  assert.equal(model.season7.sheetName, "Season 7");
  assert.equal(model.season7.standingsRange, "A1:G34");
  assert.equal(model.season7.scheduleRange, "I1:AB136");
  assert.equal(model.season7.standings.length, 34);
  assert.equal(model.season7.schedule.length, 136);

  assert.equal(model.promotions.sheetName, "Season 7 Promotions");
  assert.equal(model.promotions.standingsRange, "A1:H13");
  assert.equal(model.promotions.scheduleRange, "I1:AB17");
  assert.equal(model.promotions.standings.length, 13);
  assert.equal(model.promotions.schedule.length, 17);

  const formulas = [
    ...model.season7.standings.flat(),
    ...model.season7.schedule.flat(),
    ...model.promotions.standings.flat(),
    ...model.promotions.schedule.flat(),
  ].filter((value) => String(value).startsWith("="));

  assert(formulas.some((formula) => formula.includes("$L$2:$L$136")));
  assert(formulas.some((formula) => formula.includes("$L$2:$L$17")));
  assert(formulas.some((formula) => formula.includes("VLOOKUP($K2,'Season 7'!$A:$B,2,FALSE)")));
  assert(formulas.some((formula) => formula.includes("VLOOKUP($K2,'Season 7 Promotions'!$A:$B,2,FALSE)")));
  formulas.forEach((formula) => {
    assert(!formula.includes("Season 6"), formula);
    assert(!/\$85\b/.test(formula), formula);
  });

  assert.deepEqual(validateSeason7WorkbookModel(model), []);
}
