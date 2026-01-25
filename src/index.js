import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Collection } from 'discord.js';

import { loadDb, upsertGuildAccount} from './storage.js';
import { 
    getLastTFTMatch,
    getTFTMatchIdsByPuuid,
    getTFTRankByPuuid,
    getLeagueOfGraphsUrl,
    getTFTMatchUrl,
    } from './riot.js';


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
    const queues = new Set([
        'RANKED_TFT',
        'RANKED_TFT_DOUBLE_UP',])
    return Object.fromEntries(
        entries
        .fileter((e) => queues.has(e.queueType))
        .map((e) => [
            e.queueType,
            { tier: e.tier, rank: e.rank, lp: e.leaguePoints },
        ])
    );
}

function formatDelta(n) {
    if (typeof n !== 'number' || Number.isNaN(n) || !Number.isFinite(n)) return '0';
    return `${n >= 0 ? '+' : ''}${n}`;
}

function buildMatchResultEmbed({ account, placement, matchId, deltas, newRanks }) {
    
    const matchUrl = getTFTMatchUrl({ regional: account.regional, matchId });

    const embed = new EmbedBuilder()
        .setTitle(`${account.gameName}#${account.tagLine} — Match Result`)
        .setURL(matchUrl)
        .setDescription(`**Placement:** ${placement}/8`)
        .addFields({ name: 'Match ID', value: `\`${matchId}\``, inline: false });

        const deltaLines = [];
        for (const [queueType, d] of Object.entries(deltas)) {
            const label = 
            queueType === 'RANKED_TFT' ? 'Ranked'
            : queueType === 'RANKED_TFT_DOUBLE_UP' ? 'Double Up'
            : queueType;

            const after = newRanks[queueType];
            if (!after) continue;

            deltaLines.push(
                `**${label}:** ${after.tier} ${after.rank} — ${after.leaguePoints} LP (${formatDelta(d)} LP)`
            );
        }
        
        if (deltaLines.length > 0) {
            embed.addFields({ name: 'LP Change', value: deltaLines.join('\n'), inline: false });
        }

        return embed;
}

async function startMatchPoller(client) {
    const intervalSeconds = Number(getOptionalEnv('MATCH_POLL_INTERVAL_SECONDS', '60'));
    const perAccountDelayMs = Number(getOptionalEnv('MATCH_POLL_PER_ACCOUNT_DELAY_MS', '250'));

    const channelId = process.env.DISCORD_TRACK_CHANNEL_ID;
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
                        const match = await getLastTFTMatch({ regional: account.regional, matchId: latest });
                        const participants = match?.info?.participants ?? [];
                        const me = participants.find((p => p.puuid === account.puuid));
                        const placement = me?.placement ?? null;

                        const before = account.lastRankByQueue ?? {};
                        let after = {};
                        try {
                            const entries = await getTFTMatchIdsByPuuid({ platform: account.platform, puuid: account.puuid });
                            after = pickRankSnapshot(entries);
                        } catch {
                            after = {};
                        }

                        const deltas = {};
                        for (const [queueType, afterRank] of Object.entries(after)) {
                            const beforeLp = before?.[queueType]?.lp;
                            const afterLp = afterRank?.leaguePoints;
                        if (typeof beforeLp === 'number' && typeof afterLp === 'number') {
                            deltas[queueType] = afterLp - beforeLp;
                        }
                    }

                    if (channel) {
                        const embed = buildMatchResultEmbed({
                            account,
                            placement,
                            matchId: latest,
                            deltas,
                            newRanks: after,
                        });
                        await channel.send({ embeds: [embed] });
                    }

                    await upsertGuildAccount(guildId, {
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

