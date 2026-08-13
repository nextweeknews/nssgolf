function toNumber(value){
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAllStars(rows){
  const players = (rows || [])
    .slice(String(rows?.[0]?.[0] ?? "").trim().toLowerCase() === "team/player" ? 1 : 0)
    .map((row, index) => {
      const name = String(row?.[0] ?? "").trim();
      if (!name) return null;

      const rounds = Array.from({ length: 4 }, (_, i) => toNumber(row?.[i + 2]));
      const playedRounds = rounds
        .map((score, roundIndex) => ({ score, roundIndex }))
        .filter(({ score }) => Number.isFinite(score))
        .sort((a, b) => a.score - b.score || a.roundIndex - b.roundIndex);
      const bestRounds = playedRounds.slice(0, 2);
      const best = bestRounds.map(({ score }) => score);

      return {
        index,
        name,
        displayName: name.toUpperCase(),
        rounds,
        countedRoundIndices: bestRounds.map(({ roundIndex }) => roundIndex),
        best: [best[0] ?? null, best[1] ?? null],
        weekTotals: [
          rounds.slice(0, 2).some(Number.isFinite) ? rounds.slice(0, 2).filter(Number.isFinite).reduce((a, b) => a + b, 0) : null,
          rounds.slice(2, 4).some(Number.isFinite) ? rounds.slice(2, 4).filter(Number.isFinite).reduce((a, b) => a + b, 0) : null,
        ],
        score: best.length ? best.reduce((a, b) => a + b, 0) : (toNumber(row?.[1]) ?? 0),
        played: playedRounds.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(!a.played) - Number(!b.played) || a.score - b.score || a.index - b.index);

  let previousScore = null;
  let previousPlayed = null;
  players.forEach((player, index) => {
    const hasPlayed = player.played > 0;
    if (player.score !== previousScore || hasPlayed !== previousPlayed) player.rank = index + 1;
    else player.rank = players[index - 1].rank;
    previousScore = player.score;
    previousPlayed = hasPlayed;
    player.overallRank = player.rank;
    player.stageScore = player.score;
  });

  return players;
}

if (typeof process !== "undefined" && decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]){
  const result = normalizeAllStars([
    ["Team/Player", "Score", "1-1", "1-2", "2-1", "2-2"],
    ["One", "-45", "-24", "-21"],
    ["Two", "0"],
    ["Tie", "-45", "-20", "-25"],
    ["Solo", "-45", "-45"],
    ["Best", "-60", "-30", "-30", "-30", "-10"],
  ]);
  if (result.map(({ name, rank, score }) => `${name}:${rank}:${score}`).join("|") !== "Best:1:-60|One:2:-45|Tie:2:-45|Solo:2:-45|Two:5:0") throw new Error("All-Stars ranking check failed");
  if (result[0].best.join(",") !== "-30,-30" || result[0].weekTotals.join(",") !== "-60,-40" || result[0].countedRoundIndices.join(",") !== "0,1") throw new Error("All-Stars score check failed");
  console.log("All-Stars checks passed");
}
