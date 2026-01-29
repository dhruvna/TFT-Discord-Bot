import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, EmbedBuilder } from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

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

function getOptionalEnv(name, fallback) {
  const v = process.env[name];
  return (v === undefined || v === '') ? fallback : v;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
                                .slice(0, 250);
                        }
                    }

                    console.log(
                        `[match-poller] NEW match guild=${guildId} ${account.key} match=${latest} queue=${queueType} place=${normPlacement} delta=${delta}`
                    );

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
                    } else {
                        console.log(
                            `[match-poller] no channel for guild=${guildId} (channelId=${channelIdForGuild ?? "null"})`
                        );
                    }

                    await upsertGuildAccount(db, guildId, {
                        ...account,
                        lastMatchId: latest,
                        lastRankByQueue: after,
                        recapEvents,
                    });
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
        await saveDb(db);
    };

    await tick();
    setInterval(() => {
        tick().catch((error) => console.error('Match poll tick failed: ', error));
    }, Math.max(10, intervalSeconds) * 1000);
}

async function startRecapAutoposter(client) {
    const FIRE_HOUR = 9;
    const FIRE_MINUTE = 0;

    const tick = async () => {
        const fallbackChannelId = process.env.DISCORD_CHANNEL_ID || null;

        const db = await loadDb();
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
            if (!channel || !channel.isTextBased()) continue;

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
            const hours = mode === "WEEKLY" ? 24 * 7 : 24;
            const cutoff = Date.now() - hours * 60 * 60 * 1000;

            const accounts = guild?.accounts ?? [];

            const rows = accounts.map((account) => {
                const events = Array.isArray(account.recapEvents)
                ? account.recapEvents
                : [];

                const filtered = events.filter(
                    (e) =>
                        Number(e?.at ?? 0) >= cutoff && e.queueType === queue
                );
                
                return {
                    account,
                    games: filtered.length,
                    delta: filtered.reduce((s, e) => s + Number(e.delta ?? 0), 0),
                };
            });

            // Simple embed builder (kept inline to avoid circular imports)
            const sortGains = [...rows].sort((a, b) => {
                if (b.delta !== a.delta) return b.delta - a.delta;
                if (b.games !== a.games) return b.games - a.games;
                const an = `${a.account.gameName}#${a.account.tagLine}`.toLowerCase();
                const bn = `${b.account.gameName}#${b.account.tagLine}`.toLowerCase();
                return an.localeCompare(bn);
            });

            const sortLosses = rows
                .filter((r) => r.delta < 0)
                .sort((a, b) => a.delta - b.delta);

            const medal = (i) =>
                i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;

            const fmt = (d) =>
                d > 0 ? `↑ +${d} LP` : d < 0 ? `↓ ${Math.abs(d)} LP` : "0 LP";

            const gainsLines = sortGains.slice(0, 25).map((r, i) => {
                const name = `${r.account.gameName}#${r.account.tagLine}`;
                const games = r.games > 0 ? ` — ${r.games} games` : "";
                return `${medal(i)} **${name}** ${fmt(r.delta)}${games}`;
            });

            const lossesLines =
                sortLosses.length > 0
                ? sortLosses.slice(0, 10).map((r, i) => {
                    const name = `${r.account.gameName}#${r.account.tagLine}`;
                    const games = r.games > 0 ? ` — ${r.games} games` : "";
                    return `${medal(i)} **${name}** ${fmt(r.delta)}${games}`;
                    })
                : ["—"];

            const totalGames = rows.reduce((s, r) => s + r.games, 0);
            const queueLabel =
                queue === "RANKED_TFT"
                ? "Ranked"
                : queue === "RANKED_TFT_DOUBLE_UP"
                ? "Double Up"
                : queue;
            
            const modeLabel = mode === "WEEKLY" ? "Weekly" : "Daily";
            
            const embed = new EmbedBuilder()
                .setTitle(`${modeLabel} Recap — ${queueLabel}`)
                .addFields(
                {
                    name: "Top gains",
                    value: (gainsLines.join("\n") || "—").slice(0, 1024),
                    inline: true,
                },
                {
                    name: "Top losses",
                    value: (lossesLines.join("\n") || "—").slice(0, 1024),
                    inline: true,
                }
                )
                .setFooter({
                text: `${rows.length} players | ${totalGames} games • last ${hours}h`,
                })
                .setTimestamp(new Date());
        
            await channel.send({ embeds: [embed] });
            
            guild.recap.lastSentYmd = today;
            console.log(`[recap-autopost] sent guild=${guildId} today=${today}`);
        }
        await saveDb(db);
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
