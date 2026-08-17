const EVENT_KEYS_BY_PATH = new Map([
  ["/masters", "masters"],
  ["/masters.html", "masters"],
  ["/championship", "championship"],
  ["/championship.html", "championship"],
  ["/proleague", "proleague"],
  ["/proleague/index.html", "proleague"],
  ["/superleague", "superleague"],
  ["/superleague/index.html", "superleague"],
]);

function normalizeText(value){
  return value === null || value === undefined ? "" : String(value);
}

export function columnNumber(letters){
  const value = String(letters || "").trim().toUpperCase();
  if(!/^[A-Z]+$/.test(value)) throw new Error("Invalid spreadsheet column.");
  return [...value].reduce((total, letter) => (total * 26) + letter.charCodeAt(0) - 64, 0);
}

export function columnLetters(number){
  let value = Number(number);
  if(!Number.isInteger(value) || value < 1) throw new Error("Invalid spreadsheet column number.");

  let letters = "";
  while(value > 0){
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

export function parseA1Range(range){
  const match = String(range || "").trim().match(
    /^(?:'((?:[^']|'')+)'|([^'!]+))!([A-Za-z]+)(\d+)?(?::([A-Za-z]+)(\d+)?)?$/,
  );
  if(!match) throw new Error(`Invalid A1 range: ${range}`);

  const sheetName = match[1] ? match[1].replace(/''/g, "'") : match[2].trim();
  const startColumn = columnNumber(match[3]);
  const startRow = match[4] ? Number(match[4]) : 1;
  const endColumn = columnNumber(match[5] || match[3]);
  const endRow = match[6]
    ? Number(match[6])
    : (match[5] ? Number.POSITIVE_INFINITY : startRow);

  if(!sheetName || endColumn < startColumn || endRow < startRow){
    throw new Error(`Invalid A1 range: ${range}`);
  }

  return { sheetName, startColumn, startRow, endColumn, endRow };
}

function quotedSheetName(sheetName){
  return `'${String(sheetName).replaceAll("'", "''")}'`;
}

export function a1Cell(sheetName, column, row){
  return `${quotedSheetName(sheetName)}!${columnLetters(column)}${row}`;
}

export function tournamentEditorUrlForPath(pathname, search = ""){
  const cleanPath = String(pathname || "").replace(/\/+$/, "") || "/";
  const eventKey = EVENT_KEYS_BY_PATH.get(cleanPath);
  if(!eventKey) return "";

  const editorParams = new URLSearchParams({ eventKey });
  if(eventKey === "proleague"){
    const publicParams = new URLSearchParams(search);
    ["season", "stage"].forEach((key) => {
      const value = publicParams.get(key)?.trim();
      if(value) editorParams.set(key, value);
    });
  }
  return `/admin/tournament-results.html?${editorParams}`;
}

export function tournamentEditorUrlForUser(pathname, isAdmin, search = ""){
  return isAdmin ? tournamentEditorUrlForPath(pathname, search) : "";
}

export function proLeagueViewKey(season, stage = null){
  const seasonText = normalizeText(season).trim().toLowerCase();
  if(!seasonText) return "";
  if(seasonText === "2026-all-stars") return seasonText;
  if(!/^\d+$/.test(seasonText)) return "";
  const stageText = normalizeText(stage).trim().toLowerCase();
  return stageText ? `season-${seasonText}-${stageText === "championship" ? stageText : `stage-${stageText}`}` : `season-${seasonText}`;
}

export function weekRoundLabel(roundIndex){
  const index = Number(roundIndex);
  return `${Math.floor(index / 2) + 1}-${(index % 2) + 1}`;
}

export async function getTournamentAdminFlag(client){
  try{
    const { data, error } = await client.rpc("is_tournament_result_admin");
    return !error && data === true;
  }catch{
    return false;
  }
}

export function getCellValue(valueRanges, sheetName, column, row){
  for(const valueRange of Array.isArray(valueRanges) ? valueRanges : []){
    let parsed;
    try{
      parsed = parseA1Range(valueRange?.range);
    }catch{
      continue;
    }
    if(
      parsed.sheetName !== sheetName
      || column < parsed.startColumn
      || column > parsed.endColumn
      || row < parsed.startRow
      || row > parsed.endRow
    ) continue;

    return valueRange?.values?.[row - parsed.startRow]?.[column - parsed.startColumn] ?? "";
  }
  return "";
}

function readColumn(valueRanges, sheetName, column, row){
  return normalizeText(getCellValue(valueRanges, sheetName, columnNumber(column), row));
}

function scoreCell(valueRanges, sheetName, column, row, type, label){
  const columnIndex = columnNumber(column);
  const value = readColumn(valueRanges, sheetName, column, row);
  return {
    type,
    label,
    column,
    columnIndex,
    row,
    range: a1Cell(sheetName, columnIndex, row),
    initialValue: value,
  };
}

function teamNameForRow(table, valueRanges, sheetName, row){
  const block = table.team_block;
  if(!block) return "";
  const headerStartRow = Number(block.header_start_row);
  const blockSize = Number(block.block_size);
  const lastPlayerRow = Number(block.last_player_row);
  if(!Number.isInteger(headerStartRow) || !Number.isInteger(blockSize) || blockSize < 2 || row <= headerStartRow || row > lastPlayerRow) return "";
  const headerRow = headerStartRow + Math.floor((row - headerStartRow - 1) / blockSize) * blockSize;
  return readColumn(valueRanges, sheetName, block.team_name_column, headerRow);
}

export function buildEditorTables(event, valueRanges){
  return (Array.isArray(event?.tables) ? event.tables : []).map((table) => {
    const tableRange = parseA1Range(table.source_range);
    const rows = [];
    const excludedRows = new Set((table.excluded_rows || []).map(Number));

    for(let row = Number(table.data_start_row); row <= Number(table.data_end_row); row += 1){
      if(excludedRows.has(row)) continue;
      const context = (table.context_columns || [])
        .map((column) => readColumn(valueRanges, tableRange.sheetName, column, row))
        .filter((value) => value.trim());

      (table.players || []).forEach((player, playerIndex) => {
        const playerName = readColumn(valueRanges, tableRange.sheetName, player.name_column, row);
        const roundScores = (player.round_score_columns || []).map((column, roundIndex) => (
          scoreCell(
            valueRanges,
            tableRange.sheetName,
            column,
            row,
            "round",
            table.round_label_style === "week-round" ? weekRoundLabel(roundIndex) : `R${roundIndex + 1}`,
          )
        ));
        const suddenDeath = player.sudden_death_column
          ? scoreCell(valueRanges, tableRange.sheetName, player.sudden_death_column, row, "sudden-death", "SD")
          : null;
        const result = player.result_column
          ? scoreCell(valueRanges, tableRange.sheetName, player.result_column, row, "result", "Result")
          : null;
        const addPlayer = table.add_player || null;
        const isAddPlayerSlot = playerIndex === 0
          && row >= Number(addPlayer?.start_row)
          && row <= Number(addPlayer?.end_row);
        const nameCell = isAddPlayerSlot
          ? scoreCell(valueRanges, tableRange.sheetName, addPlayer.name_column, row, "player-name", "Player")
          : null;
        const editableCells = [nameCell, ...roundScores, suddenDeath, result].filter(Boolean);

        rows.push({
          key: `${table.key}-${row}-${playerIndex + 1}`,
          sourceRow: row,
          playerSlot: playerIndex + 1,
          context,
          seed: player.seed_column
            ? readColumn(valueRanges, tableRange.sheetName, player.seed_column, row)
            : "",
          playerName,
          teamName: table.name_is_team
            ? playerName
            : teamNameForRow(table, valueRanges, tableRange.sheetName, row),
          nameCell,
          isAddPlayerSlot,
          roundScores,
          suddenDeath,
          result,
          editableCells,
        });
      });
    }

    return {
      key: table.key,
      label: table.label || table.key,
      groupKey: table.group_key || "",
      groupLabel: table.group_label || "",
      seasonValue: table.season_value ?? null,
      seasonLabel: table.season_label || "",
      stageValue: table.stage_value ?? null,
      sheetName: tableRange.sheetName,
      hideContext: Boolean(table.hide_context),
      hideSeed: Boolean(table.hide_seed),
      roundLabelStyle: table.round_label_style || "",
      canAddPlayers: Boolean(table.add_player),
      maxRoundCount: Math.max(0, ...rows.map((row) => row.roundScores.length)),
      hasSuddenDeath: rows.some((row) => row.suddenDeath),
      hasResult: rows.some((row) => row.result),
      rows,
    };
  });
}

function currentCellValue(cell, currentValues){
  return cell ? normalizeText(currentValues.get(cell.range) ?? cell.initialValue) : "";
}

export function isEditorRowVisible(row, currentValues){
  if(!row?.isAddPlayerSlot) return true;
  return Boolean(
    currentCellValue(row.nameCell, currentValues).trim()
    || row.editableCells.some((cell) => cell.type !== "player-name" && currentCellValue(cell, currentValues).trim()),
  );
}

export function addPlayerToFirstBlankRow(table, playerName, currentValues){
  const name = normalizeText(playerName).trim();
  if(!name) throw new Error("Enter a player name.");
  const lowerName = name.toLowerCase();
  const duplicate = table.rows.some((row) => currentCellValue(row.nameCell, currentValues).trim().toLowerCase() === lowerName || row.playerName.trim().toLowerCase() === lowerName);
  if(duplicate) throw new Error("That player is already listed in this period.");

  const row = table.rows.find((candidate) => candidate.isAddPlayerSlot && !isEditorRowVisible(candidate, currentValues));
  if(!row?.nameCell) return null;
  currentValues.set(row.nameCell.range, name);
  return row;
}

export function coerceScoreValue(value){
  const text = String(value ?? "").trim();
  if(!text) return "";
  if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return Number(text);
  return text;
}

function contiguousRuns(cells){
  const sorted = [...cells].sort((left, right) => left.columnIndex - right.columnIndex);
  const runs = [];
  for(const cell of sorted){
    const run = runs.at(-1);
    if(!run || cell.columnIndex !== run.at(-1).columnIndex + 1){
      runs.push([cell]);
    }else{
      run.push(cell);
    }
  }
  return runs;
}

export function buildUpdates(editorTables, currentValues){
  const updates = [];
  for(const table of editorTables || []){
    for(const row of table.rows || []){
      for(const run of contiguousRuns(row.editableCells || [])){
        const dirtyCells = run.filter((cell) => currentValues.get(cell.range) !== cell.initialValue);
        for(const dirtyRun of contiguousRuns(dirtyCells)){
          const start = dirtyRun[0];
          const end = dirtyRun.at(-1);
          updates.push({
            range: `${quotedSheetName(table.sheetName)}!${start.column}${start.row}:${end.column}${end.row}`,
            values: [dirtyRun.map((cell) => coerceScoreValue(currentValues.get(cell.range)))],
          });
        }
      }
    }
  }
  return updates;
}
