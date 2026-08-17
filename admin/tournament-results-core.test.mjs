import test from "node:test";
import assert from "node:assert/strict";
import {
  addedPlayerRowSaveState,
  buildEditorTables,
  buildUpdates,
  coerceScoreValue,
  editorPlayerOptions,
  editorMatchups,
  getCellValue,
  getTournamentAdminFlag,
  isEditorRowSelected,
  isEditorRowVisible,
  nextBlankPlayerRow,
  parseA1Range,
  playerFilterBackspaceState,
  proLeagueViewKey,
  tournamentEditorUrlForPath,
  tournamentEditorUrlForUser,
} from "./tournament-results-core.mjs";
import { getProLeagueTeamStyle, proLeagueTeamLogoSrc } from "../proleague/team-presentation.mjs";

test("maps only supported tournament pages to the editor", () => {
  assert.equal(tournamentEditorUrlForPath("/masters.html"), "/admin/tournament-results.html?eventKey=masters");
  assert.equal(
    tournamentEditorUrlForPath("/masters.html", "?view=qualifiers"),
    "/admin/tournament-results.html?eventKey=masters&view=qualifiers",
  );
  assert.equal(tournamentEditorUrlForPath("/masters.html", "?view=unknown"), "/admin/tournament-results.html?eventKey=masters");
  assert.equal(tournamentEditorUrlForPath("/championship"), "/admin/tournament-results.html?eventKey=championship");
  assert.equal(tournamentEditorUrlForPath("/proleague/index.html"), "/admin/tournament-results.html?eventKey=proleague");
  assert.equal(
    tournamentEditorUrlForPath("/proleague/index.html", "?season=7&stage=3"),
    "/admin/tournament-results.html?eventKey=proleague&season=7&stage=3",
  );
  assert.equal(tournamentEditorUrlForPath("/superleague/"), "/admin/tournament-results.html?eventKey=superleague");
  assert.equal(tournamentEditorUrlForPath("/index.html"), "");
  assert.equal(tournamentEditorUrlForUser("/masters.html", false), "");
  assert.equal(tournamentEditorUrlForUser("/masters.html", true), "/admin/tournament-results.html?eventKey=masters");
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

test("groups Masters players from the same sheet row into one matchup", () => {
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
    { range: "'Season 7, Stage 3'!C66:C66", values: [["New Player"]] },
    { range: "'Season 7, Stage 3'!L66:L66", values: [[-4]] },
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
    { range: "'Bracket'!C2:D2", values: [[-1, -2]] },
    { range: "'Bracket'!F2:F2", values: [["4&3"]] },
  ]);
});

test("coerces numeric scores while retaining match-play text", () => {
  assert.equal(coerceScoreValue(" -3 "), -3);
  assert.equal(coerceScoreValue(""), "");
  assert.equal(coerceScoreValue("4&3"), "4&3");
});
