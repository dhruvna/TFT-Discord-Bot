import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { 
    getAccountByRiotId, 
    normalizePlatform, 
    platformToRegional,
    getTFTRankByPuuid,
 } from '../riot.js';

/* Convert's rank entry to a formatted one line string.
   Example: Emerald II - 75 LP */
function formatRankLine(entry) {
    return `${entry.tier} ${entry.rank} - ${entry.leaguePoints} LP`;
}

/* Winrate isn't given by Riot, compute it here.
   Return "-" if no games played yet. */
function computeWinrate(wins, losses) {
    const total = wins + losses;
    if (total === 0) return "-";
    return `${((wins / total) * 100).toFixed(1)}%`;
}

/* Add a section for a specific queue type to the fields array 
   - A header field with the rank line
   - 3 inline stat fields (Wins/Losses/Winrate) aligned as columns */
function addQueueSection(fields, label, entry) {
    const wins = entry.wins ?? 0;
    const losses = entry.losses ?? 0;
    const wr = computeWinrate(wins, losses);
    // Header / rank line
    fields.push({
        name: label,
        value: `**${formatRankLine(entry)}**`,
        inline: false,
    });

    // Stat rows
    fields.push(
        { name: 'Wins', value: `${wins}`, inline: true},
        { name: 'Losses', value: `${losses}`, inline: true },
        { name: 'Winrate', value: `${wr}`, inline: true },
    );
}

function addSpacer(fields) {
  fields.push({ name: "\u200B", value: "\u200B", inline: false });
}

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
            .setRequired(false)
        ),

    async execute(interaction) {
        // 1. Pull user inputs from disc command
        const gameName = interaction.options.getString('gamename', true);
        const tagLine = interaction.options.getString('tagline', true);
        const platformInput = interaction.options.getString('platform', false);
        
        // 2. Normalize platform + get regional routing
        const platform = normalizePlatform(platformInput);
        const regional = platformToRegional(platform);

        // 3. Defer reply in case of Riot API delay
        await interaction.deferReply();

        // 4. Riot ID -> Account PUUID
        const account = await getAccountByRiotId({ regional, gameName, tagLine });
        
        // 5. PUUID -> TFT Entries (Ranked/Double Up/etc)
        const tftEntries = await getTFTRankByPuuid({
            platform, 
            puuid: account.puuid 
        });

        // 6. Pull out queues we care about
        const rankedEntry = tftEntries.find(e => e.queueType === 'RANKED_TFT');
        const doubleUpEntry = tftEntries.find(e => e.queueType === 'RANKED_TFT_DOUBLE_UP');

        // 7. Build embed fields
        const fields = [];

        if (rankedEntry) addQueueSection(fields, 'Ranked', rankedEntry);

        if (rankedEntry && doubleUpEntry) addSpacer(fields);

        if (doubleUpEntry) addQueueSection(fields, 'Double Up', doubleUpEntry);

        if (fields.length === 0) {
            fields.push({ name: 'TFT', value: 'Unranked', inline: false });
        }

        const embed = new EmbedBuilder()
            .setTitle(`${account.gameName}#${account.tagLine}'s TFT Rank:`)
            .addFields(fields);
        
        embed.setThumbnail('https://placehold.co/96x96/png?text=TFT');

        await interaction.editReply({ embeds: [embed] });
    },
};
