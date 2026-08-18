export function recoverTournamentVisibility(hiddenPlayerKeys = [], activeTournamentKeys = []){
  const hidden = new Set(hiddenPlayerKeys);
  const active = [...new Set(activeTournamentKeys)].filter(Boolean);
  if(!active.length || active.some(key => !hidden.has(key))){
    return { hiddenPlayerKeys:hidden, recovered:false };
  }

  active.forEach(key => hidden.delete(key));
  return { hiddenPlayerKeys:hidden, recovered:true };
}
