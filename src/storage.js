import fs from 'node:fs/promises';
import path from 'node:path';  

const DATA_PATH = path.join(process.cwd(), 'user_data', 'registrations.json');

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
    await ensureDataFile();
    const tmp = `${DATA_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf-8');
    await fs.rename(tmp, DATA_PATH);
}

function ensureGuild(db, guildId) {
    if (!db[guildId]) db[guildId] = {};
    if (!Array.isArray(db[guildId].accounts)) db[guildId].accounts = [];
    if (!("channelId" in db[guildId])) db[guildId].channelId = null;

    if (!("recap" in db[guildId]) || typeof db[guildId].recap !== "object" || db[guildId].recap === null) {
        db[guildId].recap = {
            enabled: false,
            mode: "DAILY",          // DAILY | WEEKLY
            queue: "RANKED_TFT",    // RANKED_TFT | RANKED_TFT_DOUBLE_UP
            lastSentYmd: null,      // "YYYY-MM-DD" to prevent double posting
        };
    } else {
        // If older configs exist, ensure required keys exist.
        if (!("enabled" in db[guildId].recap)) db[guildId].recap.enabled = false;
        if (!("mode" in db[guildId].recap)) db[guildId].recap.mode = "DAILY";
        if (!("queue" in db[guildId].recap)) db[guildId].recap.queue = "RANKED_TFT";
        if (!("lastSentYmd" in db[guildId].recap)) db[guildId].recap.lastSentYmd = null;

        // Optional cleanup: remove legacy hour/minute if they exist
        if ("hour" in db[guildId].recap) delete db[guildId].recap.hour;
        if ("minute" in db[guildId].recap) delete db[guildId].recap.minute;
    }
    return db[guildId];
}

export function makeAccountKey({ gameName, tagLine, platform }) {
    return `${gameName}#${tagLine}@${platform}`.toLowerCase();
}

export async function listGuildAccounts(guildId) {
  const db = await loadDb();
  return db[guildId]?.accounts ?? [];
}

export async function getGuildAccountByKey(guildId, key) {
    const accounts = await listGuildAccounts(guildId);
    return accounts.find((a) => a.key === key) ?? null;
}

export async function upsertGuildAccount(db, guildId, account) {
    const guild = ensureGuild(db, guildId);

    const idx = guild.accounts.findIndex((a) => a.key === account.key);
    const existed = idx >= 0;

    if (existed) guild.accounts[idx] = { ...guild.accounts[idx], ...account };
    else guild.accounts.push(account);

    return { account, existed };
}

export async function saveDbIfChanged(db, didChange) {
  if (didChange) await saveDb(db);
}

export async function removeGuildAccountByKey(guildId, key) {
    const db = await loadDb();
    const guild = db[guildId];
    if (!guild?.accounts?.length) return null;

    const idx = guild.accounts.findIndex((a) => a.key === key);
    if (idx === -1) return null;

    const [removed] = guild.accounts.splice(idx, 1);
    await saveDb(db);
    return removed;
}

export function getGuildChannelId(db, guildId) {
    return db?.[guildId]?.channelId ?? null;
}

export async function setGuildChannel(db, guildId, channelId) {
    const g = ensureGuild(db, guildId);
    g.channelId = channelId;
    return { channelId };
}

export function getGuildRecapConfig(db, guildId) {
    const g = ensureGuild(db, guildId);
    return g.recap;
}

export function setGuildRecapConfig(db, guildId, patch) {
    const g = ensureGuild(db, guildId);
    g.recap = { ...g.recap, ...patch };
    return g.recap;
}