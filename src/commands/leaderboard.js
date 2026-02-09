// === Imports ===
// Leaderboard needs Discord builders, storage, and rank snapshot helpers.
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { listGuildAccounts } from '../storage.js';

import {
  QUEUE_TYPES,
  RANKED_QUEUE_CHOICES,
  queueLabel,
} from "../constants/queues.js";
import { getRankSnapshotForQueue } from "../utils/rankSnapshot.js";

// === Ranking constants ===
// Tier ordering (low -> high) used to compute a sortable score.
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

// Division ordering for non-apex tiers.
const DIVISION_ORDER = {
  IV: 0,
  III: 1,
  II: 2,
  I: 3,
};

// === Formatting helpers ===
// Medals add quick visual cues for top placements.
function medalForPlace(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return `${i + 1}.`;
}

// Convert a tier name into its index in TIER_ORDER.
function tierIndex(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx === -1 ? -1 : idx;
}

// Higher score = better rank. This normalizes tiers/divisions into one number.
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


// Format rank as text for embeds.
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

// === Slash command definition ===
export default {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show server TFT leaderboard for registered accounts")
    .addStringOption((opt) =>
      opt
        .setName("queue")
        .setDescription("Which ladder?")
        .setRequired(false)
        .addChoices(...RANKED_QUEUE_CHOICES)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription("How many entries to show (1–25)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)
    ),

  // === Command handler ===
  // Build and send a leaderboard embed for the requested queue.
  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "This command can only be used inside a server (not DMs).", ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const queueType = interaction.options.getString("queue") || QUEUE_TYPES.RANKED_TFT;
    const limit = interaction.options.getInteger("limit") ?? 15;

    const accounts = await listGuildAccounts(guildId);
    if (!accounts.length) {
      await interaction.editReply("No accounts registered in this server yet. Use `/register` first.");
      return;
    }
    
    // Map accounts to a sortable structure (rank + computed score).
    const ranked = accounts
      .map((account) => {
        const rank = getRankSnapshotForQueue(account, queueType);
        return {
            account,
            rank,
            score: rankScore(rank),
        };
      })
      .sort((a, b) => b.score - a.score);
    
    // Limit output so the embed stays readable.
    const shown = ranked.slice(0, limit);
    
    const queueLabelText = queueLabel(queueType);

    // Build the human-readable lines shown in the embed.
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

    // Build and send the embed.
    const embed = new EmbedBuilder()
        .setTitle(`TFT Leaderboard — ${queueLabelText}`)
        .setDescription(lines.join("\n"))
        .setFooter({ text: `Showing top ${shown.length} of ${ranked.length} registered account(s)` });

    await interaction.editReply({ embeds: [embed] });
  },
};