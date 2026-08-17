const EVENT_KEYS_BY_PATH = new Map([
  ["/masters", "masters"],
  ["/masters.html", "masters"],
  ["/championship", "championship"],
  ["/championship.html", "championship"],
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

export function tournamentEditorUrlForPath(pathname){
  const cleanPath = String(pathname || "").replace(/\/+$/, "") || "/";
  const eventKey = EVENT_KEYS_BY_PATH.get(cleanPath);
  return eventKey ? `/admin/tournament-results.html?eventKey=${encodeURIComponent(eventKey)}` : "";
}

export function tournamentEditorUrlForUser(pathname, isAdmin){
  return isAdmin ? tournamentEditorUrlForPath(pathname) : "";
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

export function buildEditorTables(event, valueRanges){
  return (Array.isArray(event?.tables) ? event.tables : []).map((table) => {
    const tableRange = parseA1Range(table.source_range);
    const rows = [];

    for(let row = Number(table.data_start_row); row <= Number(table.data_end_row); row += 1){
      const context = (table.context_columns || [])
        .map((column) => readColumn(valueRanges, tableRange.sheetName, column, row))
        .filter((value) => value.trim());

      (table.players || []).forEach((player, playerIndex) => {
        const roundScores = (player.round_score_columns || []).map((column, roundIndex) => (
          scoreCell(valueRanges, tableRange.sheetName, column, row, "round", `R${roundIndex + 1}`)
        ));
        const suddenDeath = player.sudden_death_column
          ? scoreCell(valueRanges, tableRange.sheetName, player.sudden_death_column, row, "sudden-death", "SD")
          : null;
        const result = player.result_column
          ? scoreCell(valueRanges, tableRange.sheetName, player.result_column, row, "result", "Result")
          : null;
        const editableCells = [...roundScores, suddenDeath, result].filter(Boolean);

        rows.push({
          key: `${table.key}-${row}-${playerIndex + 1}`,
          sourceRow: row,
          playerSlot: playerIndex + 1,
          context,
          seed: player.seed_column
            ? readColumn(valueRanges, tableRange.sheetName, player.seed_column, row)
            : "",
          playerName: readColumn(valueRanges, tableRange.sheetName, player.name_column, row),
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
      sheetName: tableRange.sheetName,
      maxRoundCount: Math.max(0, ...rows.map((row) => row.roundScores.length)),
      hasSuddenDeath: rows.some((row) => row.suddenDeath),
      rows,
    };
  });
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
