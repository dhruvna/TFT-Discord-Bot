// === Imports ===
// We rely on the filesystem to persist registrations and per-guild settings.
import fs from 'node:fs/promises';
import path from 'node:path';

// === File locations ===
// Use a default path in the repo while allowing overrides via env vars.
const DEFAULT_DATA_PATH = path.join(process.cwd(), 'user_data', 'registrations.json');
const DATA_PATH = process.env.DATA_PATH
    ? path.resolve(process.env.DATA_PATH)
    : path.join(process.env.DATA_DIR ?? path.dirname(DEFAULT_DATA_PATH), 'registrations.json');

// Serialize write operations so RMW cycles don't collide.
let writeQueue = Promise.resolve();

function enqueueWrite(operation) {
    const run = writeQueue.then(operation, operation);
    writeQueue = run.then(() => undefined, () => undefined); // Prevent unhandled rejections from blocking the queue
    return run;
}

// === File initialization ===
// Ensure the data file exists so callers can assume read/write will work.
async function ensureDataFile() {
    const dir = path.dirname(DATA_PATH);

    // Ensure ./data directory exists
    await fs.mkdir(dir, { recursive: true });

    // Ensure registrations.json exists
    try {
        await fs.access(DATA_PATH);
    } catch {
        await fs.writeFile(DATA_PATH, '{}', 'utf8');
    }
}

async function writeDbAtomically(db) {
    await ensureDataFile();
    const tmp = `${DATA_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf-8');
    await fs.rename(tmp, DATA_PATH);
}

// === Database IO ===
// Read the JSON file into an object, falling back to an empty object on error.
export async function loadDb() {
    await ensureDataFile();
    try {
        const raw = await fs.readFile(DATA_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// Write the DB atomically (write temp -> rename) to avoid corruption.
export async function saveDb(db) {
    return enqueueWrite(async () => {
        await writeDbAtomically(db);
    });
}

// Queue-backed read-modify-write transaction.
export async function mutateDb(mutator) {
    return enqueueWrite(async () => {
        const db = await loadDb();
        const result = await mutator(db);
        const didChange = result?.didChange ?? true;
        if (didChange) {
            await writeDbAtomically(db);
        }
        return result;
    });
}

export async function mutateGuild(guildId, mutator) {
    return mutateDb(async (db) => {
        const guild = ensureGuild(db, guildId);
        return mutator({ db, guild });
    });
}

// === Guild normalization ===
// Ensure a guild object exists and has the minimum required shape.
function ensureGuild(db, guildId) {
    if (!db[guildId]) db[guildId] = {};
    if (!Array.isArray(db[guildId].accounts)) db[guildId].accounts = [];
    if (!('channelId' in db[guildId])) db[guildId].channelId = null;    

    if (!('announceQueues' in db[guildId])) {
        db[guildId].announceQueues = ['RANKED_TFT', 'RANKED_TFT_DOUBLE_UP'];
    }

    if (!('recap' in db[guildId]) || typeof db[guildId].recap !== 'object' || db[guildId].recap === null) {
        db[guildId].recap = {
            enabled: false,
            mode: 'DAILY',          // DAILY | WEEKLY
            queue: 'RANKED_TFT',    // RANKED_TFT | RANKED_TFT_DOUBLE_UP
            lastSentYmd: null,      // "YYYY-MM-DD" to prevent double posting
        };
    } else {
        // If older configs exist, ensure required keys exist.
        if (!('enabled' in db[guildId].recap)) db[guildId].recap.enabled = false;
        if (!('mode' in db[guildId].recap)) db[guildId].recap.mode = 'DAILY';
        if (!('queue' in db[guildId].recap)) db[guildId].recap.queue = 'RANKED_TFT';
        if (!('lastSentYmd' in db[guildId].recap)) db[guildId].recap.lastSentYmd = null;

        // Optional cleanup: remove legacy hour/minute if they exist
        if ('hour' in db[guildId].recap) delete db[guildId].recap.hour;
        if ('minute' in db[guildId].recap) delete db[guildId].recap.minute;
    }
    return db[guildId];
}

// Build a stable key used to deduplicate accounts.
export function makeAccountKey({ gameName, tagLine, platform }) {
    return `${gameName}#${tagLine}@${platform}`.toLowerCase();
}

// === Account Creation, Read, Update, Deletion ===
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

export async function upsertGuildAccountInStore(guildId, account) {
    return mutateGuild(guildId, async ({ db }) => {
        const upserted = await upsertGuildAccount(db, guildId, account);
        return { ...upserted, didChange: true };
    });
}

// Only persist when the caller indicates a change to reduce disk writes.
export async function saveDbIfChanged(db, didChange) {
    if (didChange) await saveDb(db);
}

export async function removeGuildAccountByKey(guildId, key) {
    return mutateGuild(guildId, async ({ guild }) => {
        if (!guild?.accounts?.length) return { removed: null, didChange: false };
        const idx = guild.accounts.findIndex((a) => a.key === key);
        if (idx === -1) return { removed: null, didChange: false };
        const [removed] = guild.accounts.splice(idx, 1);
        return { removed, didChange: true };
    }).then((result) => result?.removed ?? null);
}

// === Guild-level settings ===
export function getGuildChannelId(db, guildId) {
    return db?.[guildId]?.channelId ?? null;
}

export async function setGuildChannel(db, guildId, channelId) {
    const g = ensureGuild(db, guildId);
    g.channelId = channelId;
    return { channelId };
}

export async function setGuildChannelInStore(guildId, channelId) {
    return mutateGuild(guildId, async ({ db }) => {
        const updated = await setGuildChannel(db, guildId, channelId);
        return { ...updated, didChange: true };
    });
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

export async function setGuildRecapConfigInStore(guildId, patch) {
    return mutateGuild(guildId, ({ db }) => {
        const recap = setGuildRecapConfig(db, guildId, patch);
        return { recap, didChange: true };
    }).then((result) => result?.recap ?? null);
}

export async function setGuildRecapLastSentYmdInStore(guildId, lastSentYmd) {
    return mutateGuild(guildId, ({ guild }) => {
        const current = guild?.recap?.lastSentYmd ?? null;
        if (current === lastSentYmd) {
            return { didChange: false, updated: false };
        }
        guild.recap.lastSentYmd = lastSentYmd;
        return { didChange: true, updated: true };
    }).then((result) => result?.updated ?? false);
}

export async function setGuildQueueConfig(db, guildId, queues) {
    const g = ensureGuild(db, guildId);
    g.announceQueues = queues;
    return g.announceQueues;
}

export async function setGuildQueueConfigInStore(guildId, queues) {
    return mutateGuild(guildId, async ({ db }) => {
        const announceQueues = await setGuildQueueConfig(db, guildId, queues);
        return { announceQueues, didChange: true };
    });
}

export async function setGuildChannelAndQueueConfigInStore(guildId, { channelId, queues }) {
    return mutateGuild(guildId, async ({ db }) => {
        await setGuildChannel(db, guildId, channelId);
        const announceQueues = await setGuildQueueConfig(db, guildId, queues);
        return { didChange: true, channelId, announceQueues };
    });
}

export function getKnownGuildIds(db) {
    if (!db || typeof db !== 'object') return [];

    return Object.keys(db)
        .filter((guildId) => /^\d{17,20}$/.test(guildId));
}
