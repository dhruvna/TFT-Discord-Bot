import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

import { listGuildAccounts } from '../storage.js';

const QUEUE_OPTIONS = [
    { name: "Ranked", value: "RANKED_TFT" },
    { name: "Double Up", value: "RANKED_TFT_DOUBLE_UP" },
];

// Tier ordering (low -> high)
const TIER_ORDER = [
  "IRON", // 0 - 399
  "BRONZE", // 400 - 799
  "SILVER", // 800 - 1199
  "GOLD", // 1200 - 1599
  "PLATINUM", // 1600 - 1999
  "EMERALD", // 2000 - 2399
  "DIAMOND", // 2400 - 2799
  "MASTER", // 2800+
  "GRANDMASTER", 
  "CHALLENGER", 
];

const DIVISION_ORDER = {
  IV: 0,
  III: 1,
  II: 2,
  I: 3,
};

function medalForPlace(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return `${i + 1}.`;
}

function tierIndex(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx === -1 ? -1 : idx;
}

// Higher score = better rank
function rankScore(rank) {
    if (!rank?.tier) return -1;

    const t = tierIndex(rank.tier);
    if (t < 0) return -1;

    // Master+ has no division, it's just above D1
    const isApex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank.tier);
    const div = isApex ? 4 : (DIVISION_ORDER[rank.rank] ?? 0);
    const lp = Number(rank.lp ?? rank.leaguePoints ?? 0);

    // big base number so tiers/divisions dominate
    return t * 1_000_000 + div * 10_000 + lp;
}

function formatRank(rank) {
    if (!rank?.tier) return "Unranked";
    const lp = Number(rank.lp ?? rank.leaguePoints ?? 0);
    const isApex = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank.tier);

    return isApex
        ? `${rank.tier} — ${lp} LP`
        : `${rank.tier} ${rank.rank} — ${lp} LP`;
}

function computeWinrate(wins = 0, losses = 0) {
    const total = wins + losses;
    if (total <= 0) return "-";
    return `${((wins / total) * 100).toFixed(1)}%`;
}

/**
 * Extracts the cached rank snapshot for the queue from a stored account.
 * This supports a couple common shapes:
 *  - account.rank[queueType] (recommended)
 *  - account.ranks[queueType]
 *  - account.afterRank (single queue snapshot)
 */
function getCachedRank(account, queueType) {
  return account?.lastRankByQueue?.[queueType] ?? null;
}

export default {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show server TFT leaderboard for registered accounts")
    .addStringOption((opt) =>
      opt
        .setName("queue")
        .setDescription("Which ladder?")
        .setRequired(false)
        .addChoices(...QUEUE_OPTIONS)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription("How many entries to show (1–25)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "This command can only be used inside a server (not DMs).", ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const queueType = interaction.options.getString("queue") || "RANKED_TFT";
    const limit = interaction.options.getInteger("limit") ?? 15;

    const accounts = await listGuildAccounts(guildId);
    if (!accounts.length) {
      await interaction.editReply("No accounts registered in this server yet. Use `/register` first.");
      return;
    }
    
    const ranked = accounts
      .map((account) => {
        const rank = getCachedRank(account, queueType);
        return {
            account,
            rank,
            score: rankScore(rank),
        };
      })
      .sort((a, b) => b.score - a.score);

    const shown = ranked.slice(0, limit);

    const queueLabel = queueType === "RANKED_TFT_DOUBLE_UP" ? "Double Up" : "Ranked";

    const lines = shown.map((r, i) => {
      const name = `${r.account.gameName}#${r.account.tagLine}`;
      const rankStr = formatRank(r.rank);
    
      const wins = Number(r.rank?.wins ?? 0);
      const losses = Number(r.rank?.losses ?? 0);
      const wr = computeWinrate(wins, losses);

      // Only show W/L if we have an entry
      const stats = r.rank?.tier ? ` • ${wins}W-${losses}L • ${wr}` : "";

      return `${medalForPlace(i)} **${name}** — ${rankStr}${stats}`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`TFT Leaderboard — ${queueLabel}`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: `Showing top ${shown.length} of ${ranked.length} registered account(s)` });

    await interaction.editReply({ embeds: [embed] });
  },
};