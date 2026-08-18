export function appendHiddenTournamentRows(visibleRows = [], allRows = [], includeHidden = false){
  if(!includeHidden) return visibleRows;
  const hiddenRows = allRows
    .filter(row => row?.hidden && Number(row?.total) > 0)
    .map(row => ({ ...row, rank:"", rankLabel:"", qualified:false }));
  return [...visibleRows, ...hiddenRows];
}
