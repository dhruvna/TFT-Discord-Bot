// src/commands/recapconfig.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { loadDb, saveDb, getGuildRecapConfig, setGuildRecapConfig } from "../storage.js";
import { RANKED_QUEUE_CHOICES, queueLabel } from "../constants/queues.js";
import { RECAP_MODE_CHOICES, modeLabel } from "../constants/recap.js";

export default {
  data: new SlashCommandBuilder()
    .setName("recapconfig")
    .setDescription(
      "Update recap autopost settings (`enabled` required), or use `status:true` to view current settings."
    )
    .addBooleanOption((opt) =>
      opt
        .setName("enabled")
        .setDescription("Enable/disable autopost")
        .setDescription("Enable/disable autopost (required unless `status` is true).")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("mode")
        .setDescription("Daily or weekly recap content")
        .setRequired(false)
        .addChoices(...RECAP_MODE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName("queue")
        .setDescription("Which queue to post")
        .setRequired(false)
        .addChoices(...RANKED_QUEUE_CHOICES)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("status")
        .setDescription("Show current recap autopost settings and ignore all other options.")
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

    const enabled = interaction.options.getBoolean("enabled"); // required unless status=true
    const mode = interaction.options.getString("mode"); // optional
    const queue = interaction.options.getString("queue"); // optional

    if (enabled === null) {
      await interaction.reply({
        content: "`enabled` is required unless you set `status` to `true`.",
        ephemeral: true,
      });
      return;
    }

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
