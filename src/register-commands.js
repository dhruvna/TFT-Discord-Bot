// === Imports ===
// This script registers slash commands with Discord. We keep it separate from
// the bot runtime so command registration can be run on demand.
import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import config from './config.js';

// Resolve the commands directory relative to this file.
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// === Configuration ===
// Pull required values from config once so we can validate early.
const token = config.discordBotToken;
const clientId = config.discordClientId;

// === Command discovery ===
// Collect command JSON payloads by reading the commands directory.
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const module = await import(url.pathToFileURL(filePath));
    const command = module.default;
    // Validate command shape so we only register proper slash command data.
    if (!command?.data || typeof command.execute !== 'function') {
        console.warn(`Skipping ${file}: missing default export with { data, execute }`);
        continue;
    }
    // Discord expects JSON data, so serialize the builder object.
    commands.push(command.data.toJSON());
    console.log(`Loaded command ${command.data.name}`);
}

// === Registration ===
// Use Discord's REST API to register guild-specific commands for faster iteration.
const rest = new REST({ version: '10' }).setToken(token);

console.log('Registering slash commands (guild-only)...');

const guildId = config.discordGuildId;

await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
);

console.log('Guild slash command registration complete.');
