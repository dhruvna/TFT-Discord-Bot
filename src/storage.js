import fs from 'node:fs/promises';
import path from 'node:path';  

const DATA_PATH = path.join(process.cwd(), 'data', 'registrations.json');

async function ensureDataFile() {
  const dir = path.dirname(DATA_PATH);

  // Ensure ./data directory exists
  await fs.mkdir(dir, { recursive: true });

  // Ensure registrations.json exists
  try {
    await fs.access(DATA_PATH);
  } catch {
    await fs.writeFile(DATA_PATH, "{}", "utf8");
  }
}

export async function loadDb() {
    await ensureDataFile();
    try {
        const raw = await fs.readFile(DATA_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

export async function saveDb(db) {
    const tmp = `${DATA_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf-8');
    await fs.rename(tmp, DATA_PATH);
}

function ensureGuild(db, guildId) {
    if (!db[guildId]) db[guildId] = { accounts: [] };
    if (!Array.isArray(db[guildId].accounts)) db[guildId].accounts = [];
    return db[guildId];
}

export function makeAccountKey({ gameName, tagLine, platform }) {
    return `${gameName}#${tagLine}@${platform}`.toLowerCase();
}

export async function listGuildAccounts(guildId) {
  const db = await loadDb();
  const guild = db[guildId];
  return guild?.accounts ?? [];
}

export async function upsertGuildAccount(guildId, account) {
    const db = await loadDb();
    const guild = ensureGuild(db, guildId);

    const idx = guild.accounts.findIndex((a) => a.key === account.key);

    let existed = false;

    if (idx >= 0) {
        existed = true;
        guild.accounts[idx] = {
            ...guild.accounts[idx], 
            ...account,
            addedBy: guild.accounts[idx].addedBy,
            addedAt: guild.accounts[idx].addedAt,
        };
    } else {
        guild.accounts.push(account);
    }

    await saveDb(db);
    return { account, existed };
}