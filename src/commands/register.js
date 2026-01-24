import { SlashCommandBuilder } from "discord.js";

import {
    getAccountByRiotId,
    normalizePlatform,
    platformToRegional,
} from '../riot.js';

import {
    makeAccountKey,
    upsertGuildAccount,
} from '../storage.js';


export default {
    data: new SlashCommandBuilder()
        .setName("register")
        .setDescription("Register Riot ID in this server for future lookup")
        .addStringOption((opt) =>
            opt
            .setName('gamename')
            .setDescription('Riot ID Gamename (before #)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
            opt
            .setName('tagline')
            .setDescription('Riot ID Tagline (after #)')
            .setRequired(true)
        )
        .addStringOption((opt) =>
            opt
            .setName('platform')
            .setDescription('Platform routing like na1, euw1, kr ')
            .setRequired(false)
        ),

    async execute(interaction) {
        // 1. Ensure command is run in a server only
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({
                content: "This command can only be used in a server (not DMs).",
                ephemeral: true,
            });
            return;
        }

        // 2. Pull user inputs from disc command
        const gameName = interaction.options.getString("gamename", true);
        const tagLine = interaction.options.getString("tagline", true);
        const platformInput = interaction.options.getString("platform", false);
        
        // 3. Normalize platform + get regional routing
        const platform = normalizePlatform(platformInput);
        const regional = platformToRegional(platform);
        
        // 4. Defer reply in case of Riot API delay
        await interaction.deferReply({ ephemeral: true });

        // 5. Riot ID -> Account PUUID
        let account;
        try {
            account = await getAccountByRiotId({ regional,  gameName, tagLine });
        } catch (err) {
            await interaction.editReply(
                "Couldn't find that Riot ID. Please double-check the spelling and try again.",
            );
            return;
        }

        // 6. Build stored record
        const stored = {
            key: makeAccountKey({ 
                gameName: account.gameName,
                tagLine: account.tagLine,
                platform,
            }),
            gameName: account.gameName,
            tagLine: account.tagLine,
            platform,
            puuid: account.puuid,
            addedBy: interaction.user.id,
            addedAt: new Date().toISOString(),
        };

        // 7. Upsert into storage
        await upsertGuildAccount(guildId, stored);

        // Confirm to user
        await interaction.editReply(
            `Successfully registered Riot ID **${stored.gameName}#${stored.tagLine}** for this server.`,
        );
    },
};
