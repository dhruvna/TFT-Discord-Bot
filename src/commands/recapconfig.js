// src/commands/recapconfig.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { loadDb, saveDb, getGuildRecapConfig, setGuildRecapConfig } from "../storage.js";

const MODE_CHOICES = [
  { name: "Daily (last 24h)", value: "DAILY" },
  { name: "Weekly (last 7d)", value: "WEEKLY" },
];

const QUEUE_CHOICES = [
  { name: "Ranked", value: "RANKED_TFT" },
  { name: "Double Up", value: "RANKED_TFT_DOUBLE_UP" },
];

function queueLabel(queue) {
  if (queue === "RANKED_TFT") return "Ranked";
  if (queue === "RANKED_TFT_DOUBLE_UP") return "Double Up";
  return queue;
}

function modeLabel(mode) {
  return mode === "WEEKLY" ? "Weekly" : "Daily";
}

export default {
  data: new SlashCommandBuilder()
    .setName("recapconfig")
    .setDescription("Configure the automated recap post (posts daily at 9:00 AM).")
    .addBooleanOption((opt) =>
      opt
        .setName("enabled")
        .setDescription("Enable/disable autopost")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Daily or weekly recap content")
        .setRequired(false)
        .addChoices(...MODE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName("queue")
        .setDescription("Which queue to post")
        .setRequired(false)
        .addChoices(...QUEUE_CHOICES)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("status")
        .setDescription("Show current recap autopost settings (ignores other options).")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        ephemeral: true,
      });
      return;
    }

    const wantsStatus = interaction.options.getBoolean("status") ?? false;

    const db = await loadDb();

    if (wantsStatus) {
      const cfg = getGuildRecapConfig(db, guildId);
      console.log(`[recapconfig] status guild=${guildId} cfg=${JSON.stringify(cfg)}`);

      await interaction.reply({
        content:
          `**Recap autopost status**\n` +
          `• Enabled: **${cfg.enabled ? "Yes" : "No"}**\n` +
          `• Queue: **${queueLabel(cfg.queue)}**\n` +
          `• Mode: **${modeLabel(cfg.mode)}**\n` +
          `• Time: **9:00 AM**\n` +
          `• Last sent: ${cfg.lastSentYmd ?? "—"}`,
        ephemeral: true,
      });
      return;
    }

    const enabled = interaction.options.getBoolean("enabled"); // required
    const mode = interaction.options.getString("mode"); // optional
    const queue = interaction.options.getString("queue"); // optional

    const patch = {
      enabled,
      ...(mode ? { mode } : {}),
      ...(queue ? { queue } : {}),
      ...(enabled ? { lastSentYmd: null } : {}), // when enabling, allow next 9am to fire
    };

    const updated = setGuildRecapConfig(db, guildId, patch);
    await saveDb(db);

    console.log(`[recapconfig] update guild=${guildId} patch=${JSON.stringify(patch)} -> ${JSON.stringify(updated)}`);

    await interaction.reply({
      content: enabled
        ? `✅ Autopost enabled: **${queueLabel(updated.queue)}** • **${modeLabel(updated.mode)}** • posts at **9:00 AM**`
        : `🛑 Autopost disabled.`,
      ephemeral: true,
    });
  },
};
