import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { 
    getAccountByRiotId, 
    getTFTRankByPuuid,
    getTftRegaliaThumbnailUrl,
    REGION_CHOICES,
    resolveRegion,
    getLeagueOfGraphsUrl,
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

async function buildQueueEmbed({account, label, entry}) {
    const fields = [];
    addQueueSection(fields, label, entry);
    const profileUrl = getLeagueOfGraphsUrl({ gameName: account.gameName, tagLine: account.tagLine });
    const embed = new EmbedBuilder()
        .setTitle(`${account.gameName}#${account.tagLine} — ${label}`)
        .addFields(fields)
        .setURL(profileUrl);

    const thumbUrl = await getTftRegaliaThumbnailUrl({
        queueType: entry.queueType,
        tier: entry.tier,
    });

    embed.setThumbnail(thumbUrl || 'https://placehold.co/96x96/png?text=TFT');
    return embed;
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
            .setName('region')
            .setDescription('Region like NA, EUW, KR')
            .setRequired(true)
            .addChoices(...REGION_CHOICES)
        ),

    async execute(interaction) {
        // 1. Pull user inputs from disc command
        const gameName = interaction.options.getString('gamename', true);
        const tagLine = interaction.options.getString('tagline', true);

        // 2. Normalize platform + get regional routing
        const regionInput = interaction.options.getString('region', true);       
        const {platform, regional } = resolveRegion(regionInput);
        
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
        const embeds = [];

        if (rankedEntry) {
            embeds.push(
                await buildQueueEmbed({ account, label: 'Ranked', entry: rankedEntry })
            );
        }
        
        if (doubleUpEntry) {
            embeds.push(
                await buildQueueEmbed({ account, label: 'Double Up', entry: doubleUpEntry })
            );
        }

        // 8. If no ranked entries, show unranked message
        if (embeds.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`${account.gameName}#${account.tagLine}'s TFT Rank:`)
                .setDescription('Unranked')
                .setThumbnail('https://placehold.co/96x96/png?text=TFT')
            embeds.push(embed);
        }

        await interaction.editReply({ embeds });
    },
};
