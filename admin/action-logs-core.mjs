function text(value){
  return String(value ?? "").trim();
}

function flatValues(values){
  return Array.isArray(values) ? values.flatMap((row) => Array.isArray(row) ? row : []) : [];
}

function columnNumber(letters){
  return [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

function columnLetters(number){
  let value = number;
  let letters = "";
  while(value > 0){
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function startColumn(range){
  const letters = text(range).match(/!([A-Za-z]+)\d+/)?.[1];
  return letters ? columnNumber(letters) : 0;
}

export function actionLogTimestamp(value, locales){
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleString(locales, { dateStyle:"long", timeStyle:"short" });
}

export function actionLogCellCount(log){
  return (Array.isArray(log?.changes) ? log.changes : []).reduce((total, change) => (
    total + flatValues(change?.after).length
  ), 0);
}

export function actionLogChangeRows(change){
  const before = flatValues(change?.before);
  const after = flatValues(change?.after);
  const headers = Array.isArray(change?.headers) ? change.headers.map(text) : [];
  const count = Math.max(before.length, after.length, headers.length, 1);
  const firstColumn = startColumn(change?.range);
  const playerName = text(change?.playerName) || "Player unavailable";
  return Array.from({ length:count }, (_, index) => {
    const beforeBlank = before[index] === "" || before[index] === null || before[index] === undefined;
    const afterBlank = after[index] === "" || after[index] === null || after[index] === undefined;
    return {
      playerName,
      header:headers[index] || (firstColumn ? `Cell ${columnLetters(firstColumn + index)}` : "Changed value"),
      before:beforeBlank ? "blank" : String(before[index]),
      after:afterBlank ? "blank" : String(after[index]),
      beforeBlank,
      afterBlank,
    };
  });
}

export function addUndoChangeContext(logs){
  const list = Array.isArray(logs) ? logs : [];
  const byId = new Map(list.map((log) => [log.action_id, log]));
  return list.map((log) => {
    if(log.action_type !== "undo") return log;
    const target = byId.get(log.target_action_id);
    if(!target) return log;
    const targetChanges = new Map((target.changes || []).map((change) => [change.range, change]));
    return {
      ...log,
      changes:(log.changes || []).map((change) => ({ ...targetChanges.get(change.range), ...change })),
    };
  });
}
