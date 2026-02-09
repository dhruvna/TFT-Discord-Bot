import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import config from './config.js';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const token = config.discordBotToken;
const clientId = config.discordClientId;

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const module = await import(url.pathToFileURL(filePath));
    const command = module.default;
    if (!command?.data || typeof command.execute !== 'function') {
        console.warn(`Skipping ${file}: missing default export with { data, execute }`);
        continue;
    }
    commands.push(command.data.toJSON());
    console.log(`Loaded command ${command.data.name}`);
}

const rest = new REST({ version: '10' }).setToken(token);

console.log('Registering slash commands (guild-only)...');

const guildId = config.discordGuildId;

await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
);

console.log('Guild slash command registration complete.');
