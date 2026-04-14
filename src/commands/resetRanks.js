import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { resetGuildAccountProgressInStore } from "../storage.js";

export default {
    data: new SlashCommandBuilder()
        .setName("resetranks")
        .setDescription("Reset LP snapshots and recap game history for all registered accounts in the server.")
        .addBooleanOption((opt) =>
            opt
                .setName("confirm")
                .setDescription("Confirm the reset action.")
                .setRequired(true)
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

        const result = await resetGuildAccountProgressInStore(guildId);

        if ((result?.totalAccounts ?? 0) === 0) {
            await interaction.reply({
                content: "No registered accounts were found for this server.",
                ephemeral: true,
            });
            return;
        }

        await interaction.reply({
            content:
                `Reset complete for this server.\n` +
                `• Accounts registered: **${result.totalAccounts}**\n` +
                `• Accounts with progress cleared: **${result.resetAccounts}**\n\n` +
                `Cleared fields: \'lastRankByQueue\', \'recapEvents\', and \'lastMatchId\'.`,
            ephemeral: true,
        });
    },
};
