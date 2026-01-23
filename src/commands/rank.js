import { SlashCommandBuilder } from "discord.js";
import { 
    getAccountByRiotId, 
    normalizePlatform, 
    platformToRegional,
    getTFTRankByPuuid,
 } from '../riot.js';

const TFT_QUEUE_LABELS = {
  RANKED_TFT: 'Ranked',
  RANKED_TFT_DOUBLE_UP: 'Double Up',
};


export default {
    data: new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Look up ranked info for a Riot ID")
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
            .setRequired(true)
        ),

    async execute(interaction) {
        // 1. Pull user inputs from disc command
        const gameName = interaction.options.getString('gamename', true);
        const tagLine = interaction.options.getString('tagline', true);
        const platformInput = interaction.options.getString('platform', true);
        
        // 2. Normalize platform + get regional routing
        const platform = normalizePlatform(platformInput);
        const regional = platformToRegional(platform);

        // 3. Defer reply in case of Riot API delay
        await interaction.deferReply();

        // 4. Call Riot API to get account by Riot ID
        const account = await getAccountByRiotId({ regional, gameName, tagLine });
        
        const tftEntries = await getTFTRankByPuuid({
            platform, 
            puuid: account.puuid 
        });

        let rankLines = [];

        // 5. Reply with basic account info + TFT rank if available
        if (Array.isArray(tftEntries) && tftEntries.length > 0) {
            for (const entry of tftEntries) {
                const label = TFT_QUEUE_LABELS[entry.queueType];
                if (!label) continue;

                const line = 
                    `${label}: ` +
                    `${entry.tier} ${entry.rank} — ${entry.leaguePoints} LP ` +
                    `(W ${entry.wins} / L ${entry.losses})`;
                
                    rankLines.push(line);
            }
        } else {
            rankLines.push('Unranked in TFT');
        }
        
        await interaction.editReply(
            `**${account.gameName}#${account.tagLine}**\n` +
            `TFT Rank: \n${rankLines.join('\n')}\n`
        )        
    },
};
