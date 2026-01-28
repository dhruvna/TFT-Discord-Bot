import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { listGuildAccounts } from "../storage.js";

/* -------------------- Constants -------------------- */
const MODE_CHOICES = [
  { name: "Daily (last 24h)", value: "daily" },
  { name: "Weekly (last 7d)", value: "weekly" },
];

const QUEUE_CHOICES = [
  { name: "Ranked", value: "RANKED_TFT" },
  { name: "Double Up", value: "RANKED_TFT_DOUBLE_UP" },
];

const ALL_RANKED_QUEUES = new Set([
  "RANKED_TFT",
  "RANKED_TFT_DOUBLE_UP",
]);

/* -------------------- Helpers -------------------- */

function hoursForMode(mode) {
  return mode === "WEEKLY" ? 24 * 7 : 24;
}

function wantedQueuesFor(queue) {
  return new Set([queue]);
}

function queueLabel(queue) {
  if (queue === "RANKED_TFT") return "Ranked";
  if (queue === "RANKED_TFT_DOUBLE_UP") return "Double Up";
}

function modeLabel(mode) {
  return mode === "WEEKLY" ? "Weekly" : "Daily";
}

function medal(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return `${i + 1}.`;
}

function formatDelta(delta) {
  const d = Number(delta ?? 0);
  if (d > 0) return `↑ +${d} LP`;
  if (d < 0) return `↓ ${Math.abs(d)} LP`;
  return "0 LP";
}

function accountName(a) {
  return `${a.gameName}#${a.tagLine}`;
}

/* -------------------- Core Logic -------------------- */

function computeRecapRows(accounts, cutoffMs, wantedQueues) {
  return accounts.map((account) => {
    const events = Array.isArray(account.recapEvents)
      ? account.recapEvents
      : [];

    const filtered = events.filter(
      (e) =>
        Number(e?.at ?? 0) >= cutoffMs &&
        wantedQueues.has(e.queueType)
    );

    return {
      account,
      games: filtered.length,
      delta: filtered.reduce((s, e) => s + Number(e.delta ?? 0), 0),
    };
  });
}

function sortByGains(rows) {
  return [...rows].sort((a, b) => {
    if (b.delta !== a.delta) return b.delta - a.delta;
    if (b.games !== a.games) return b.games - a.games;
    return accountName(a.account)
      .toLowerCase()
      .localeCompare(accountName(b.account).toLowerCase());
  });
}

function sortByLosses(rows) {
  return rows
    .filter((r) => r.delta < 0)
    .sort((a, b) => a.delta - b.delta);
}

function buildLines(rows, limit) {
  return rows.slice(0, limit).map((r, i) => {
    const games = r.games > 0 ? ` — ${r.games} games` : "";
    return `${medal(i)} **${accountName(r.account)}** ${formatDelta(r.delta)}${games}`;
  });
}

/* -------------------- Command -------------------- */
export default {
  data: new SlashCommandBuilder()
    .setName("recap")
    .setDescription("Daily or weekly recap for Ranked TFT and Double Up.")
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Daily or weekly recap")
        .setRequired(false)
        .addChoices(...MODE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName("queue")
        .setDescription("Queue to recap")
        .setRequired(false)
        .addChoices(...QUEUE_CHOICES)
    ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
        await interaction.reply({
            content: "This command can only be used inside a server.",
            ephemeral: true,
        });
        return;
        }
        
        await interaction.deferReply();

        const mode = interaction.options.getString("mode") ?? "DAILY";
        const queue = interaction.options.getString("queue") ?? "RANKED_TFT";

        const hours = hoursForMode(mode);
        const cutoff = Date.now() - hours * 60 * 60 * 1000;

        const accounts = await listGuildAccounts(guildId);
        if (!accounts.length) {
        await interaction.editReply(
            "No accounts registered in this server yet. Use `/register` first."
        );
        return;
        }

        const wantedQueues = wantedQueuesFor(queue);
        const rows = computeRecapRows(accounts, cutoff, wantedQueues);

        const totalGames = rows.reduce((s, r) => s + r.games, 0);

        const gains = sortByGains(rows);
        const losses = sortByLosses(rows);

        const gainsText = (buildLines(gains, 25).join("\n") || "—").slice(0, 1024);
        const lossesText =
        losses.length > 0
            ? buildLines(losses, 10).join("\n").slice(0, 1024)
            : "—";

        const embed = new EmbedBuilder()
        .setTitle(`${modeLabel(mode)} Recap`)
        .addFields(
            { name: "Top gains", value: gainsText, inline: true },
            { name: "Top losses", value: lossesText, inline: true }
        )
        .setFooter({
            text: `${rows.length} players | ${totalGames} games • ${queueLabel(queue)} • last ${hours}h`,
        })
        .setTimestamp(new Date());

        await interaction.editReply({ embeds: [embed] });
    },
};
    