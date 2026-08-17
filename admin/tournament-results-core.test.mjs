import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addedPlayerRowSaveState,
  bracketRoundLabel,
  buildEditorTables,
  buildUpdates,
  coerceScoreValue,
  editorPlayerOptions,
  editorMatchups,
  getCellValue,
  getTournamentAdminFlag,
  isEditorRowSelected,
  isEditorRowVisible,
  matchupHasBye,
  nextBlankPlayerRow,
  noptationalDisplayName,
  orderEditorRowsByPlayerSelection,
  parseA1Range,
  playerFilterBackspaceState,
  proLeagueViewKey,
  superLeagueDivisionClass,
  superLeagueViewKey,
  tournamentEditorUrlForPath,
  tournamentEditorUrlForUser,
} from "./tournament-results-core.mjs";
import { getProLeagueTeamStyle, proLeagueTeamLogoSrc } from "../proleague/team-presentation.mjs";

test("maps only supported tournament pages to the editor", () => {
  assert.equal(tournamentEditorUrlForPath("/masters.html"), "/admin/?section=results-editor&eventKey=masters");
  assert.equal(
    tournamentEditorUrlForPath("/masters.html", "?view=qualifiers"),
    "/admin/?section=results-editor&eventKey=masters&view=qualifiers",
  );
  assert.equal(tournamentEditorUrlForPath("/masters.html", "?view=unknown"), "/admin/?section=results-editor&eventKey=masters");
  assert.equal(tournamentEditorUrlForPath("/championship"), "/admin/?section=results-editor&eventKey=championship");
  assert.equal(tournamentEditorUrlForPath("/proleague/index.html"), "/admin/?section=results-editor&eventKey=proleague");
  assert.equal(
    tournamentEditorUrlForPath("/proleague/index.html", "?season=7&stage=3"),
    "/admin/?section=results-editor&eventKey=proleague&season=7&stage=3",
  );
  assert.equal(tournamentEditorUrlForPath("/superleague/"), "/admin/?section=results-editor&eventKey=superleague");
  assert.equal(
    tournamentEditorUrlForPath("/superleague/", "?season=7&page=qualifiers"),
    "/admin/?section=results-editor&eventKey=superleague&season=7&view=qualifiers",
  );
  assert.equal(
    tournamentEditorUrlForPath("/worldopen/index.html", "?round=5"),
    "/admin/?section=results-editor&eventKey=worldopen&view=round-5",
  );
  assert.equal(
    tournamentEditorUrlForPath("/lightningcup/", "?view=results&region=wuhu-island"),
    "/admin/?section=results-editor&eventKey=lightningcup&view=wuhu-island",
  );
  assert.equal(tournamentEditorUrlForPath("/noptational.html"), "/admin/?section=results-editor&eventKey=noptational");
  assert.equal(
    tournamentEditorUrlForPath("/worldcup.html", "?year=2024&tab=bracket"),
    "/admin/?section=results-editor&eventKey=worldcup&year=2024&view=bracket-stage",
  );
  assert.equal(tournamentEditorUrlForPath("/index.html"), "");
  assert.equal(tournamentEditorUrlForUser("/masters.html", false), "");
  assert.equal(tournamentEditorUrlForUser("/masters.html", true), "/admin/?section=results-editor&eventKey=masters");
});

test("maps Super League seasons, tabs, and division styles", () => {
  assert.equal(superLeagueViewKey("Season 7"), "season-7");
  assert.equal(superLeagueViewKey(6), "season-6");
  assert.equal(superLeagueViewKey(5), "");
  assert.equal(superLeagueDivisionClass("1"), "editor-division-1");
  assert.equal(superLeagueDivisionClass("Division 2"), "editor-division-2");
  assert.equal(superLeagueDivisionClass("3"), "editor-division-3");
  assert.equal(superLeagueDivisionClass(""), "");
});

test("maps Pro League seasons and stages to editor view keys", () => {
  assert.equal(proLeagueViewKey(7, 3), "season-7-stage-3");
  assert.equal(proLeagueViewKey(7, "championship"), "season-7-championship");
  assert.equal(proLeagueViewKey(5), "season-5");
  assert.equal(proLeagueViewKey("2026-all-stars"), "2026-all-stars");
  assert.deepEqual(getProLeagueTeamStyle("Terrific Tigers"), { bg: "#fe6d01", fg: "#000000" });
  assert.equal(proLeagueTeamLogoSrc("Terrific Tigers"), "/proleague/logos/terrific-tigers.png");
});

test("selects a player filter token before Backspace removes it", () => {
  assert.deepEqual(playerFilterBackspaceState(["Aidan", "Ricardo"]), {
    armedName: "Ricardo",
    removeName: "",
  });
  assert.deepEqual(playerFilterBackspaceState(["Aidan", "Ricardo"], "ricardo"), {
    armedName: "",
    removeName: "Ricardo",
  });
});

test("keeps both player slots when a selected player is in a 1v1 matchup", () => {
  const rows = [
    { sourceRow: 2, playerName: "Aidan" },
    { sourceRow: 2, playerName: "Ricardo" },
    { sourceRow: 3, playerName: "Nick" },
    { sourceRow: 3, playerName: "Jon" },
  ];

  assert.equal(isEditorRowSelected(rows[0], new Map(), ["ricardo"], rows), true);
  assert.equal(isEditorRowSelected(rows[1], new Map(), ["ricardo"], rows), true);
  assert.equal(isEditorRowSelected(rows[2], new Map(), ["ricardo"], rows), false);
  assert.equal(isEditorRowSelected(rows[3], new Map(), ["ricardo"], rows), false);
});

test("orders filtered player rows by the selection input order", () => {
  const rows = [
    { playerName:"Aidan" },
    { playerName:"Nick" },
    { playerName:"Ricardo" },
  ];

  assert.deepEqual(
    orderEditorRowsByPlayerSelection(rows, new Map(), ["Ricardo", "Aidan"]).map((row) => row.playerName),
    ["Ricardo", "Aidan", "Nick"],
  );
});

test("reuses the dirty-state label for transient editor feedback", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("./tournament-results.html", import.meta.url), "utf8"),
    readFile(new URL("./tournament-results.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /id="editorStatus"/);
  assert.match(html, /id="editorDirtyCount" aria-live="polite"/);
  assert.match(script, /if\(editorMessage && tone === "success"\)[\s\S]+}, 2500\);/);
});

test("refreshes formula-backed values after a successful save", async () => {
  const script = await readFile(new URL("./tournament-results.js", import.meta.url), "utf8");

  assert.match(script, /async function refreshFormulaValuesAfterSave\(\)/);
  assert.match(script, /const formulaValuesRefreshed = await refreshFormulaValuesAfterSave\(\);[\s\S]+renderEditor\(\);/);
});

test("uses the server-authorized admin RPC for top-bar access", async () => {
  const calls = [];
  const client = {
    async rpc(functionName){
      calls.push(functionName);
      return { data: true, error: null };
    },
  };

  assert.equal(await getTournamentAdminFlag(client), true);
  assert.deepEqual(calls, ["is_tournament_result_admin"]);
  assert.equal(await getTournamentAdminFlag({ rpc: async () => ({ data: false, error: null }) }), false);
  assert.equal(await getTournamentAdminFlag({ rpc: async () => ({ data: null, error: new Error("denied") }) }), false);
});

test("parses quoted and normalized Google A1 ranges", () => {
  assert.deepEqual(parseA1Range("'Main Bracket'!A2:Z66"), {
    sheetName: "Main Bracket",
    startColumn: 1,
    startRow: 2,
    endColumn: 26,
    endRow: 66,
  });
  assert.equal(getCellValue([{ range: "Bracket!A1:C2", values: [["A", "B"], [1, 2, 3]] }], "Bracket", 3, 2), 3);
});

test("uses the public Noptational display-name line", () => {
  assert.equal(noptationalDisplayName("Display Name\nDiscordUsername"), "Display Name");
  assert.equal(noptationalDisplayName("\n  Display Name  \nDiscordUsername"), "Display Name");

  const [table] = buildEditorTables({ eventKey:"noptational", tables:[{
    key:"scores",
    source_range:"'Round Scores (2026)'!A1:J2",
    data_start_row:2,
    data_end_row:2,
    hide_context:true,
    hide_seed:true,
    header_groups:[{ label:"Classic", span:2 }, { label:"Resort", span:2 }],
    players:[{ name_column:"A", round_score_columns:["B", "C", "D", "E"] }],
  }] }, [{
    range:"'Round Scores (2026)'!A1:J2",
    values:[[], ["Display Name\nDiscordUsername", -1, -2, -3, -4]],
  }]);

  assert.equal(table.rows[0].playerName, "Display Name");
  assert.deepEqual(table.headerGroups, [{ label:"Classic", span:2 }, { label:"Resort", span:2 }]);
});

test("ties World Cup standings rows to their group context", () => {
  const [table] = buildEditorTables({ eventKey:"worldcup", tables:[{
    key:"group-standings",
    source_range:"'World Cup 2026'!A1:H8",
    data_start_row:3,
    data_end_row:8,
    context_block:{ column:"E", start_row:2, block_size:6 },
    row_filter:{ column:"E", nonempty:true, exclude_pattern:"^Group\\s" },
    players:[{ name_column:"E", round_score_columns:["F", "G", "H"] }],
  }] }, [{
    range:"'World Cup 2026'!A1:H8",
    values:[[], ["", "", "", "", "Group A"], ["", "", "", "", "USA", 3, 2, "1-0-0"]],
  }]);

  assert.deepEqual(table.rows[0].context, ["Group A"]);
  assert.deepEqual(table.rows[0].roundScores.map((cell) => cell.range), [
    "'World Cup 2026'!F3",
    "'World Cup 2026'!G3",
    "'World Cup 2026'!H3",
  ]);
});

test("builds player score rows from a source range subset", () => {
  const event = {
    tables: [{
      key: "main",
      label: "Main bracket",
      source_range: "'Bracket'!A1:I2",
      data_start_row: 2,
      data_end_row: 2,
      context_columns: ["A"],
      players: [{
        name_column: "B",
        round_score_columns: ["C", "D"],
        sudden_death_column: "E",
        result_column: "F",
      }],
    }],
  };
  const tables = buildEditorTables(event, [{
    range: "Bracket!A1:I2",
    values: [["Match", "Player", "R1", "R2", "SD", "Result"], ["Final", "Aidan", -2, -1, "", 2]],
  }]);

  assert.equal(tables[0].rows[0].playerName, "Aidan");
  assert.equal(tables[0].rows[0].roundScores[0].initialValue, "-2");
  assert.equal(tables[0].rows[0].suddenDeath.range, "'Bracket'!E2");
  assert.equal(tables[0].rows[0].result.initialValue, "2");
});

test("groups players from the same sheet row into one bracket matchup", () => {
  const rows = [
    { sourceRow:2, playerSlot:2, playerName:"Player 2" },
    { sourceRow:2, playerSlot:1, playerName:"Player 1" },
    { sourceRow:3, playerSlot:1, playerName:"Player 3" },
  ];
  assert.deepEqual(editorMatchups(rows).map((matchup) => ({
    sourceRow: matchup.sourceRow,
    players: matchup.players.map((row) => row.playerName),
  })), [
    { sourceRow:2, players:["Player 1", "Player 2"] },
    { sourceRow:3, players:["Player 3"] },
  ]);
});

test("uses Lightning Cup round IDs without the match ID", () => {
  assert.equal(bracketRoundLabel({ sourceRow:4, context:["1", "R64"] }), "R64");
  assert.equal(bracketRoundLabel({ sourceRow:64, context:["Final"] }), "Final");
});

test("identifies matchups containing a BYE player", () => {
  assert.equal(matchupHasBye({ players:[{ playerName:"Player 1" }, { playerName:" BYE " }] }), true);
  assert.equal(matchupHasBye({ players:[{ playerName:"Player 1" }, { playerName:"bye week" }] }), false);
});

test("builds Championship matchups with nine rounds and no sudden death", () => {
  const event = {
    eventKey:"championship",
    tables:[{
      key:"main-bracket",
      source_range:"'Bracket'!A2:Z3",
      data_start_row:3,
      data_end_row:3,
      context_columns:["A", "B"],
      players:[
        { seed_column:"C", name_column:"D", result_column:"E", round_score_columns:["F", "G", "H", "I", "J", "K", "L", "M", "N"] },
        { seed_column:"O", name_column:"P", result_column:"Q", round_score_columns:["R", "S", "T", "U", "V", "W", "X", "Y", "Z"] },
      ],
    }],
  };
  const row = Array(26).fill("");
  Object.assign(row, { 0:"57", 1:"QF", 3:"Player 1", 4:"3", 5:"-10", 15:"Player 2", 16:"1", 17:"-9" });
  const [table] = buildEditorTables(event, [{ range:"'Bracket'!A2:Z3", values:[Array(26).fill(""), row] }]);

  assert.equal(table.maxRoundCount, 9);
  assert.equal(table.hasSuddenDeath, false);
  assert.equal(table.rows.length, 2);
  assert.equal(editorMatchups(table.rows).length, 1);
  assert.deepEqual(table.rows.map((player) => player.result.range), ["'Bracket'!E3", "'Bracket'!Q3"]);
});

test("preserves editor tab metadata and excludes non-player sheet rows", () => {
  const event = {
    tables: [{
      key: "stage-one",
      label: "Player scores",
      group_key: "stage-1",
      group_label: "Stage 1",
      source_range: "'Season 7, Stage 1'!B3:S10",
      data_start_row: 5,
      data_end_row: 10,
      excluded_rows: [9],
      players: [{ name_column: "C", round_score_columns: ["L", "M"] }],
    }],
  };
  const tables = buildEditorTables(event, [{
    range: "'Season 7, Stage 1'!B3:S10",
    values: Array.from({ length: 8 }, (_, index) => {
      const row = Array(18).fill("");
      row[1] = `Player ${index + 3}`;
      return row;
    }),
  }]);

  assert.equal(tables[0].groupKey, "stage-1");
  assert.equal(tables[0].groupLabel, "Stage 1");
  assert.deepEqual(tables[0].rows.map((row) => row.sourceRow), [5, 6, 7, 8, 10]);
  assert.equal(tables[0].hasResult, false);
});

test("builds horizontally paired rows from offset sheet rows", () => {
  const [table] = buildEditorTables({ tables:[{
    key:"group-games",
    source_range:"'World Cup 2025'!E1:K8",
    data_start_row:2,
    data_end_row:8,
    included_rows:[2, 5, 8],
    context_block:{ column:"E", start_row:2, block_size:6 },
    matchup_layout:true,
    round_labels:["Pts"],
    players:[
      { name_column:"J", round_score_columns:["K"] },
      { name_column:"J", round_score_columns:["K"], row_offset:1 },
    ],
  }] }, [{
    range:"'World Cup 2025'!E1:K8",
    values:[
      [], ["Group A", "", "", "", "", "USA A", 2], ["USA A", "", "", "", "", "USA B", 0],
      [], ["USA C", "", "", "", "", "USA C", 1], ["USA D", "", "", "", "", "USA D", 1],
      [], ["Group B", "", "", "", "", "Taiwan", 2],
    ],
  }]);

  assert.equal(table.matchupLayout, true);
  assert.deepEqual(table.rows.map((row) => row.sourceRow), [2, 2, 5, 5, 8, 8]);
  assert.deepEqual(table.rows.slice(0, 2).map((row) => [row.context[0], row.playerName, row.roundScores[0].range]), [
    ["Group A", "USA A", "'World Cup 2025'!K2"],
    ["Group A", "USA B", "'World Cup 2025'!K3"],
  ]);
  assert.equal(table.rows[0].roundScores[0].label, "Pts");
});

test("builds World Open player-name inputs from each round's Field column", () => {
  const [table] = buildEditorTables({ eventKey:"worldopen", tables:[{
    key:"round-1",
    source_range:"'2026 Results'!A1:F4",
    data_start_row:2,
    data_end_row:3,
    player_options:{ column:"A", start_row:2, end_row:4 },
    hide_context:true,
    hide_seed:true,
    matchup_layout:true,
    players:[
      { name_column:"C", editable_name:true, result_column:"D" },
      { name_column:"E", editable_name:true, result_column:"F" },
    ],
  }] }, [{
    range:"'2026 Results'!A1:F4",
    values:[
      ["Field", "", "Player 1", "Score", "Player 2", "Score"],
      ["Aidan", "", "Aidan", 2, "Ricardo", 0],
      ["Ricardo", "", "Nick", 1, "Jon", 2],
      ["Nick"],
    ],
  }]);

  assert.deepEqual(table.playerOptions, ["Aidan", "Ricardo", "Nick"]);
  assert.deepEqual(table.rows.map((row) => row.nameCell.range), [
    "'2026 Results'!C2", "'2026 Results'!E2", "'2026 Results'!C3", "'2026 Results'!E3",
  ]);
  const currentValues = new Map(table.rows.flatMap((row) => row.editableCells.map((cell) => [cell.range, cell.initialValue])));
  currentValues.set("'2026 Results'!C2", "Nick");
  assert.deepEqual(buildUpdates([table], currentValues), [
    { range:"'2026 Results'!C2:C2", values:[["Nick"]], playerName:"Nick", headers:["Player"] },
  ]);
});

test("filters and strides template-discovered tournament rows", () => {
  const [table] = buildEditorTables({ tables:[{
    key:"standings",
    source_range:"'World Cup 2026'!E1:H8",
    data_start_row:2,
    data_end_row:8,
    row_stride:2,
    row_filter:{ column:"E", nonempty:true, exclude_pattern:"^Group\\s" },
    players:[{ name_column:"E", round_score_columns:["F"] }],
  }] }, [{
    range:"'World Cup 2026'!E1:H8",
    values:[[], ["Group A"], [], ["USA", 3], [], [""], [], ["Canada", 1]],
  }]);

  assert.deepEqual(table.rows.map((row) => [row.sourceRow, row.playerName]), [[4, "USA"], [8, "Canada"]]);
});

test("uses Super League tab metadata within a season view", () => {
  const [table] = buildEditorTables({ eventKey:"superleague", tables:[{
    key:"season-7-qualifier-winners",
    group_key:"season-7",
    group_label:"Season 7",
    tab_key:"qualifier-winners",
    tab_label:"Qualifiers - Winners",
    season_value:7,
    source_range:"'S7 Winners Bracket'!A3:H5",
    data_start_row:5,
    data_end_row:5,
    context_columns:["A", "B"],
    players:[
      { seed_column:"C", name_column:"D", round_score_columns:[], result_column:"E" },
      { seed_column:"F", name_column:"G", round_score_columns:[], result_column:"H" },
    ],
  }] }, [{ range:"'S7 Winners Bracket'!A3:H5", values:[[], [], ["1", "R64", "1", "A", "2", "2", "B", "0"]] }]);

  assert.equal(table.groupKey, "qualifier-winners");
  assert.equal(table.groupLabel, "Qualifiers - Winners");
  assert.equal(table.seasonValue, 7);
  assert.equal(editorMatchups(table.rows).length, 1);
});

test("builds read-only Super League formula cells outside editable cells", () => {
  const [table] = buildEditorTables({ eventKey:"superleague", tables:[{
    key:"season-7-season",
    source_range:"'Season 7'!A2:L2",
    data_start_row:2,
    data_end_row:2,
    players:[
      {
        name_column:"C",
        round_score_columns:["D"],
        formula_columns:[
          { column:"E", label:"W" },
          { column:"F", label:"L" },
          { column:"G", label:"Dif" },
          { column:"H", label:"M" },
        ],
      },
      {
        name_column:"I",
        round_score_columns:["J"],
        formula_columns:[
          { column:"K", label:"W" },
          { column:"L", label:"L" },
        ],
      },
    ],
  }] }, [{
    range:"'Season 7'!A2:L2",
    values:[["", "", "Player 1", -10, 1, 0, 4, 2, "Player 2", -8, 0, 1]],
  }]);

  assert.deepEqual(table.rows[0].formulaCells.map((cell) => [cell.label, cell.initialValue]), [
    ["W", "1"], ["L", "0"], ["Dif", "4"], ["M", "2"],
  ]);
  assert.equal(table.maxFormulaCount, 4);
  assert.deepEqual(table.rows[0].editableCells.map((cell) => cell.range), ["'Season 7'!D2"]);
});

test("builds Pro League team presentation and reserves blank individual-player rows", () => {
  const event = {
    tables: [{
      key: "season-7-stage-3-scores",
      group_key: "season-7-stage-3",
      season_value: 7,
      stage_value: 3,
      source_range: "'Season 7, Stage 3'!A3:S66",
      data_start_row: 5,
      data_end_row: 66,
      excluded_rows: [9, 14, 19, 24, 29, 34, 39, 44, 49, 54, 59, 64, 65],
      hide_context: true,
      hide_seed: true,
      round_label_style: "week-round",
      team_block: { header_start_row: 4, block_size: 5, last_player_row: 63, team_name_column: "C" },
      add_player: { start_row: 66, end_row: 66, name_column: "C" },
      players: [{ name_column: "C", round_score_columns: ["L", "M", "N", "O", "P", "Q", "R", "S"] }],
    }],
  };
  const values = Array.from({ length: 64 }, () => Array(19).fill(""));
  values[1][2] = "Terrific Tigers";
  values[2][2] = "Aidan";
  const tables = buildEditorTables(event, [{ range: "'Season 7, Stage 3'!A3:S66", values }]);
  const teamPlayer = tables[0].rows.find((row) => row.sourceRow === 5);
  const blankSlot = tables[0].rows.find((row) => row.sourceRow === 66);
  const currentValues = new Map(tables[0].rows.flatMap((row) => row.editableCells.map((cell) => [cell.range, cell.initialValue])));

  assert.equal(tables[0].hideContext, true);
  assert.equal(teamPlayer.teamName, "Terrific Tigers");
  assert.deepEqual(teamPlayer.roundScores.map((cell) => cell.label), ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"]);
  assert.equal(isEditorRowVisible(blankSlot, currentValues), false);
  assert.equal(nextBlankPlayerRow(tables[0], currentValues), blankSlot);
  assert.equal(addedPlayerRowSaveState(blankSlot, currentValues), "empty");
  currentValues.set("'Season 7, Stage 3'!L66", "-4");
  assert.equal(addedPlayerRowSaveState(blankSlot, currentValues), "missing-name");
  currentValues.set("'Season 7, Stage 3'!L66", "");
  currentValues.set("'Season 7, Stage 3'!C66", "New Player");
  assert.equal(addedPlayerRowSaveState(blankSlot, currentValues), "ready");
  assert.equal(currentValues.get("'Season 7, Stage 3'!C66"), "New Player");
  assert.equal(isEditorRowVisible(blankSlot, currentValues), true);
  assert.deepEqual(editorPlayerOptions(tables, currentValues), ["Aidan", "New Player"]);
  assert.equal(isEditorRowSelected(teamPlayer, currentValues, ["new player"]), false);
  assert.equal(isEditorRowSelected(blankSlot, currentValues, ["new player"]), true);
  currentValues.set("'Season 7, Stage 3'!L66", "-4");
  assert.deepEqual(buildUpdates(tables, currentValues), [
    { range: "'Season 7, Stage 3'!C66:C66", values: [["New Player"]], playerName:"New Player", headers:["Player"] },
    { range: "'Season 7, Stage 3'!L66:L66", values: [[-4]], playerName:"New Player", headers:["1-1"] },
  ]);
  assert.equal(nextBlankPlayerRow(tables[0], currentValues), null);
});

test("sends only consecutive dirty cells so stale neighbors are not overwritten", () => {
  const event = {
    tables: [{
      key: "main",
      label: "Main bracket",
      source_range: "'Bracket'!A1:F2",
      data_start_row: 2,
      data_end_row: 2,
      context_columns: ["A"],
      players: [{ name_column: "B", round_score_columns: ["C", "D"], sudden_death_column: "E", result_column: "F" }],
    }],
  };
  const tables = buildEditorTables(event, [{
    range: "Bracket!A1:F2",
    values: [["Match", "Player", "R1", "R2", "SD", "Result"], ["Final", "Aidan", 1, 2, "", 3]],
  }]);
  const values = new Map(tables[0].rows[0].editableCells.map((cell) => [cell.range, cell.initialValue]));
  values.set("'Bracket'!C2", "-1");
  values.set("'Bracket'!D2", "-2");
  values.set("'Bracket'!F2", "4&3");

  assert.deepEqual(buildUpdates(tables, values), [
    { range: "'Bracket'!C2:D2", values: [[-1, -2]], playerName:"Aidan", headers:["R1", "R2"] },
    { range: "'Bracket'!F2:F2", values: [["4&3"]], playerName:"Aidan", headers:["Result"] },
  ]);
});

test("coerces numeric scores while retaining match-play text", () => {
  assert.equal(coerceScoreValue(" -3 "), -3);
  assert.equal(coerceScoreValue(""), "");
  assert.equal(coerceScoreValue("4&3"), "4&3");
});
