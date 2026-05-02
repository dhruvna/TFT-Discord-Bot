// src/commands/recap.js
import { SlashCommandBuilder} from "discord.js";
import { listGuildAccounts } from "../storage.js";
import {
  buildRecapEmbed,
  computeRecapRows,
  hoursForMode,
} from "../utils/recap.js";
import {
  GAME_TYPES,
  GAME_TYPE_CHOICES,
  ALL_RECAP_QUEUE_CHOICES,
  defaultRankedQueueForGame,
  parseQueueWithGameValidation,
  queueChoicesForRecap,
} from "../constants/queues.js";
import { RECAP_MODE_CHOICES } from "../constants/recap.js";

/* -------------------- Command -------------------- */
export default {
  data: new SlashCommandBuilder()
    .setName("recap")
    .setDescription("Show a recap now for TFT or LoL, daily or weekly.")
    .addStringOption((opt) =>
      opt
        .setName("game")
        .setDescription("Game to recap")
        .setRequired(false)
        .addChoices(...GAME_TYPE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName("queue")
        .setDescription("Queue to recap (TFT + LoL options; validated against selected game)")
        .setRequired(false)
        .addChoices(...ALL_RECAP_QUEUE_CHOICES)
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

        const game = interaction.options.getString("game") ?? GAME_TYPES.TFT;
        const mode = interaction.options.getString("mode") ?? "DAILY";
        const rawQueue = interaction.options.getString("queue");
        const parsedQueue = parseQueueWithGameValidation({ game, rawQueue, queueChoices: queueChoicesForRecap });
        if (parsedQueue.error) {
            const validQueues = queueChoicesForRecap(game).map((choice) => `\`${choice.name}\``).join(", ");
            await interaction.editReply(
                `${parsedQueue.error} Choose one of: ${validQueues}.`
            );
            return;
        }

        const queue = parsedQueue.queue ?? defaultRankedQueueForGame(game);
        
        const hours = hoursForMode(mode);
        const cutoff = Date.now() - hours * 60 * 60 * 1000;

        const accounts = await listGuildAccounts(guildId);
        if (!accounts.length) {
            await interaction.editReply("No accounts registered in this server yet. Use `/register` first.");
            return;
        }

        const rows = computeRecapRows(accounts, cutoff, queue, game);
        console.log(
            `[recap] guild=${guildId} mode=${mode} game=${game} queue=${queue} accounts=${accounts.length} cutoff=${new Date(cutoff).toISOString()}`
        );
        const embed = buildRecapEmbed({ rows, mode, game, queue, hours });
        await interaction.editReply({ embeds: [embed] });
    },
};
