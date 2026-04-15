import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import {
    resetGuildAccountProgressBeforeInStore,
    resetGuildAccountProgressInStore,
    setGuildTftConfigInStore,
} from "../storage.js";

function parseCutoffDateOrNull(input) {
    if (!input) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return NaN;

    const asUtcMidnight = Date.parse(`${input}T00:00:00.000Z`);
    if (!Number.isFinite(asUtcMidnight)) return NaN;
    const normalized = new Date(asUtcMidnight).toISOString().slice(0, 10);
    if (normalized !== input) return NaN;
    return asUtcMidnight;
}

export default {
    data: new SlashCommandBuilder()
        .setName("resetranks")
        .setDescription("Reset TFT tracking progress for this server. Optionally, set a cutoff date.")
        .addBooleanOption((opt) =>
            opt
                .setName("confirm")
                .setDescription("Confirm the reset action.")
                .setRequired(true)
        )
        .addStringOption((opt) =>
            opt
                .setName("before_date")
                .setDescription("Optional UTC cutoff date. Resets accounts with last match before this date.")
                .setRequired(false)
        )
        .addBooleanOption((opt) =>
            opt
                .setName("clear_match_cursor")
                .setDescription("Also clear lastMatchId/lastMatchAt. Usually keep this false to prevent re-processing old matches.")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({
                content: "This command can only be used within a server.",
                ephemeral: true,
            });
            return;
        }

        const confirm = interaction.options.getBoolean("confirm", true);
        if (!confirm) {
        await interaction.reply({
            content: "Reset cancelled. Re-run with `confirm:true` to perform the reset.",
            ephemeral: true,
        });
        return;
        }

        const beforeDate = interaction.options.getString("before_date");
        const cutoffMs = parseCutoffDateOrNull(beforeDate);
        const clearMatchCursor = interaction.options.getBoolean("clear_match_cursor") ?? false;
        if (Number.isNaN(cutoffMs)) {
            await interaction.reply({
                content: "Invalid `before_date`. Use `YYYY-MM-DD` format, for example `2026-04-01`.",
                ephemeral: true,
            });
            return;
        }

        const result = beforeDate
            ? await resetGuildAccountProgressBeforeInStore(guildId, cutoffMs, { clearMatchCursor })
            : clearMatchCursor
                ? await resetGuildAccountProgressBeforeInStore(guildId, null, { clearMatchCursor: true })
                : await resetGuildAccountProgressInStore(guildId);

        if (beforeDate) {
            await setGuildTftConfigInStore(guildId, { seasonCutoffMs: cutoffMs });
        }

        if ((result?.totalAccounts ?? 0) === 0) {
            await interaction.reply({
                content: "No registered accounts were found for this server.",
                ephemeral: true,
            });
            return;
        }

        await interaction.reply({
            content:
                `Reset complete for this server${beforeDate ? ` (cutoff: **${beforeDate} 00:00:00 UTC**)` : ""}.\n` +
                `• Accounts registered: **${result.totalAccounts}**\n` +
                `• Accounts with progress cleared: **${result.resetAccounts}**\n\n` +
                `${beforeDate ? `• Accounts skipped (recent match on/after cutoff): **${result.skippedAccounts ?? 0}**\n\n` : ""}` +
                `${beforeDate ? `• Accounts skipped (recent match on/after cutoff): **${result.skippedAccounts ?? 0}**\n\n` : ""}` +
                `${beforeDate ? `Saved guild TFT season cutoff to **${beforeDate} 00:00:00 UTC** for future polling.\n` : ""}` +
                `Cleared trackedGames.tft fields: 'lastRankByQueue' and 'recapEvents'` +
                `${clearMatchCursor ? ", plus 'lastMatchId' and 'lastMatchAt'." : ". (Kept 'lastMatchId' and 'lastMatchAt' to avoid replaying old matches.)"}`,
            ephemeral: true,
        });
    },
};
