import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditorTables,
  buildUpdates,
  coerceScoreValue,
  getCellValue,
  getTournamentAdminFlag,
  parseA1Range,
  tournamentEditorUrlForPath,
  tournamentEditorUrlForUser,
} from "./tournament-results-core.mjs";

test("maps only supported tournament pages to the editor", () => {
  assert.equal(tournamentEditorUrlForPath("/masters.html"), "/admin/tournament-results.html?eventKey=masters");
  assert.equal(tournamentEditorUrlForPath("/championship"), "/admin/tournament-results.html?eventKey=championship");
  assert.equal(tournamentEditorUrlForPath("/index.html"), "");
  assert.equal(tournamentEditorUrlForUser("/masters.html", false), "");
  assert.equal(tournamentEditorUrlForUser("/masters.html", true), "/admin/tournament-results.html?eventKey=masters");
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
