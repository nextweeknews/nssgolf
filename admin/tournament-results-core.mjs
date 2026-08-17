const EVENT_KEYS_BY_PATH = new Map([
  ["/masters", "masters"],
  ["/masters.html", "masters"],
  ["/championship", "championship"],
  ["/championship.html", "championship"],
  ["/proleague", "proleague"],
  ["/proleague/index.html", "proleague"],
  ["/superleague", "superleague"],
  ["/superleague/index.html", "superleague"],
  ["/worldopen", "worldopen"],
  ["/worldopen/index.html", "worldopen"],
  ["/lightningcup", "lightningcup"],
  ["/lightningcup/index.html", "lightningcup"],
  ["/noptational", "noptational"],
  ["/noptational.html", "noptational"],
  ["/worldcup", "worldcup"],
  ["/worldcup.html", "worldcup"],
]);

function normalizeText(value){
  return value === null || value === undefined ? "" : String(value);
}

export function noptationalDisplayName(value){
  return normalizeText(value)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean) || "";
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
  if(eventKey === "masters"){
    const view = new URLSearchParams(search).get("view")?.trim();
    if(["bracket", "qualifiers"].includes(view)) editorParams.set("view", view);
  }else if(eventKey === "proleague"){
    const publicParams = new URLSearchParams(search);
    ["season", "stage"].forEach((key) => {
      const value = publicParams.get(key)?.trim();
      if(value) editorParams.set(key, value);
    });
  }else if(eventKey === "superleague"){
    const publicParams = new URLSearchParams(search);
    const season = publicParams.get("season")?.trim();
    const page = publicParams.get("page")?.trim();
    if(/^[67]$/.test(season || "")) editorParams.set("season", season);
    if(["season", "qualifiers", "promotions"].includes(page)) editorParams.set("view", page);
  }else if(eventKey === "worldopen"){
    const round = Number(new URLSearchParams(search).get("round"));
    if(round >= 1 && round <= 7) editorParams.set("view", `round-${round}`);
  }else if(eventKey === "lightningcup"){
    const region = new URLSearchParams(search).get("region")?.trim();
    if(["wii-plaza", "wuhu-island", "wedge-island", "spocco-square", "finals"].includes(region)){
      editorParams.set("view", region);
    }
  }else if(eventKey === "worldcup"){
    const publicParams = new URLSearchParams(search);
    const year = publicParams.get("year")?.trim();
    const tab = publicParams.get("tab")?.trim();
    if(/^20\d{2}$/.test(year || "")) editorParams.set("year", year);
    if(tab === "group") editorParams.set("view", "group-stage");
    if(tab === "bracket") editorParams.set("view", "bracket-stage");
  }
  return `/admin/?section=results-editor&${editorParams}`;
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

export function superLeagueViewKey(season){
  const seasonText = normalizeText(season).trim().match(/(?:season\s*)?([67])$/i)?.[1] || "";
  return seasonText ? `season-${seasonText}` : "";
}

export function superLeagueDivisionClass(value){
  const division = normalizeText(value).trim().match(/(?:division\s*)?([123])$/i)?.[1];
  return division ? `editor-division-${division}` : "";
}

export async function retryEditorRead(read){
  try{
    return await read();
  }catch{
    return read();
  }
}

export function weekRoundLabel(roundIndex){
  const index = Number(roundIndex);
  return `${Math.floor(index / 2) + 1}-${(index % 2) + 1}`;
}

export function bracketRoundLabel(row){
  const context = Array.isArray(row?.context) ? row.context : [];
  return context.find((value) => /^(?:R\d+|QF|SF|Final|3rd)$/i.test(normalizeText(value).trim()))
    || context.join(" · ")
    || `Sheet row ${row?.sourceRow || ""}`.trim();
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
    const includedRows = new Set((table.included_rows || []).map(Number));

    const rowStride = Math.max(1, Number(table.row_stride) || 1);
    for(let row = Number(table.data_start_row); row <= Number(table.data_end_row); row += rowStride){
      if(excludedRows.has(row) || (includedRows.size && !includedRows.has(row))) continue;
      if(table.row_filter){
        const filterValue = readColumn(valueRanges, tableRange.sheetName, table.row_filter.column, row).trim();
        if(table.row_filter.nonempty && !filterValue) continue;
        if(table.row_filter.exclude_pattern && new RegExp(table.row_filter.exclude_pattern, "i").test(filterValue)) continue;
      }
      const contextRow = table.context_block
        ? Number(table.context_block.start_row) + Math.floor((row - Number(table.context_block.start_row)) / Number(table.context_block.block_size)) * Number(table.context_block.block_size)
        : row;
      const contextColumns = table.context_block?.column ? [table.context_block.column] : (table.context_columns || []);
      const context = contextColumns
        .map((column) => readColumn(valueRanges, tableRange.sheetName, column, contextRow))
        .filter((value) => value.trim());

      (table.players || []).forEach((player, playerIndex) => {
        const playerRow = row + Number(player.row_offset || 0);
        const rawPlayerName = readColumn(valueRanges, tableRange.sheetName, player.name_column, playerRow);
        const playerName = event?.eventKey === "noptational"
          ? noptationalDisplayName(rawPlayerName)
          : rawPlayerName;
        const roundScores = (player.round_score_columns || []).map((column, roundIndex) => (
          scoreCell(
            valueRanges,
            tableRange.sheetName,
            column,
            playerRow,
            "round",
            table.round_labels?.[roundIndex]
              || (table.round_label_style === "week-round" ? weekRoundLabel(roundIndex) : `R${roundIndex + 1}`),
          )
        ));
        const suddenDeath = player.sudden_death_column
          ? scoreCell(valueRanges, tableRange.sheetName, player.sudden_death_column, playerRow, "sudden-death", "SD")
          : null;
        const result = player.result_column
          ? scoreCell(valueRanges, tableRange.sheetName, player.result_column, playerRow, "result", "Result")
          : null;
        const formulaCells = (player.formula_columns || []).map((formula) => {
          const column = normalizeText(formula?.column).trim();
          return {
            type:"formula",
            label:normalizeText(formula?.label).trim(),
            column,
            initialValue:readColumn(valueRanges, tableRange.sheetName, column, playerRow),
          };
        });
        const addPlayer = table.add_player || null;
        const isAddPlayerSlot = playerIndex === 0
          && row >= Number(addPlayer?.start_row)
          && row <= Number(addPlayer?.end_row);
        const nameCell = player.editable_name || isAddPlayerSlot
          ? scoreCell(
              valueRanges,
              tableRange.sheetName,
              isAddPlayerSlot ? addPlayer.name_column : player.name_column,
              playerRow,
              "player-name",
              "Player",
            )
          : null;
        const editableCells = [nameCell, ...roundScores, suddenDeath, result].filter(Boolean);

        rows.push({
          key: `${table.key}-${row}-${playerIndex + 1}`,
          sourceRow: row,
          playerSlot: playerIndex + 1,
          context,
          seed: player.seed_column
            ? readColumn(valueRanges, tableRange.sheetName, player.seed_column, playerRow)
            : "",
          playerName,
          teamName: table.name_is_team
            ? playerName
            : teamNameForRow(table, valueRanges, tableRange.sheetName, row),
          nameCell,
          isAddPlayerSlot,
          roundScores,
          formulaCells,
          suddenDeath,
          result,
          editableCells,
        });
      });
    }

    const mastersGroup = event?.eventKey === "masters"
      ? (table.key === "main-bracket" ? { key:"bracket", label:"Bracket" } : { key:"qualifiers", label:"Qualifiers" })
      : null;
    return {
      key: table.key,
      label: table.label || table.key,
      groupKey: table.tab_key || table.group_key || mastersGroup?.key || "",
      groupLabel: table.tab_label || table.group_label || mastersGroup?.label || "",
      seasonValue: table.season_value ?? null,
      seasonLabel: table.season_label || "",
      stageValue: table.stage_value ?? null,
      sheetName: tableRange.sheetName,
      hideContext: Boolean(table.hide_context),
      hideSeed: event?.eventKey === "masters" || Boolean(table.hide_seed),
      nameIsTeam: Boolean(table.name_is_team),
      matchupLayout: Boolean(table.matchup_layout),
      roundLabelStyle: table.round_label_style || "",
      headerGroups: Array.isArray(table.header_groups) ? table.header_groups.map((group) => ({
        label:normalizeText(group?.label).trim(),
        span:Math.max(1, Number(group?.span) || 1),
      })) : [],
      playerOptions: table.player_options
        ? [...new Set(Array.from(
            { length:Math.max(0, Number(table.player_options.end_row) - Number(table.player_options.start_row) + 1) },
            (_, index) => readColumn(
              valueRanges,
              tableRange.sheetName,
              table.player_options.column,
              Number(table.player_options.start_row) + index,
            ).trim(),
          ).filter(Boolean))]
        : [],
      canAddPlayers: Boolean(table.add_player),
      maxRoundCount: Math.max(0, ...rows.map((row) => row.roundScores.length)),
      maxFormulaCount: Math.max(0, ...rows.map((row) => row.formulaCells.length)),
      hasSuddenDeath: rows.some((row) => row.suddenDeath),
      hasResult: rows.some((row) => row.result),
      rows,
    };
  });
}

export function editorMatchups(rows){
  const matchups = new Map();
  for(const row of Array.isArray(rows) ? rows : []){
    if(!matchups.has(row.sourceRow)) matchups.set(row.sourceRow, []);
    matchups.get(row.sourceRow).push(row);
  }
  return [...matchups.entries()].map(([sourceRow, players]) => ({
    sourceRow,
    players: players.sort((left, right) => left.playerSlot - right.playerSlot),
  }));
}

export function matchupHasBye(matchup, currentValues = new Map()){
  return Array.isArray(matchup?.players) && matchup.players.some((row) => (
    editorPlayerName(row, currentValues).toLowerCase() === "bye"
  ));
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

export function editorPlayerName(row, currentValues){
  return normalizeText(row?.nameCell ? currentCellValue(row.nameCell, currentValues) : row?.playerName).trim();
}

export function editorPlayerOptions(tables, currentValues){
  const names = new Map();
  for(const table of tables){
    if(table.nameIsTeam) continue;
    for(const row of table.rows){
      if(!isEditorRowVisible(row, currentValues)) continue;
      const name = editorPlayerName(row, currentValues);
      if(name) names.set(name.toLowerCase(), name);
    }
  }
  return [...names.values()].sort((left, right) => left.localeCompare(right));
}

export function isEditorRowSelected(row, currentValues, selectedPlayerNames, matchupRows = []){
  const selected = new Set([...selectedPlayerNames].map((name) => normalizeText(name).trim().toLowerCase()));
  if(!selected.size) return true;
  const candidates = matchupRows.length
    ? matchupRows.filter((candidate) => candidate.sourceRow === row.sourceRow)
    : [row];
  return candidates.some((candidate) => selected.has(editorPlayerName(candidate, currentValues).toLowerCase()));
}

export function orderEditorRowsByPlayerSelection(rows, currentValues, selectedPlayerNames){
  const order = new Map([...selectedPlayerNames].map((name, index) => [normalizeText(name).trim().toLowerCase(), index]));
  return [...rows].sort((left, right) => (
    (order.get(editorPlayerName(left, currentValues).toLowerCase()) ?? order.size)
    - (order.get(editorPlayerName(right, currentValues).toLowerCase()) ?? order.size)
  ));
}

export function playerFilterBackspaceState(selectedPlayerNames, armedName = ""){
  const lastName = [...selectedPlayerNames].at(-1) || "";
  const isArmed = normalizeText(armedName).toLowerCase() === normalizeText(lastName).toLowerCase();
  return {
    armedName: isArmed ? "" : lastName,
    removeName: isArmed ? lastName : "",
  };
}

export function nextBlankPlayerRow(table, currentValues, reservedRowKeys = []){
  const reserved = new Set(reservedRowKeys);
  const blankRows = table.rows.filter((row) => (
    row.isAddPlayerSlot
    && row.nameCell
    && !reserved.has(row.key)
    && !isEditorRowVisible(row, currentValues)
  ));
  const lastVisibleRow = Math.max(0, ...table.rows.filter((row) => isEditorRowVisible(row, currentValues)).map((row) => row.sourceRow));
  return blankRows.find((row) => row.sourceRow > lastVisibleRow) || blankRows[0] || null;
}

export function addedPlayerRowSaveState(row, currentValues){
  if(editorPlayerName(row, currentValues)) return "ready";
  const hasScores = row.editableCells.some((cell) => (
    cell.type !== "player-name" && currentCellValue(cell, currentValues).trim()
  ));
  return hasScores ? "missing-name" : "empty";
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
            playerName:editorPlayerName(row, currentValues) || row.playerName,
            headers:dirtyRun.map((cell) => cell.label),
          });
        }
      }
    }
  }
  return updates;
}
