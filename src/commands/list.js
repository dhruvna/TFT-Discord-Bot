import { SlashCommandBuilder } from "discord.js";

import { listGuildAccounts, normalizeAccountTracking } from '../storage.js';

function formatTrackingState(account) {
    const normalized = normalizeAccountTracking(account);
    const tftEnabled = normalized?.trackedGames?.tft?.enabled !== false;
    const lolEnabled = normalized?.trackedGames?.lol?.enabled !== false;

    if (tftEnabled && lolEnabled) return "TFT+LoL";
    if (tftEnabled) return "TFT";
    if (lolEnabled) return "LoL";
    return "Disabled";
}

export default {
    data: new SlashCommandBuilder()
        .setName("list")
        .setDescription("Lists all registered Riot IDs in this server"),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({
                content: "This command can only be used inside a server (not DMs).",
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const accounts = await listGuildAccounts(guildId);
        if (accounts.length === 0) {
            await interaction.editReply("No Riot IDs are registered in this server.");
            return;
        }

        const lines = accounts
            .map((a) => `- **${a.gameName}#${a.tagLine}** (${a.region}) — ${formatTrackingState(a)}`)
            .join('\n');
        
        await interaction.editReply(`Registered accounts in this server:\n${lines}`);
    },
};
