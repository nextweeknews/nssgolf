import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Tournament GPI requests only its public run columns", async () => {
  const html = await readFile(new URL("../gpi.html", import.meta.url), "utf8");
  const tournamentConfig = html.match(
    /tournament:\s*\{[\s\S]*?runTable:\s*"internal_tournament_gpi_runs"[\s\S]*?runSelect:\s*"([^"]+)"/,
  );

  assert.ok(tournamentConfig, "Tournament GPI configuration was not found");
  const selectedColumns = tournamentConfig[1].split(",").map((column) => column.trim());
  assert.ok(selectedColumns.includes("latest_match_at"));
  assert.ok(!selectedColumns.includes("config"), "private tournament run config must not be requested");
});
