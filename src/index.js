import { Client, GatewayIntentBits, Collection } from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { loadDb, saveDbIfChanged, upsertGuildAccount} from './storage.js';
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
    standardizeRankLp
 } from './utils/tft.js';
import { createRiotRateLimiter } from './utils/rateLimiter.js';
import { buildRecapEmbed, computeRecapRows, hoursForMode } from './utils/recap.js';
import { sleep } from './utils/utils.js';
import config from './config.js';

// Login to Discord with the bot's token
const token = config.discordBotToken;

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

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shouldRefreshRank(account, now, maxAgeMs) {
  if (!account?.lastRankByQueue) return true;
  const entries = Object.values(account.lastRankByQueue);
  if (entries.length === 0) return true;
  return entries.some((entry) => {
    const lastUpdatedAt = Number(entry?.lastUpdatedAt ?? 0);
    return !Number.isFinite(lastUpdatedAt) || now - lastUpdatedAt >= maxAgeMs;
  });
}

async function startMatchPoller(client) {
    const intervalSeconds = config.matchPollIntervalSeconds;
    const perAccountDelayMs = config.matchPollPerAccountDelayMs;
    const riotLimiter = createRiotRateLimiter({ perSecond: 20, perTwoMinutes: 100 });
    const rankRefreshMinutes = config.rankRefreshIntervalMinutes;
    const rankRefreshMs = rankRefreshMinutes * 60 * 1000;


    const tick = async () => {
        const fallbackChannelId = config.discordChannelId;
        const channelCache = new Map(); // channelId -> channel (cache per tick)

        const db = await loadDb();
        let didChange = false;
        const guildIds = Object.keys(db);
        if (guildIds.length === 0) return;

        console.log(
            `[match-poller] tick guilds=${guildIds.length} interval=${intervalSeconds}s perAccountDelay=${perAccountDelayMs}ms`
        );

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
                if (!account?.puuid || !account?.regional || !account?.platform || !account?.key) {
                    await sleep(perAccountDelayMs);
                    continue;
                }
                
                try {
                    const now = Date.now();
                    if (shouldRefreshRank(account, now, rankRefreshMs)) {
                        try {
                            await riotLimiter.acquire();
                            const entries = await getTFTRankByPuuid({
                                platform: account.platform,
                                puuid: account.puuid,
                            });
                            const refreshed = pickRankSnapshot(entries);
                            await upsertGuildAccount(db, guildId, {
                                ...account,
                                lastRankByQueue: refreshed,
                            });
                            didChange = true;
                        } catch (err) {
                            console.error(
                                `Error refreshing rank for account ${account.key} (guild=${guildId}):`,
                                err
                            );
                        }
                    }

                    const matchBackfillLimit = 10;
                    let unseenMatchIds = [];

                    if (!account.lastMatchId) {
                        await riotLimiter.acquire();
                        const ids = await getTFTMatchIdsByPuuid({
                            regional: account.regional,
                            puuid: account.puuid,
                            count: 1,
                        });
                        unseenMatchIds = Array.isArray(ids) ? ids.slice(0, 1) : [];
                    } else {
                        let start = 0;
                        let foundLast = false;

                        while (unseenMatchIds.length < matchBackfillLimit && !foundLast) {
                            const remaining = matchBackfillLimit - unseenMatchIds.length;

                            const count = Math.min(20, remaining); // fetch in batches of 20
                            await riotLimiter.acquire();
                            const ids = await getTFTMatchIdsByPuuid({
                                regional: account.regional,
                                puuid: account.puuid,
                                count,
                                start,
                            });
                            if (!Array.isArray(ids) || ids.length === 0) {
                                break; // no more matches
                            }

                            for (const id of ids) {
                                if (id === account.lastMatchId) {
                                    foundLast = true;
                                    break;
                                }
                                unseenMatchIds.push(id);
                                if (unseenMatchIds.length >= matchBackfillLimit) {
                                    break;
                                } 
                                if (foundLast || ids.length < count) break;
                                start += ids.length;
                            }
                        }
                        
                        if (unseenMatchIds.length === 0) {
                        await sleep(perAccountDelayMs);
                        continue;
                    }

                    const orderedMatchIds = [...unseenMatchIds].reverse();
                    const before = account.lastRankByQueue ?? {};
                    let after = before;
                    let recapEvents = Array.isArray(account.recapEvents) ? account.recapEvents : [];
                    const announceQueues = guild?.announceQueues ?? ["RANKED_TFT", "RANKED_TFT_DOUBLE_UP"];
                    let lastProcessedMatchId = account.lastMatchId;

                    for (const [index, matchId] of orderedMatchIds.entries()) {
                        const isMostRecent = index === orderedMatchIds.length - 1;
                        await riotLimiter.acquire();
                        const match = await getTFTMatch({ regional: account.regional, matchId});
                        const participants = match?.info?.participants ?? [];
                        const me = participants.find((p => p.puuid === account.puuid));
                        const placement = me?.placement ?? null;
                        
                        const meta = detectQueueMetaFromMatch(match);
                        const queueType = meta.queueType || "RANKED_TFT";
                        const isRankedQueue =
                            queueType === "RANKED_TFT" || queueType === "RANKED_TFT_DOUBLE_UP";

                        if (isMostRecent && isRankedQueue) {
                            try {
                                await riotLimiter.acquire();
                                const entries = await getTFTRankByPuuid({
                                    platform: account.platform,
                                    puuid: account.puuid,
                                });
                                after = pickRankSnapshot(entries);
                            } catch {
                            }
                        }

                        const deltas = {};
                        for (const [queueType, afterRank] of Object.entries(after)) {
                            const beforeRank = before?.[queueType];

                            const beforeStd = standardizeRankLp(beforeRank);
                            const afterStd = standardizeRankLp(afterRank);
                            
                            if (Number.isFinite(beforeStd) && Number.isFinite(afterStd)) {
                                deltas[queueType] = afterStd - beforeStd;
                            }
                        }
                    
                    const shouldAnnounce = !announceQueues || announceQueues.includes(queueType);
                        if (!shouldAnnounce) {
                            console.log(
                                `[match-poller] skipping announcement for guild=${guildId} account=${account.key} match=${matchId} queue=${queueType} (not in announceQueues)`
                            );
                            lastProcessedMatchId = matchId;
                            continue;
                        }
                    
                    const normPlacement = normalizePlacement({ placement, queueType }); 

                    const afterRank = (queueType === "RANKED_TFT" || queueType === "RANKED_TFT_DOUBLE_UP") && isMostRecent
                            ? (after?.[queueType] ?? null)
                            : null;

                        const delta = (queueType === "RANKED_TFT" || queueType === "RANKED_TFT_DOUBLE_UP") && isMostRecent
                            ? (deltas?.[queueType] ?? 0)
                            : 0;

                        if (isRankedQueue) {
                            const gameMs = match.info.game_datetime ?? Date.now();

                            const already = recapEvents.some((e) => e.matchId === matchId);
                            if (!already) {
                                recapEvents.push({
                                    matchId,
                                    at: gameMs,
                                    queueType,
                                    delta: Number(delta ?? 0),
                                    placement: Number(normPlacement ?? 0),
                                });

                                recapEvents = recapEvents
                                    .sort((a, b) => b.at - a.at)
                                    .slice(0, 250);
                            }
                        }
                        console.log(
                            `[match-poller] NEW match guild=${guildId} ${account.key} match=${matchId} queue=${queueType} place=${normPlacement} delta=${delta}`
                        );

                        if (channel) {
                            const embed = await buildMatchResultEmbed({
                                account,
                                placement: normPlacement,
                                matchId,
                                queueType,
                                delta,
                                afterRank,
                            });
                            await channel.send({ embeds: [embed] });
                        } else {
                            console.log(
                                `[match-poller] no channel for guild=${guildId} (channelId=${channelIdForGuild ?? "null"})`
                            );
                        }

                        lastProcessedMatchId = matchId;

                    }

                    await upsertGuildAccount(db, guildId, {
                        ...account,
                        // lastMatchId: latest,
                        lastMatchId: lastProcessedMatchId,
                        lastRankByQueue: after,
                        recapEvents,
                    });
                    didChange = true;
                }
            } catch (err) {
                console.error(
                    `Error polling matches for account ${account.key} (guild=${guildId}):`,
                    err
                );
            }
            await sleep(perAccountDelayMs);
            }
        }
        await saveDbIfChanged(db, didChange);
    };

    await tick();
    setInterval(() => {
        tick().catch((error) => console.error('Match poll tick failed: ', error));
    }, Math.max(10, intervalSeconds) * 1000);
}

async function startRecapAutoposter(client) {
    const FIRE_HOUR = config.recapAutopostHour;
    const FIRE_MINUTE = config.recapAutopostMinute;

    const tick = async () => {
        const fallbackChannelId = process.env.DISCORD_CHANNEL_ID || null;

        const db = await loadDb();
        let didChange = false;
        const guildIds = Object.keys(db);
        if (guildIds.length === 0) return;

        const now = new Date();
        const today = ymdLocal(now);
        const hh = now.getHours();
        const mm = now.getMinutes();

        console.log(
            `[recap-autopost] tick ${today} ${String(hh).padStart(2, "0")}:${String(mm).padStart(
                2,
                "0"
            )} guilds=${guildIds.length}`
        );

        for (const guildId of guildIds) {
            const guild = db[guildId];
            if (!guild?.recap?.enabled) continue;

            const { mode = "DAILY", queue = "RANKED_TFT", lastSentYmd = null } = guild.recap;

            if (hh !== FIRE_HOUR || mm !== FIRE_MINUTE) continue;

            // prevent double post same day
            if (lastSentYmd === today) continue;

            const channelId = guild?.channelId || fallbackChannelId;
            if (!channelId) continue;

            let channel = null;
            try {
                channel = await client.channels.fetch(channelId);
            } catch {
                channel = null;
            }

            if (!channel || !channel.isTextBased()) {
                console.log(
                `[recap-autopost] skip guild=${guildId} (channel not found or not text-based) channelId=${channelId}`
                );
                continue;
            }

            console.log(
                `[recap-autopost] firing guild=${guildId} mode=${mode} queue=${queue} channelId=${channelId}`
            );

            // Build recap rows from stored recapEvents (same logic as /recap)
            const hours = hoursForMode(mode);
            const cutoff = Date.now() - hours * 60 * 60 * 1000;

            const accounts = guild?.accounts ?? [];
            const rows = computeRecapRows(accounts, cutoff, queue);
            const embed = buildRecapEmbed({ rows, mode, queue, hours });
        
            await channel.send({ embeds: [embed] });
            
            guild.recap.lastSentYmd = today;
            didChange = true;
            console.log(`[recap-autopost] sent guild=${guildId} today=${today}`);
        }
        await saveDbIfChanged(db, didChange);
  };

  // run tick every minute
  await tick();
  setInterval(() => tick().catch((e) => console.error("Recap autopost tick failed:", e)), 60 * 1000);
}

// Setup a listener for when the client is ready and login
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        const db = await loadDb();
        for (const [gid, g] of Object.entries(db)) {
            console.log(
            `[startup] guild=${gid} channelId=${g?.channelId ?? "null"} recap=${JSON.stringify(
            g?.recap ?? null
            )}`
        );
        }
    } catch (e) {
        console.error("[startup] failed reading db:", e);
    }

    startMatchPoller(client).catch((error) => {
        console.error("Error in match poller:", error);
    });

    startRecapAutoposter(client).catch((error) => {
        console.error("Error in recap autoposter:", error);
    });
});

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
