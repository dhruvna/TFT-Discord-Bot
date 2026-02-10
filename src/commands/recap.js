// src/commands/recap.js
import { SlashCommandBuilder} from "discord.js";
import { listGuildAccounts } from "../storage.js";
import { 
  buildRecapEmbed,
  computeRecapRows,
  hoursForMode,
} from "../utils/recap.js";
import { RANKED_QUEUE_CHOICES } from "../constants/queues.js";
import { RECAP_MODE_CHOICES } from "../constants/recap.js";

/* -------------------- Command -------------------- */
export default {
  data: new SlashCommandBuilder()
    .setName("recap")
    .setDescription("Show Ranked or Double Up recap now, either daily or weekly.")
    .addStringOption((opt) =>
      opt
        .setName("queue")
        .setDescription("Queue to recap")
        .setRequired(true)
        .addChoices(...RANKED_QUEUE_CHOICES)
    )
    .addStringOption((opt) =>
      opt.setName("mode").setDescription("Daily or weekly recap").setRequired(false).addChoices(...RECAP_MODE_CHOICES)
    ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: "This command can only be used inside a server.", ephemeral: true });
            return;
        }

        /* ---------- POST RECAP ---------- */
        await interaction.deferReply();

        const mode = interaction.options.getString("mode") ?? "DAILY";
        const queue = interaction.options.getString("queue");

        const hours = hoursForMode(mode);
        const cutoff = Date.now() - hours * 60 * 60 * 1000;

        const accounts = await listGuildAccounts(guildId);
        if (!accounts.length) {
            await interaction.editReply("No accounts registered in this server yet. Use `/register` first.");
            return;
        }

        const rows = computeRecapRows(accounts, cutoff, queue);
        console.log(
            `[recap] guild=${guildId} mode=${mode} queue=${queue} accounts=${accounts.length} cutoff=${new Date(cutoff).toISOString()}`
        );
        const embed = buildRecapEmbed({ rows, mode, queue, hours });
        
        await interaction.editReply({ embeds: [embed] });
    },
};
