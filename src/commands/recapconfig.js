// src/commands/recapconfig.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { loadDb, getGuildRecapConfig, setGuildRecapConfigInStore } from "../storage.js";
import {
  GAME_TYPES,
  GAME_TYPE_CHOICES,
  ALL_RECAP_QUEUE_CHOICES,
  defaultRankedQueueForGame,
  queueChoicesForRecap,
  queueLabel,
} from "../constants/queues.js";
import { RECAP_MODE_CHOICES, formatRecapScheduleTime, modeLabel } from "../constants/recap.js";
import config from "../config.js";

export default {
  data: new SlashCommandBuilder()
    .setName("recapconfig")
    .setDescription(
      "Update recap autopost settings (`enabled` required), or use `status:true` to view current settings."
    )
    .addBooleanOption((opt) =>
      opt
        .setName("status")
        .setDescription("Show current recap autopost settings and ignore all other options.")
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("enabled")
        .setDescription("Enable/disable autopost (required unless `status` is true).")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("game")
        .setDescription("Game for recap autopost")
        .setRequired(false)
        .addChoices(...GAME_TYPE_CHOICES)
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
        .addChoices(...ALL_RECAP_QUEUE_CHOICES)
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
      const scheduleText = formatRecapScheduleTime(config.recapAutopostHour, config.recapAutopostMinute);
      console.log(`[recapconfig] status guild=${guildId} cfg=${JSON.stringify(cfg)}`);

      await interaction.reply({
        content:
          `**Recap autopost status**\n` +
          `• Enabled: **${cfg.enabled ? "Yes" : "No"}**\n` +
          `• Game: **${cfg.game === GAME_TYPES.LOL ? "LoL" : "TFT"}**\n` +
          `• Queue: **${queueLabel(cfg.game ?? GAME_TYPES.TFT, cfg.queue)}**\n` +
          `• Mode: **${modeLabel(cfg.mode)}**\n` +
          `• Time: **${scheduleText}**\n` +
          `• Last sent: ${cfg.lastSentYmd ?? "—"}`,
        ephemeral: true,
      });
      return;
    }

    const enabled = interaction.options.getBoolean("enabled"); // required unless status=true
    const game = interaction.options.getString("game") ?? GAME_TYPES.TFT; // optional, defaults TFT for compatibility
    const mode = interaction.options.getString("mode") ?? null; // optional
    const rawQueue = interaction.options.getString("queue"); // optional
    const validQueueTypes = new Set(queueChoicesForRecap(game).map((choice) => choice.value));
    const queue = rawQueue && validQueueTypes.has(rawQueue)
      ? rawQueue
      : (rawQueue ? defaultRankedQueueForGame(game) : null);


    if (enabled === null) {
      await interaction.reply({
        content: "`enabled` is required unless you set `status` to `true`.",
        ephemeral: true,
      });
      return;
    }

    if (mode !== null) {
      const validModes = new Set(RECAP_MODE_CHOICES.map((choice) => choice.value));
      if (!validModes.has(mode)) {
        await interaction.reply({
          content: `Invalid mode. Allowed values: ${[...validModes].join(", ")}.`,
          ephemeral: true,
        });
        return;
      }
    }

    const patch = {
      enabled,
      ...(game ? { game } : {}),
      ...(mode ? { mode } : {}),
      ...(queue ? { queue } : {}),
      ...(enabled ? { lastSentYmd: null } : {}), // when enabling, allow next 9am to fire
    };

    const updated = await setGuildRecapConfigInStore(guildId, patch);
    const scheduleText = formatRecapScheduleTime(config.recapAutopostHour, config.recapAutopostMinute);

    console.log(`[recapconfig] update guild=${guildId} patch=${JSON.stringify(patch)} -> ${JSON.stringify(updated)}`);

    await interaction.reply({
      content: enabled
        ? `✅ Autopost enabled: **${updated.game === GAME_TYPES.LOL ? "LoL" : "TFT"} / ${queueLabel(updated.game ?? GAME_TYPES.TFT, updated.queue)}** • **${modeLabel(updated.mode)}** • posts at **${scheduleText}**`
        : `🛑 Autopost disabled.`,
      ephemeral: true,
    });
  },
};
