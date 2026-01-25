import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { 
    getTFTRankByPuuid,
    getTftRegaliaThumbnailUrl,
    getLeagueOfGraphsUrl,
 } from '../riot.js';
import { 
    listGuildAccounts,
    getGuildAccountByKey 
} from "../storage.js";

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
                .setName('account')
                .setDescription('Select a registered Riot ID')
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
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
    },
    
    async execute(interaction) {
        // 1. Make sure command is run in server/guild only
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({
                content: "This command can only be used inside a server (not DMs).",
                ephemeral: true,
            });
            return;
        }   

        // 2. Defer reply in case of Riot API delays
        await interaction.deferReply();

        // 3. Determine selected account
        const key = interaction.options.getString('account', true);
        const stored = await getGuildAccountByKey(guildId, key);

        if (!stored) {
            await interaction.editReply(
                "The selected account is not registered in this server. Try registering again."
            );
            return;
        }

        // 4. PUUID -> TFT Entries (Ranked/Double Up/etc)
        const tftEntries = await getTFTRankByPuuid({
            platform: stored.platform, 
            puuid: stored.puuid 
        });
        // 5. Pull out queues we care about
        const rankedEntry = tftEntries.find(e => e.queueType === 'RANKED_TFT');
        const doubleUpEntry = tftEntries.find(e => e.queueType === 'RANKED_TFT_DOUBLE_UP');

        // 6. Build embed fields
        const embeds = [];

        if (rankedEntry) {
            embeds.push(
                await buildQueueEmbed({ account: stored, label: 'Ranked', entry: rankedEntry })
            );
        }
        
        if (doubleUpEntry) {
            embeds.push(
                await buildQueueEmbed({ account: stored, label: 'Double Up', entry: doubleUpEntry })
            );
        }
        
        // 7. If no ranked entries, show unranked message
        if (embeds.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`${stored.gameName}#${stored.tagLine}'s TFT Rank:`)
                .setDescription('Unranked')
                .setThumbnail('https://placehold.co/96x96/png?text=TFT')
            embeds.push(embed);
        }
        
        //8. Send reply with embeds
        await interaction.editReply({ embeds: [embeds[0].toJSON()] });

        if (embeds[1]) {
        await interaction.followUp({ embeds: [embeds[1].toJSON()] });
        }
    },
};
