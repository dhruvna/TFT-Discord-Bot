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

// Login to Discord with the bot's token
const token = config.discordBotToken;

// Create a new client instance with the necessary intents
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

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
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Load the database and log some info about each guild for debugging purposes
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

    // Start the match poller and recap autoposter, and log any errors that occur
    startMatchPoller(client).catch((error) => {
        console.error("Error in match poller:", error);
    });

    startRecapAutoposter(client).catch((error) => {
        console.error("Error in recap autoposter:", error);
    });
});

// Setup a listener for when an interaction is created (e.g., a command is used)
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
    // If the interaction is not a chat input command, ignore it
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
