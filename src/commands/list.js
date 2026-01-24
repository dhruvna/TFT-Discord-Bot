import { SlashCommandBuilder } from "discord.js";

import { listGuildAccounts } from '../storage.js';

function mustGetEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value;
}

const guildId = mustGetEnv('DISCORD_GUILD_ID');

export default {
    data: new SlashCommandBuilder()
        .setName("list")
        .setDescription("Lists all registered Riot IDs in this server"),

    async execute(interaction) {
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
            .map((a) => `- **${a.gameName}#${a.tagLine}** (${a.region})`)
            .join('\n');
        
        await interaction.editReply(`Registered accounts in this server:\n${lines}`);
    },
};
