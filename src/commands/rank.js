import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getTftRegaliaThumbnailUrl, getLeagueOfGraphsUrl } from "../riot.js";
import { QUEUE_TYPES, queueLabel } from "../constants/queues.js"
import { loadDb } from "../storage.js";
import { respondWithAccountChoices } from "../utils/autocomplete.js";
import { formatRankLine, formatWinrate } from "../utils/presentation.js";

/* Add a section for a specific queue type to the fields array 
   - A header field with the rank line
   - 3 inline stat fields (Wins/Losses/Winrate) aligned as columns */
function addQueueSection(fields, label, entry) {
    const wins = entry.wins ?? 0;
    const losses = entry.losses ?? 0;
    const wr = formatWinrate(wins, losses);

    // Header / rank line
    fields.push({ name: label, value: `**${formatRankLine(entry)}**`, inline: false });
    fields.push(
        { name: "Wins", value: `${wins}`, inline: true },
        { name: "Losses", value: `${losses}`, inline: true },
        { name: "Winrate", value: `${wr}`, inline: true }
    );
}

function formatLastUpdated(lastUpdatedAt) {
    const millis = Number(lastUpdatedAt);
    if (!Number.isFinite(millis) || millis <= 0) return "Unknown";

    const unixSeconds = Math.floor(millis / 1000);
    return `<t:${unixSeconds}:F> (<t:${unixSeconds}:R>)`;
}

async function buildQueueEmbed({account, label, entry}) {
    const fields = [];
    addQueueSection(fields, label, entry);

    fields.push({ name: "Last updated", value: formatLastUpdated(entry.lastUpdatedAt), inline: false });
    const profileUrl = getLeagueOfGraphsUrl({ gameName: account.gameName, tagLine: account.tagLine });

    const embed = new EmbedBuilder()
        .setTitle(`${account.gameName}#${account.tagLine} — ${label}`)
        .addFields(fields)
        .setURL(profileUrl);

    const thumbUrl = await getTftRegaliaThumbnailUrl({ queueType: entry.queueType, tier: entry.tier, });
    if (thumbUrl) embed.setThumbnail(thumbUrl ?? 'https://placehold.co/96x96/png?text=TFT');

    return embed;
}

export default {
    data: new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Look up ranked info for a Riot ID")
        .addStringOption((opt) =>
            opt.setName('account').setDescription('Select a registered Riot ID').setRequired(true).setAutocomplete(true)
        ),
    
    async autocomplete(interaction) {
        await respondWithAccountChoices(interaction);
    },
    
    async execute(interaction) {
        // 1. Make sure command is run in server/guild only
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: "This command can only be used inside a server (not DMs).", ephemeral: true, });
            return;
        }   

        // 2. Defer reply in case of Riot API delays
        await interaction.deferReply();

        // 3. Determine selected account
        const key = interaction.options.getString('account', true);

        const db = await loadDb();
        const guild = db[guildId];
        const accountIdx = guild?.accounts?.findIndex((a) => a.key === key) ?? -1;
        const stored = accountIdx >= 0 ? guild.accounts[accountIdx] : null;

        if (!stored) {
            await interaction.editReply("The selected account is not registered in this server. Try registering again.");
            return;
        }

        // 4. Pull out rank info for TFT queues
        let rankByQueue = stored.lastRankByQueue ?? {};

        // 5. Pull out queues we care about
        const rankedEntry = rankByQueue[QUEUE_TYPES.RANKED_TFT]
            ? { ...rankByQueue[QUEUE_TYPES.RANKED_TFT], queueType: QUEUE_TYPES.RANKED_TFT }
            : null;
        const doubleUpEntry = rankByQueue[QUEUE_TYPES.RANKED_TFT_DOUBLE_UP]
            ? { ...rankByQueue[QUEUE_TYPES.RANKED_TFT_DOUBLE_UP], queueType: QUEUE_TYPES.RANKED_TFT_DOUBLE_UP }
            : null;


        // 6. Build embed fields
        const embeds = [];

        if (rankedEntry) {
            embeds.push(
                await buildQueueEmbed({ 
                    account: stored, 
                    label: queueLabel(QUEUE_TYPES.RANKED_TFT), 
                    entry: rankedEntry 
                })
            );
        }
        if (doubleUpEntry) {
            embeds.push(
                await buildQueueEmbed({ 
                    account: stored, 
                    label: queueLabel(QUEUE_TYPES.RANKED_TFT_DOUBLE_UP), 
                    entry: doubleUpEntry 
                })
            );
        }

        // 7. If no ranked entries, show unranked message
        if (embeds.length === 0) {
            embeds.push(
                new EmbedBuilder()
                .setTitle(`${stored.gameName}#${stored.tagLine}'s TFT Rank:`)
                .setDescription('Unranked')
            )
        }
        
        //8. Send reply with embeds
        await interaction.editReply({ embeds: [embeds[0]] });
        if (embeds[1]) await interaction.followUp({ embeds: [embeds[1]] });
    },
};
