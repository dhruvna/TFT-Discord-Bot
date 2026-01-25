import { SlashCommandBuilder } from "discord.js";

import {
    listGuildAccounts,
    removeGuildAccountByKey
    } from "../storage.js";

export default {
    data: new SlashCommandBuilder()
        .setName("unregister")
        .setDescription("Unregister a Riot ID from this server")
        .addStringOption((opt) =>
            opt
                .setName('account')
                .setDescription('Select a registered Riot ID to unregister')
                .setRequired(true)
                .setAutocomplete(true)
        ),
    
    async autocomplete(interaction) {
        try {
            const guildId = interaction.guildId;
            if (!guildId) {
                await interaction.respond([]);
                return;
            }

            const focused = interaction.options.getFocused() ?? "";
            const q = focused.toLowerCase();

            const accounts = await listGuildAccounts(guildId);

            const filtered = 
                q.length === 0
                    ? accounts
                    : accounts.filter(a => {
                        const name = `${a.gameName}#${a.tagLine}`.toLowerCase();
                        const region = String(a.region ?? "").toLowerCase();
                        return name.includes(q) || region.includes(q);
                    });
            
            await interaction.respond(
                filtered.slice(0, 25).map(a => ({
                    name: `${a.gameName}#${a.tagLine} (${a.region})`,
                    value: a.key,
                }))
            );
        } catch (err) {
            console.error("Error during unregister autocomplete:", err);
            return interaction.respond([]);
        }        
    },
    
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

        const key = interaction.options.getString('account', true);

        const removed = await removeGuildAccountByKey(guildId, key);

        if (!removed) {
            await interaction.editReply("The selected Riot ID is not registered in this server. It may have already been removed.");
            return;
        }

        await interaction.editReply(
            `Successfully unregistered **${removed.gameName}#${removed.tagLine}** from this server.`
        );
    },
};
