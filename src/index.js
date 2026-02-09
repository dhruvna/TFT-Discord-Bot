// === Imports: runtime dependencies and internal helpers ===
// We group imports up front so the rest of the file reads as a narrative:
// 1) framework primitives, 2) Node utilities, 3) local services/helpers.
import { Client, GatewayIntentBits, Collection } from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { loadDb } from './storage.js';
import { startRecapAutoposter } from './services/recapAutoPoster.js';
import { startMatchPoller } from './services/matchPoller.js';
import config from './config.js';
import { QUEUE_TYPES } from './constants/queues.js';
import { getRankSnapshotForQueue } from './utils/rankSnapshot.js';

// === Configuration ===
// Grab the token once so the login call is simple and we avoid reading config
// from multiple places.
const token = config.discordBotToken;

// === Discord client setup ===
// We scope intents to Guilds to minimize permissions while still supporting
// slash commands and interactions.
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// === Command discovery ===
// Determine the file-system location of this module. We need this to resolve
// the commands folder relative to this file, regardless of how the app is run.
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Store commands in a collection for quick lookup by name at runtime.
client.commands = new Collection();

// Define and read the commands directory, then dynamically import each command.
// We filter to `.js` so this also ignores map files, temp files, etc.
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

// For each command file, import it and add it to the commands collection.
// This keeps new command modules discoverable without manual registration.
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const module = await import(url.pathToFileURL(filePath));
    const command = module.default;
    // Validate shape: commands must expose `data` (for Discord) and `execute`.
    // Missing either is a developer error, so we warn and skip to keep the bot running.

    if (!command?.data || !command?.execute) {
        console.warn(` Command ${file} is missing data or execute()`);
        continue;
    }
    // Cache the command by name for fast lookups on interaction.
    client.commands.set(command.data.name, command);
}

// === Startup hook ===
// Once the client is connected, we log diagnostics and spin up background services.
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Load the database and log some info about each guild for debugging.
    // This gives visibility into accounts, snapshot coverage, and recap config.
    try {
        const db = await loadDb();
        for (const [gid, g] of Object.entries(db)) {
            const accounts = g?.accounts ?? [];
            const rankedSnapshots = accounts.filter((account) =>
                getRankSnapshotForQueue(account, QUEUE_TYPES.RANKED_TFT)?.tier).length;
            console.log(
                `[startup] guild=${gid} channelId=${g?.channelId ?? "null"} accounts=${accounts.length} rankedSnapshots=${rankedSnapshots} recap=${JSON.stringify(
                        g?.recap ?? null
                    )}`
                );
        }
    } catch (e) {
        console.error("[startup] failed reading db:", e);
    }

    // Start the background services that keep the bot up-to-date:
    // - match poller: periodic rank/match updates
    // - recap autoposter: scheduled recap messages
    startMatchPoller(client).catch((error) => {
        console.error("Error in match poller:", error);
    });

    startRecapAutoposter(client).catch((error) => {
        console.error("Error in recap autoposter:", error);
    });
});

// === Interaction routing ===
// All Discord interactions funnel through here. We separate autocomplete from
// chat commands, then dispatch to the appropriate command handler.
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
    // If the interaction is not a chat input command, ignore it.
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if(!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        // Catch command errors to keep the bot alive and respond gracefully.
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

// === Connect ===
// Perform the actual login once all handlers are attached.
client.login(token);
