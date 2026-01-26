import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Collection } from 'discord.js';

import { loadDb, saveDb, upsertGuildAccount} from './storage.js';
import { 
    getTFTMatch,
    getTFTMatchIdsByPuuid,
    getTFTRankByPuuid,
    getLeagueOfGraphsUrl,
    getTFTMatchUrl,
    getTftRegaliaThumbnailUrl,
    } from './riot.js';
import { match } from 'node:assert';


function mustGetEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value;
}

// Login to Discord with the bot's token
const token = mustGetEnv('DISCORD_BOT_TOKEN');

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// Load command files
// add comments to explain each step

// Determines pwd of this file
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// Create a collection to hold the commands
client.commands = new Collection();

// Define the path to the commands directory
// Read all JavaScript files in the commands directory
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

//  For each command file, import it and add it to the commands collection
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const module = await import(url.pathToFileURL(filePath));
    const command = module.default;
    // Ensure the command has the required properties. If not, log a warning and skip it.
    if (!command?.data || !command?.execute) {
        console.warn(` Command ${file} is missing data or execute()`);
        continue;
    }
    // Add the command to the collection
    client.commands.set(command.data.name, command);
}

// Setup a listener for when the client is ready and login
client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);

    startMatchPoller(client).catch((error) => {
        console.error("Error in match poller:", error);
    });
});

function getOptionalEnv(name, fallback) {
  const v = process.env[name];
  return (v === undefined || v === '') ? fallback : v;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRankSnapshot(entries) {
    const queues = new Set(["RANKED_TFT", "RANKED_TFT_DOUBLE_UP"]);
    return Object.fromEntries(
        (entries ?? []) 
            .filter((e) => queues.has(e.queueType))
            .map((e) => [e.queueType, { tier: e.tier, rank: e.rank, lp: e.leaguePoints }])
    );
}

function detectQueueTypeFromMatch(match) {
    const info = match?.info;
    if (!info) return null;

    const gameType = String(info.tft_game_type || "").toLowerCase();
    if (gameType === "pairs") return "RANKED_TFT_DOUBLE_UP";

    return "RANKED_TFT";
}

function formatDelta(delta) {
    if (typeof delta !== "number") return "+0"
    return delta >= 0 ? `+${delta}` : `${delta}`;
}

function placementToOrdinal(placement) {
    if (!placement) return "?";
    if (placement === 1) return "1st";
    if (placement === 2) return "2nd";
    if (placement === 3) return "3rd";
    return `${placement}th`;
}

function labelForQueueType(queueType) {
    if (queueType === "RANKED_TFT") return "Ranked";
    if (queueType === "RANKED_TFT_DOUBLE_UP") return "Double Up";
    return queueType || "TFT";
}

export async function buildMatchResultEmbed({ 
    account, 
    placement,
    matchId,
    queueType, 
    delta, 
    afterRank,
 }) {
    const matchUrl = getTFTMatchUrl({ matchId });
    const label = labelForQueueType(queueType);

    const p = typeof placement === "number" ? placement : null;
    const d = typeof delta === "number" ? delta : null;

    const isWin = p !== null ? p <= 4 : null;
    const isLoss = p !== null ? p >= 5 : null;
    
    const embed = new EmbedBuilder()
        .setURL(matchUrl)
        .setTimestamp(new Date());
    
    try {
        const thumbUrl = await getTftRegaliaThumbnailUrl({
            queueType,
            tier: afterRank?.tier,
        });
        if (thumbUrl) embed.setThumbnail(thumbUrl);
    } catch {

    }

    const riotId = `${account.gameName}#${account.tagLine}`;
    const ord = p ? placementToOrdinal(p) : 'N/A';

    if (isWin && d >= 0) {
        embed.setColor(0x2dcf71)
            .setTitle(`${label} Victory for ${account.gameName}#${account.tagLine}!`);
        if (placement === 1) embed.setDescription(`**dhruvna coaching DIFF**`);
        else if (placement === 2) embed.setDescription(`Highroller took my 1st smh`);
        else if (placement === 3) embed.setDescription(`Not too shabby for what I thought would be a 6th!`);
        else embed.setDescription(`A 4th is a 4th, we be aight`);
    } else if (isLoss && d < 0) {
        embed.setColor(0xf34e3c)
            .setTitle(`${label} Defeat for ${account.gameName}#${account.tagLine}...`);
        if (placement === 5) embed.setDescription(`Hey 1st loser isn't too bad`);
        else if (placement === 6) embed.setDescription(`Shoulda gone six sevennnnnn`);
        else if (placement === 7) embed.setDescription(`At least it's not an 8th!`);
        else if (placement === 8) embed.setDescription(`**Lil bro went 8th again...**`);
    } else {
        embed
            .setColor(0x5865f2)
            .setTitle(`${label} Result for ${riotId}`)
            .setDescription(p ? `Finished ${ord}.` : `Match completed.`);
    }

    const placementValue = p ? `${ord}` : "Unknown";
    const lpChangeValue = formatDelta(d);

    const rankValue = afterRank?.tier
        ? `${afterRank.tier} ${afterRank.rank} — ${afterRank.lp} LP`
        : "Unranked / not found";
    
    embed.addFields(
        { name: "Placement", value: placementValue, inline: true },
        { name: "LP Change", value: lpChangeValue, inline: true },
        { name: "Rank", value: rankValue, inline: true }
    );
    return embed;
}

async function startMatchPoller(client) {
    const intervalSeconds = Number(getOptionalEnv('MATCH_POLL_INTERVAL_SECONDS', '60'));
    const perAccountDelayMs = Number(getOptionalEnv('MATCH_POLL_PER_ACCOUNT_DELAY_MS', '250'));

    const channelId = process.env.DISCORD_CHANNEL_ID;
    if (!channelId) {
        throw new Error("MATCH_POLL_CHANNEL_ID is not set");
    }

    const tick = async () => {
        const db = await loadDb();
        const guildIds = Object.keys(db);
        if (guildIds.length === 0) return;

        let channel = null;
        if (channelId) {
            try {
                channel = await client.channels.fetch(channelId);
            } catch (err) {
                console.error("Error fetching channel for match poller:", err);
                channel = null;
            }
        }

        for (const guildId of guildIds) {
            const guild = db[guildId];
            const accounts = guild?.accounts ?? [];

            for (const account of accounts) {

                if (!account?.puuid || !account?.regional || !account?.platform || !account?.key) continue;
                try {
                    const ids = await getTFTMatchIdsByPuuid({
                        regional: account.regional,
                        puuid: account.puuid,
                        count: 1,
                    });
                    const latest = Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
                    if (!latest) {
                        await sleep(perAccountDelayMs);
                        continue;
                    }

                    if (latest !== account.lastMatchId) {
                        const match = await getTFTMatch({ regional: account.regional, matchId: latest });
                        const participants = match?.info?.participants ?? [];
                        const me = participants.find((p => p.puuid === account.puuid));
                        const placement = me?.placement ?? null;

                        const before = account.lastRankByQueue ?? {};
                        let after = before;

                        try {
                            const entries = await getTFTRankByPuuid({ 
                                platform: account.platform,
                                puuid: account.puuid
                            });
                            // const entries = await getTFTMatchIdsByPuuid({ platform: account.platform, puuid: account.puuid });
                            after = pickRankSnapshot(entries);
                        } catch {
                        }

                        const deltas = {};
                        for (const [queueType, afterRank] of Object.entries(after)) {
                            const beforeLp = before?.[queueType]?.lp;
                            const afterLp = afterRank?.lp;

                        if (typeof beforeLp === 'number' && typeof afterLp === 'number') {
                            deltas[queueType] = afterLp - beforeLp;
                        }
                    }

                    const queueType = detectQueueTypeFromMatch(match);
                    const afterRank = after?.[queueType] || null;
                    const delta = deltas?.[queueType] ?? 0;

                    if (channel) {
                        const embed = await buildMatchResultEmbed({
                            account,
                            placement,
                            matchId: latest,
                            queueType, 
                            delta,
                            afterRank,
                        });
                        await channel.send({ embeds: [embed] });
                    }

                    await upsertGuildAccount(db, guildId, {
                        ...account,
                        lastMatchId: latest,
                        lastRankByQueue: after,
                    });
                }
            } catch (err) {
                console.error(`Error polling matches for account ${account.key}:`, err);
            }

            await sleep(perAccountDelayMs);
            }
        }
        await saveDb(db);
    };

    await tick();
    setInterval(() => {
        tick().catch((error) => console.error('Match poll tick failed: ', error));
    }, Math.max(10, intervalSeconds) * 1000);
}
client.on('interactionCreate', async (interaction) => {

    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command?.autocomplete) return;
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error(error);
        }
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if(!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: 'Something wrong',
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: 'Something wrong',
                ephemeral: true,
            });
        }
    }
});

client.login(token);

