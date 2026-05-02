// === Imports ===
// We rely on the filesystem to persist registrations and per-guild settings.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ANNOUNCE_QUEUES } from './constants/queues.js';
import { config } from 'node:process';

// === File locations ===
// Use a default path in the repo while allowing overrides via env vars.
const DEFAULT_DATA_PATH = path.join(process.cwd(), 'user_data', 'registrations.json');
const DATA_PATH = process.env.DATA_PATH
    ? path.resolve(process.env.DATA_PATH)
    : path.join(process.env.DATA_DIR ?? path.dirname(DEFAULT_DATA_PATH), 'registrations.json');

// Serialize write operations so RMW cycles don't collide.
let writeQueue = Promise.resolve();
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;
const RECAP_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RECAP_CONFIG_ID = 'default';
export const TRACKED_GAMES = {
    TFT: 'tft',
    LOL: 'lol',
};

function normalizeIdentityNamespace(identityNamespace, fallbackPuuid = null) {
    const safeNamespace =
        identityNamespace && typeof identityNamespace === 'object' ? identityNamespace : {};
    return {
        ...safeNamespace,
        puuid: safeNamespace.puuid ?? fallbackPuuid ?? null,
    };
}

function normalizeAccountIdentity(account) {
    const safeIdentity = account?.identity && typeof account.identity === 'object'
        ? account.identity
        : {};
    const legacyPuuid = account?.puuid ?? null;
    return {
        ...safeIdentity,
        [TRACKED_GAMES.TFT]: normalizeIdentityNamespace(safeIdentity[TRACKED_GAMES.TFT], legacyPuuid),
        [TRACKED_GAMES.LOL]: normalizeIdentityNamespace(safeIdentity[TRACKED_GAMES.LOL], null),
    };
}

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

// Queue-backed read-modify-write transaction.
async function mutateDb(mutator) {
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

async function mutateGuild(guildId, mutator) {
    assertValidGuildId(guildId, 'mutateGuild');
    return mutateDb(async (db) => {
        const guild = ensureGuild(db, guildId);
        return mutator({ db, guild });
    });
}

function isValidGuildId(guildId) {
    return typeof guildId === 'string' && DISCORD_SNOWFLAKE_REGEX.test(guildId);
}

function assertValidGuildId(guildId, context = 'storage') {
    if (!isValidGuildId(guildId)) {
        throw new Error(
            `[${context}] Invalid guildId "${String(guildId)}". Expected a Discord snowflake string (17-20 digits).`
        );
    }
}

// === Guild normalization ===
// Ensure a guild object exists and has the minimum required shape.
function ensureGuild(db, guildId) {
    if (!db[guildId]) db[guildId] = {};
    if (!Array.isArray(db[guildId].accounts)) db[guildId].accounts = [];
    db[guildId].accounts = db[guildId].accounts.map((account) => normalizeAccountTracking(account));
    if (!('channelId' in db[guildId])) db[guildId].channelId = null;    

    if (!('announceQueues' in db[guildId])) {
        db[guildId].announceQueues = [...DEFAULT_ANNOUNCE_QUEUES];
    }

    if (!('tft' in db[guildId]) || typeof db[guildId].tft !== 'object' || db[guildId].tft === null) {
        db[guildId].tft = {
            seasonCutoffMs: null,
        };
    } else {
        const numericCutoff = Number(db[guildId].tft.seasonCutoffMs ?? 0);
        db[guildId].tft.seasonCutoffMs =
            Number.isFinite(numericCutoff) && numericCutoff > 0 ? numericCutoff : null;
    }

    if (!Array.isArray(db[guildId].recapConfigs)) {
        const legacyRecap = 
            db[guildId].recap && typeof db[guildId].recap === 'object'
            ? db[guildId].recap
            : null;
        db[guildId].recapConfigs = [normalizeRecapConfig(legacyRecap, DEFAULT_RECAP_CONFIG_ID)];
    } else {
        db[guildId].recapConfigs = db[guildId].recapConfigs.map((cfg, idx) =>
            normalizeRecapConfig(cfg, idx === 0 ? DEFAULT_RECAP_CONFIG_ID : `cfg-${idx + 1}`)
        );
    }
    // Backward compatibility view for legacy callers during transition.
    db[guildId].recap = db[guildId].recapConfigs[0] ?? normalizeRecapConfig(null, DEFAULT_RECAP_CONFIG_ID);
    return db[guildId];
}

function normalizeRecapConfig(config, fallbackId = DEFAULT_RECAP_CONFIG_ID) {
    const safe = config && typeof config === 'object' ? config : {};
    return {
        id: typeof safe.id === 'string' && safe.id.trim() ? safe.id : fallbackId,
        enabled: Boolean(safe.enabled),
        mode: safe.mode ?? 'DAILY',
        game: safe.game ?? 'TFT',
        queue: safe.queue ?? 'RANKED_TFT',
        lastSentYmd: safe.lastSentYmd ?? null,
    };
}

function readLegacyRankByQueue(account) {
    return account?.lastRankByQueue && typeof account.lastRankByQueue === 'object'
        ? account.lastRankByQueue
        : {};
}

function readLegacyRecapEvents(account) {
    return Array.isArray(account?.recapEvents) ? account.recapEvents : [];
}

function readLegacyLastMatchId(account) {
    return account?.lastMatchId ?? null;
}

function normalizeTrackedGameNamespace(
    gameState,
    {
        fallbackEnabled = true,
        fallbackLastMatchId = null,
        fallbackLastMatchAt = null,
        fallbackLastRankByQueue = {},
        fallbackRecapEvents = [],
    } = {}
) {
    const safeGameState = gameState && typeof gameState === 'object' ? gameState : {};
    const numericLastMatchAt = Number(safeGameState.lastMatchAt ?? fallbackLastMatchAt ?? 0);
    const enabled =
        typeof safeGameState.enabled === 'boolean'
            ? safeGameState.enabled
            : Boolean(fallbackEnabled);
    return {
        ...safeGameState,
        enabled,
        lastMatchId: safeGameState.lastMatchId ?? fallbackLastMatchId,
        lastMatchAt: Number.isFinite(numericLastMatchAt) && numericLastMatchAt > 0 ? numericLastMatchAt : null,
        lastRankByQueue:
            safeGameState.lastRankByQueue && typeof safeGameState.lastRankByQueue === 'object'
                ? safeGameState.lastRankByQueue
                : fallbackLastRankByQueue,
        recapEvents: Array.isArray(safeGameState.recapEvents) ? safeGameState.recapEvents : fallbackRecapEvents,
    };
}

export function normalizeAccountTracking(account) {
    if (!account || typeof account !== 'object') return account;

    const normalizedAccount = {
        ...account,
        identity: normalizeAccountIdentity(account),
    };

    const trackedGames = account.trackedGames && typeof account.trackedGames === 'object'
        ? account.trackedGames
        : {};

    const tftTracked = normalizeTrackedGameNamespace(trackedGames[TRACKED_GAMES.TFT], {
        fallbackEnabled: true,
        fallbackLastMatchId: readLegacyLastMatchId(account),
        fallbackLastMatchAt: null,
        fallbackLastRankByQueue: readLegacyRankByQueue(account),
        fallbackRecapEvents: readLegacyRecapEvents(account),
    });
    
    const lolTracked = normalizeTrackedGameNamespace(trackedGames[TRACKED_GAMES.LOL], {
        fallbackEnabled: true,
        fallbackLastMatchId: null,
        fallbackLastMatchAt: null,
        fallbackLastRankByQueue: {},
        fallbackRecapEvents: [],
    });

    normalizedAccount.trackedGames = {
        ...trackedGames,
        [TRACKED_GAMES.TFT]: tftTracked,
        [TRACKED_GAMES.LOL]: lolTracked,
    };

    if ('lastMatchId' in normalizedAccount) delete normalizedAccount.lastMatchId;
    if ('lastRankByQueue' in normalizedAccount) delete normalizedAccount.lastRankByQueue;
    if ('recapEvents' in normalizedAccount) delete normalizedAccount.recapEvents;
    if ('puuid' in normalizedAccount) delete normalizedAccount.puuid;
    
    return normalizedAccount;
}

export function getTrackedGameIdentity(account, gameKey) {
    const normalized = normalizeAccountTracking(account);
    return normalized?.identity?.[gameKey] ?? {};
}

export function getTftIdentity(account) {
    return getTrackedGameIdentity(account, TRACKED_GAMES.TFT);
}

export function getLolIdentity(account) {
    return getTrackedGameIdentity(account, TRACKED_GAMES.LOL);
}

export function getTrackedGameState(account, gameKey) {
    const normalized = normalizeAccountTracking(account);
    return normalized?.trackedGames?.[gameKey] ?? {};
}

export function getTftTracking(account) {
    return getTrackedGameState(account, TRACKED_GAMES.TFT);
}

export function getLolTracking(account) {
    return getTrackedGameState(account, TRACKED_GAMES.LOL);
}

// Build a stable key used to deduplicate accounts.
export function makeAccountKey({ gameName, tagLine, platform }) {
    return `${gameName}#${tagLine}@${platform}`.toLowerCase();
}

// === Account Creation, Read, Update, Deletion ===
export async function listGuildAccounts(guildId) {
    const db = await loadDb();
    const guild = ensureGuild(db, guildId);
    return guild?.accounts ?? [];
}

async function upsertGuildAccount(db, guildId, account) {
    const guild = ensureGuild(db, guildId);

    const idx = guild.accounts.findIndex((a) => a.key === account.key);
    const existed = idx >= 0;

    if (existed) guild.accounts[idx] = normalizeAccountTracking({ ...guild.accounts[idx], ...account });
    else guild.accounts.push(normalizeAccountTracking(account));

    return { account, existed };
}

export async function upsertGuildAccountInStore(guildId, account) {
    return mutateGuild(guildId, async ({ db }) => {
        const upserted = await upsertGuildAccount(db, guildId, account);
        return { ...upserted, didChange: true };
    });
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
async function setGuildChannel(db, guildId, channelId) {
    const g = ensureGuild(db, guildId);
    g.channelId = channelId;
    return { channelId };
}

export function getGuildRecapConfig(db, guildId) {
    const g = ensureGuild(db, guildId);
    return g.recapConfigs[0];
}

export function getGuildRecapConfigs(db, guildId) {
    const g = ensureGuild(db, guildId);
    return g.recapConfigs;
}

export function getGuildTftConfig(db, guildId) {
    const g = ensureGuild(db, guildId);
    return g.tft;
}

export function setGuildRecapConfig(db, guildId, patch) {
    const g = ensureGuild(db, guildId);
    const current = g.recapConfigs[0] ?? normalizeRecapConfig(null, DEFAULT_RECAP_CONFIG_ID);
    g.recapConfigs[0] = normalizeRecapConfig({ ...current, ...patch }, current.id);
    g.recap = g.recapConfigs[0];
    return g.recapConfigs[0];
}

export function setGuildRecapConfigsInStore(guildId, recapConfigs) {
    return mutateGuild(guildId, ({ guild }) => {
        const incoming = Array.isArray(recapConfigs) ? recapConfigs : [];
        guild.recapConfigs = incoming.map((cfg, idx) =>
            normalizeRecapConfig(cfg, idx === 0 ? DEFAULT_RECAP_CONFIG_ID : `cfg-${idx + 1}`)
        );
        guild.recap = guild.recapConfigs[0] ?? normalizeRecapConfig(null, DEFAULT_RECAP_CONFIG_ID);
        return { didChange: true, recapConfigs: guild.recapConfigs };
    }).then((result) => result?.recapConfigs ?? []);
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

export async function setGuildRecapLastSentYmdByIdInStore(guildId, configId, lastSentYmd) {
    return mutateGuild(guildId, ({ guild }) => {
        const recapConfigs = Array.isArray(guild?.recapConfigs) ? guild.recapConfigs : [];
        const idx = recapConfigs.findIndex((cfg) => cfg?.id === configId);
        if (idx < 0) return { didChange: false, updated: false };
        const current = recapConfigs[idx]?.lastSentYmd ?? null;
        if (current === lastSentYmd) return { didChange: false, updated: false };
        recapConfigs[idx].lastSentYmd = lastSentYmd;
        guild.recap = recapConfigs[0] ?? guild.recap;
        return { didChange: true, updated: true };
    }).then((result) => result?.updated ?? false);
}

export async function setGuildTftConfigInStore(guildId, patch) {
    return mutateGuild(guildId, ({ guild }) => {
        const current = guild?.tft && typeof guild.tft === 'object'
            ? guild.tft
            : { seasonCutoffMs: null };
        const nextCutoff = Number(patch?.seasonCutoffMs ?? 0);
        const normalizedPatch = {
            ...patch,
            seasonCutoffMs: Number.isFinite(nextCutoff) && nextCutoff > 0 ? nextCutoff : null,
        };
        const next = { ...current, ...normalizedPatch };

        if (JSON.stringify(next) === JSON.stringify(current)) {
            return { didChange: false, tft: current };
        }

        guild.tft = next;
        return { didChange: true, tft: next };
    }).then((result) => result?.tft ?? null);
}

async function setGuildQueueConfig(db, guildId, queues) {
    const g = ensureGuild(db, guildId);
    g.announceQueues = queues;
    return g.announceQueues;
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
        .filter((guildId) => isValidGuildId(guildId));
}

export function pruneExpiredRecapEventsInDb(db, nowMs = Date.now()) {
    if (!db || typeof db !== 'object') {
        return {
            didChange: false,
            prunedEvents: 0,
            touchedAccounts: 0
        };        
    }

    const cutoffMs = nowMs - RECAP_EVENT_RETENTION_MS;
    let didChange = false;
    let prunedEvents = 0;
    let touchedAccounts = 0;

    for (const guildId of getKnownGuildIds(db)) {
        const guild = ensureGuild(db, guildId);
        for (const account of guild.accounts) {
            const tftTracking = getTftTracking(account);
            const lolTracking = getLolTracking(account);
            let accountTouched = false;

            for (const tracking of [tftTracking, lolTracking]) {
                const recapEvents = Array.isArray(tracking?.recapEvents) ? tracking.recapEvents : [];
                if (recapEvents.length === 0) continue;
                const nextRecapEvents = recapEvents.filter((event) => Number(event?.at ?? 0) > cutoffMs);
                const removedCount = recapEvents.length - nextRecapEvents.length;
                if (removedCount <= 0) continue;

                tracking.recapEvents = nextRecapEvents;
                didChange = true;
                prunedEvents += removedCount;
                accountTouched = true;
            }
            if (accountTouched) touchedAccounts += 1;
        }
    }

    return { didChange, prunedEvents, touchedAccounts };
}

export async function pruneExpiredRecapEventsInStore(nowMs = Date.now()) {
    return mutateDb((db) => pruneExpiredRecapEventsInDb(db, nowMs));
}

export async function resetGuildAccountProgressInStore(guildId, options = {}) {
    return resetGuildAccountProgressBeforeInStore(guildId, null, options);
}

export async function resetGuildAccountProgressBeforeInStore(guildId, cutoffMs, options = {}) {
    const hasCutoff = Number.isFinite(cutoffMs) && cutoffMs > 0;
    const clearMatchCursor = options?.clearMatchCursor === true;
    const requestedScope = Array.isArray(options?.gameScope) && options.gameScope.length > 0
        ? options.gameScope
        : [TRACKED_GAMES.TFT]; // backward-compatible default
    return mutateGuild(guildId, ({ guild }) => {
        const accounts = Array.isArray(guild?.accounts) ? guild.accounts : [];
        if (accounts.length === 0) {
            return { didChange: false, totalAccounts: 0, resetAccounts: 0 };
        }

        let resetAccounts = 0;
        let skippedAccounts = 0;

        for (const account of accounts) {
            let accountReset = false;
            let accountSkippedByCutoff = false;

            for (const gameKey of requestedScope) {
                const tracking = gameKey === TRACKED_GAMES.LOL ? getLolTracking(account) : getTftTracking(account);
                const lastMatchAt = Number(tracking?.lastMatchAt ?? 0);
                const shouldResetForCutoff =
                    !hasCutoff ||
                    !Number.isFinite(lastMatchAt) ||
                    lastMatchAt <= 0 ||
                    lastMatchAt < cutoffMs;
                if (!shouldResetForCutoff) {
                    accountSkippedByCutoff = true;
                    continue;
                }

                const hadLastMatchId = Boolean(tracking?.lastMatchId);
                const hadRankSnapshot = 
                    tracking?.lastRankByQueue && Object.keys(tracking.lastRankByQueue).length > 0;
                const hadRecapEvents = Array.isArray(tracking?.recapEvents) && tracking.recapEvents.length > 0;
                const hadMatchCursor = Boolean(tracking?.lastMatchId) || Number(tracking?.lastMatchAt ?? 0) > 0;

                if (clearMatchCursor) {
                    tracking.lastMatchId = null;
                    tracking.lastMatchAt = null;
                }

                tracking.lastRankByQueue = {};
                tracking.recapEvents = [];

                if (hadLastMatchId || hadRankSnapshot || hadRecapEvents || (clearMatchCursor && hadMatchCursor)) {
                    accountReset = true;
                }
            }
            if (accountSkippedByCutoff && !accountReset) skippedAccounts += 1;
            if (accountReset) resetAccounts += 1;
        }

        return {
            didChange: resetAccounts > 0,
            totalAccounts: accounts.length,
            resetAccounts,
            skippedAccounts,
            cutoffMs: hasCutoff ? cutoffMs : null,
            clearMatchCursor,
        };
    });
}
