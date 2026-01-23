import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function mustGetEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value;
}

const token = mustGetEnv('DISCORD_BOT_TOKEN');
const clientId = mustGetEnv('DISCORD_CLIENT_ID');

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

const guildId = mustGetEnv('DISCORD_GUILD_ID');

await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands }
);

console.log('Guild slash command registration complete.');
