import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Collection } from 'discord.js';

import { loadDb, saveDb, upsertGuildAccount} from './storage.js';
import { 
    getTFTMatch,
    getTFTMatchIdsByPuuid,
    getTFTRankByPuuid,
    } from './riot.js';

import {
    pickRankSnapshot,
    buildMatchResultEmbed,
    detectQueueMetaFromMatch,
    normalizePlacement,
 } from './utils/tft.js';


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

async function startMatchPoller(client) {
    const intervalSeconds = Number(getOptionalEnv('MATCH_POLL_INTERVAL_SECONDS', '60'));
    const perAccountDelayMs = Number(getOptionalEnv('MATCH_POLL_PER_ACCOUNT_DELAY_MS', '250'));

    const tick = async () => {
        const fallbackChannelId = process.env.DISCORD_CHANNEL_ID || null;
        const channelCache = new Map(); // channelId -> channel (cache per tick)

        const db = await loadDb();
        const guildIds = Object.keys(db);
        if (guildIds.length === 0) return;

        for (const guildId of guildIds) {
            const guild = db[guildId];
            const accounts = guild?.accounts ?? [];

            const channelIdForGuild = guild?.channelId || fallbackChannelId;

            let channel = null;
            if (channelIdForGuild) {
                if (channelCache.has(channelIdForGuild)) {
                    channel = channelCache.get(channelIdForGuild);
                } else {
                    try {
                        channel = await client.channels.fetch(channelIdForGuild);
                    } catch (err) {
                        console.error(`Error fetching channel ${channelIdForGuild} for guild ${guildId}:`, err);
                        channel = null;
                    }
                    channelCache.set(channelIdForGuild, channel);
                }
            }
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
                    
                    const meta = detectQueueMetaFromMatch(match);
                    const queueType = meta.queueType || "RANKED_TFT";

                    const normPlacement = normalizePlacement({ placement, queueType });

                    const afterRank = (queueType === "RANKED_TFT" || queueType === "RANKED_TFT_DOUBLE_UP")
                        ? (after?.[queueType] ?? null)
                        : null;

                    const delta = (queueType === "RANKED_TFT" || queueType === "RANKED_TFT_DOUBLE_UP")
                        ? (deltas?.[queueType] ?? 0)
                        : 0;

                    const isRankedQueue = 
                        queueType === "RANKED_TFT" ||
                        queueType === "RANKED_TFT_DOUBLE_UP";

                    let recapEvents = Array.isArray(account.recapEvents) ? account.recapEvents : [];
                    
                    if (isRankedQueue) {
                        const gameMs = match.info.game_datetime ?? Date.now();

                        const already = recapEvents.some((e) => e.matchId === latest)
                        if (!already) {
                            recapEvents.push({
                                matchId: latest,
                                at: gameMs,
                                queueType,
                                delta: Number(delta ?? 0),
                                placement: Number(normPlacement ?? 0),
                            });

                            recapEvents = recapEvents
                                .sort((a, b) => b.at - a.at)
                                .slice(-250);
                        }
                    }

                    if (channel) {
                        const embed = await buildMatchResultEmbed({
                            account,
                            placement: normPlacement,
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
                        recapEvents,
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

