// utils.js

import { listGuildAccounts } from "../storage.js";

export function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is required`);
  return value;
}

export function getOptionalEnv(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function respondWithAccountChoices(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) return interaction.respond([]);

  const focused = interaction.options.getFocused() ?? "";
  const q = focused.toLowerCase();

  const accounts = await listGuildAccounts(guildId);

  const filtered = 
      q.length === 0
          ? accounts
          : accounts.filter(a => {
              const name = `${a.gameName}#${a.tagLine}`.toLowerCase();
              const region = String(a.region ?? "").toLowerCase();
              return name.includes(q) || region.includes(q);
          });
  
  await interaction.respond(
      filtered.slice(0, 25).map(a => ({
          name: `${a.gameName}#${a.tagLine} (${a.region})`,
          value: a.key,
      }))
  );
}