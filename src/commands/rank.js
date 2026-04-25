import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getTftRegaliaThumbnailUrl, getLeagueOfGraphsUrl, getLolProfileUrl } from "../riot.js";
import { GAME_TYPES, LOL_QUEUE_TYPES, TFT_QUEUE_TYPES, TRACKING_GAME_CHOICES, queueLabel } from "../constants/queues.js"
import { getLolTracking, getTftTracking, loadDb, normalizeAccountTracking } from "../storage.js";
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
    const profileUrl = entry.gameType === GAME_TYPES.LOL
        ? getLolProfileUrl({ region: account.region, gameName: account.gameName, tagLine: account.tagLine })
        : getLeagueOfGraphsUrl({ region: account.region, gameName: account.gameName, tagLine: account.tagLine });

    const embed = new EmbedBuilder()
        .setTitle(`${account.gameName}#${account.tagLine} — ${label}`)
        .addFields(fields)
        .setURL(profileUrl);

    if (entry.gameType === GAME_TYPES.TFT) {
        const thumbUrl = await getTftRegaliaThumbnailUrl({ queueType: entry.queueType, tier: entry.tier, });
        if (thumbUrl) embed.setThumbnail(thumbUrl ?? 'https://placehold.co/96x96/png?text=TFT');
    }

    return embed;
}

export default {
    data: new SlashCommandBuilder()
        .setName("rank")
        .setDescription("Look up ranked info for a Riot ID")
        .addStringOption((opt) =>
            opt.setName('account').setDescription('Select a Riot ID').setRequired(true).setAutocomplete(true)
        )
        .addStringOption((opt) => 
            opt
                .setName('game')
                .setDescription('Select a which game ranks to choice')
                .setRequired(false)
                .addChoices(...TRACKING_GAME_CHOICES)
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
        await interaction.deferReply({ ephemeral: true });

        // 3. Determine selected account
        const key = interaction.options.getString('account', true);

        const db = await loadDb();
        const guild = db[guildId];
        const accountIdx = guild?.accounts?.findIndex((a) => a.key === key) ?? -1;
        const stored = accountIdx >= 0 ? normalizeAccountTracking(guild.accounts[accountIdx]) : null;

        if (!stored) {
            await interaction.editReply("The selected account is not registered in this server. Try registering again.");
            return;
        }

        const selectedGame = interaction.options.getString('game') ?? "BOTH";
        const shouldShowTft = selectedGame === "BOTH" || selectedGame === "TFT";
        const shouldShowLol = selectedGame === "BOTH" || selectedGame === "LOL";

        // 4. Pull out separate tracked rank snapshots for each game
        const tftTracking = getTftTracking(stored);
        const lolTracking = getLolTracking(stored);
        const tftRankByQueue = tftTracking.lastRankByQueue ?? {};
        const lolRankByQueue = lolTracking.lastRankByQueue ?? {};

        // 5. Pull out queues we care about
        const rankedEntry = tftRankByQueue[TFT_QUEUE_TYPES.RANKED]
            ? { ...tftRankByQueue[TFT_QUEUE_TYPES.RANKED], queueType: TFT_QUEUE_TYPES.RANKED, gameType: GAME_TYPES.TFT }
            : null;
        const doubleUpEntry = tftRankByQueue[TFT_QUEUE_TYPES.RANKED_DOUBLE_UP]
            ? { ...tftRankByQueue[TFT_QUEUE_TYPES.RANKED_DOUBLE_UP], queueType: TFT_QUEUE_TYPES.RANKED_DOUBLE_UP, gameType: GAME_TYPES.TFT }
            : null;
        const lolSoloEntry = lolRankByQueue[LOL_QUEUE_TYPES.RANKED_SOLO_DUO]
            ? { ...lolRankByQueue[LOL_QUEUE_TYPES.RANKED_SOLO_DUO], queueType: LOL_QUEUE_TYPES.RANKED_SOLO_DUO, gameType: GAME_TYPES.LOL }
            : null;
        const lolFlexEntry = lolRankByQueue[LOL_QUEUE_TYPES.RANKED_FLEX]
            ? { ...lolRankByQueue[LOL_QUEUE_TYPES.RANKED_FLEX], queueType: LOL_QUEUE_TYPES.RANKED_FLEX, gameType: GAME_TYPES.LOL }
            : null;

        // 6. Build embed fields
        const embeds = [];

        if (shouldShowTft && rankedEntry) {
            embeds.push(
                await buildQueueEmbed({ 
                    account: stored, 
                    label: queueLabel(GAME_TYPES.TFT, TFT_QUEUE_TYPES.RANKED), 
                    entry: rankedEntry 
                })
            );
        }
        if (shouldShowTft && doubleUpEntry) {
            embeds.push(
                await buildQueueEmbed({ 
                    account: stored, 
                    label: queueLabel(GAME_TYPES.TFT, TFT_QUEUE_TYPES.RANKED_DOUBLE_UP), 
                    entry: doubleUpEntry 
                })
            );
        }
        if (shouldShowLol && lolSoloEntry) {
            embeds.push(
                await buildQueueEmbed({
                    account: stored,
                    label: queueLabel(GAME_TYPES.LOL, LOL_QUEUE_TYPES.RANKED_SOLO_DUO),
                    entry: lolSoloEntry,
                })
            );
        }
        if (shouldShowLol && lolFlexEntry) {
            embeds.push(
                await buildQueueEmbed({
                    account: stored,
                    label: queueLabel(GAME_TYPES.LOL, LOL_QUEUE_TYPES.RANKED_FLEX),
                    entry: lolFlexEntry,
                })
            );
        }
        // 7. If no ranked entries, show unranked message
        if (embeds.length === 0) {
            const gameSuffix = selectedGame === "BOTH" ? "" : ` ${selectedGame === "LOL" ? "LoL" : "TFT"}`;
            embeds.push(
                new EmbedBuilder()
                .setTitle(`${stored.gameName}#${stored.tagLine}'s${gameSuffix} Rank:`)
                .setDescription('Unranked')
            )
        }
        
        //8. Send reply with embeds
        //8. Send reply with embeds (Discord max 10 embeds/message)
        await interaction.editReply({ embeds: embeds.slice(0, 10) });
    },
};
