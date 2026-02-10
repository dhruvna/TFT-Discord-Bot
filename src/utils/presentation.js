/* Winrate isn't given by Riot, compute it here.
   Return "-" if no games played yet. */
export function formatWinrate(wins = 0, losses = 0) {
  const total = Number(wins) + Number(losses);
  if (total <= 0) return "-";
  return `${((Number(wins) / total) * 100).toFixed(1)}%`;
}

/* Convert's rank entry to a formatted one line string.
   Example: Emerald II - 75 LP */
export function formatRankLine(rank) {
    if (!rank?.tier) return "Unranked";
    const lp = Number(rank.lp ?? rank.leaguePoints ?? 0);
    return `${rank.tier} ${rank.rank} - ${lp} LP`;
}

// Format rank as text for embeds.
export function formatRankWithLp(rank) {
  if (!rank?.tier) return "Unranked";

  const lp = Number(rank.lp ?? rank.leaguePoints ?? 0);
  const isApex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank.tier);

  return isApex
    ? `${rank.tier} — ${lp} LP`
    : `${rank.tier} ${rank.rank} — ${lp} LP`;
}

// Medals add quick visual cues for top placements.
export function medalForIndex(index) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return `${index + 1}.`;
}
