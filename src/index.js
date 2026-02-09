import { Client, GatewayIntentBits, Collection } from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { loadDb, saveDbIfChanged } from './storage.js';
import { QUEUE_TYPES } from './constants/queues.js';
import { buildRecapEmbed, computeRecapRows, hoursForMode } from './utils/recap.js';
import { startMatchPoller } from './services/matchPoller.js';
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

            const {
                mode = "DAILY",
                queue = QUEUE_TYPES.RANKED_TFT,
                lastSentYmd = null,
            } = guild.recap;

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
