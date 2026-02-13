// === Imports ===
// This service orchestrates polling Riot for match updates and sending Discord updates.

import { getKnownGuildIds, loadDb, upsertGuildAccountInStore } from '../storage.js';
import { getTFTMatch, getTFTMatchIdsByPuuid, getTFTRankByPuuid } from '../riot.js';

import {
    buildMatchResultEmbed,
    detectQueueMetaFromMatch,
    normalizePlacement,
 } from '../utils/tft.js';

import {
    computeRankSnapshotDeltas,
    toRankSnapshot,
} from '../utils/rankSnapshot.js';

import {
    DEFAULT_ANNOUNCE_QUEUES,
    QUEUE_TYPES,
    isRankedQueue,
} from '../constants/queues.js';

import { createRiotRateLimiter } from '../utils/rateLimiter.js';
import { sleep } from '../utils/utils.js';
import config from '../config.js';

// === Polling configuration ===
// Limit how far back we look for unseen matches to bound API usage.
const MATCH_BACKFILL_LIMIT = 10;

// === Rank refresh logic ===
// Determine whether cached rank data is stale enough to refresh.
function shouldRefreshRank(account, now, maxAgeMs) {
    if (!account?.lastRankByQueue) return true;
    const entries = Object.values(account.lastRankByQueue);
    if (entries.length === 0) return true;
    return entries.some((entry) => {
        const lastUpdatedAt = Number(entry?.lastUpdatedAt ?? 0);
        return !Number.isFinite(lastUpdatedAt) || now - lastUpdatedAt >= maxAgeMs;
    });
}

// === Riot fetch helpers ===
// Wrap Riot calls so we always respect the rate limiter.
async function fetchMatchIds({ riotLimiter, account, count, start = 0 }) {
    return getTFTMatchIdsByPuuid({
        regional: account.regional,
        puuid: account.puuid,
        count,
        start,
        limiter: riotLimiter,
    });
}

async function fetchMatch({ riotLimiter, account, matchId }) {
    return getTFTMatch({ 
        regional: account.regional, 
        matchId,
        limiter: riotLimiter,
    });
}


// === Match discovery ===
// Build a list of match IDs that are newer than the last seen match.
function collectUnseenMatchIds({ ids, lastMatchId, unseenMatchIds, limit }) {
    let foundLast = false;

    for (const id of ids) {
        if (id === lastMatchId) {
            foundLast = true;
            break;
        }
        unseenMatchIds.push(id);
        if (unseenMatchIds.length >= limit) {
            break;
        }
    }

    return { unseenMatchIds, foundLast };
}

async function detectUnseenMatchIds({ account, matchBackfillLimit, fetchMatchIdsByAccount}) {
    // If we have never seen a match for this account, fetch just one ID to seed it.
    if (!account.lastMatchId) {
        const ids = await fetchMatchIdsByAccount({ count: 1, start: 0 });
        return Array.isArray(ids) ? ids.slice(0, 1) : [];
    }

    let unseenMatchIds = [];
    let start = 0;
    let foundLast = false;

    while (unseenMatchIds.length < matchBackfillLimit && !foundLast) {
        const remaining = matchBackfillLimit - unseenMatchIds.length;
        const count = Math.min(20, remaining);
        const ids = await fetchMatchIdsByAccount({ count, start });
        if (!Array.isArray(ids) || ids.length === 0) {
            break;
        }

        ({ unseenMatchIds, foundLast } = collectUnseenMatchIds({
            ids,
            lastMatchId: account.lastMatchId,
            unseenMatchIds,
            limit: matchBackfillLimit,
        }));

        if (foundLast || ids.length < count) {
            break;
        }

        start += ids.length;
    }

    return unseenMatchIds;
}

// === Rank snapshot refresh ===
// Convert Riot's raw league entries into our normalized snapshot format.
async function refreshRankSnapshot({ riotLimiter, account }) {
    const entries = await getTFTRankByPuuid({
        platform: account.platform,
        puuid: account.puuid,
        limiter: riotLimiter,
    });
    return toRankSnapshot(entries);
}

// === Recap event buffer ===
// Track a rolling window of recent ranked matches for recap summaries.
function buildRecapEvents({ recapEvents, matchId, queueType, delta, placement, gameMs }) {
    const already = recapEvents.some((event) => event.matchId === matchId);
    if (already) return recapEvents;

    const nextEvents = [
        ...recapEvents,
        {
            matchId,
            at: gameMs,
            queueType,
            delta: Number(delta ?? 0),
            placement: Number(placement ?? 0),
        },
    ];

    return nextEvents.sort((a, b) => b.at - a.at).slice(0, 250);
}

// === Discord announcement ===
// Build an embed and post it in the configured channel (if any).
async function announceMatchToDiscord({
    channel,
    account,
    placement,
    matchId,
    queueType,
    delta,
    afterRank,
    participant,
    messageProfile,
    guildId,
    channelId,
}) {
    if (!channel) {
        console.log(
            `[match-poller] no channel for guild=${guildId} (channelId=${channelId ?? "null"})`
        );
        return;
    }

    const { embed, files } = await buildMatchResultEmbed({
        account,
        placement,
        matchId,
        queueType,
        delta,
        afterRank,
        participant,
        messageProfile,
    });
    await channel.send({ embeds: [embed], files });
}

// Should this match be announced based on guild configuration?
function shouldAnnounceMatch({ announceQueues, queueType }) {
    if (!announceQueues) return true;
    return announceQueues.includes(queueType);
}

// === Service entry point ===
// Polls periodically for new matches and sends announcements.
export async function startMatchPoller(client) {
    const intervalSeconds = config.matchPollIntervalSeconds;
    const basePerAccountDelayMs = config.matchPollPerAccountDelayMs;
    const riotLimiter = createRiotRateLimiter({ perSecond: 20, perTwoMinutes: 100 });
    const rankRefreshMinutes = config.rankRefreshIntervalMinutes;
    const rankRefreshMs = rankRefreshMinutes * 60 * 1000;
    let isTickRunning = false;

    // One polling iteration. Split out to make the setInterval handler simple.
    const tick = async () => {
        if (isTickRunning) {
            console.warn('[match-poller] skipping tick because previous tick is still running');
            return;
        }

        isTickRunning = true;
        try {
            const channelCache = new Map(); // channelId -> channel (cache per tick)

            const db = await loadDb();
            const guildIds = getKnownGuildIds(db);
            if (guildIds.length === 0) return;
        
            const totalAccounts = guildIds.reduce((sum, guildId) => {
                const accounts = db[guildId]?.accounts ?? [];
                return sum + accounts.length;
            }, 0);

            const intervalMs = intervalSeconds * 1000;
            const spreadDelayMs = totalAccounts > 0 ? Math.ceil(intervalMs / totalAccounts) : 0;
            const perAccountDelayMs = Math.max(basePerAccountDelayMs, spreadDelayMs);
            
            console.log(
                `[match-poller] tick guilds=${guildIds.length} interval=${intervalSeconds}s totalAccounts=${totalAccounts} perAccountDelay=${perAccountDelayMs}ms`
            );

            for (const guildId of guildIds) {
                const guild = db[guildId];
                const accounts = guild?.accounts ?? [];
                const channelIdForGuild = guild?.channelId ;

                let channel = null;
                if (channelIdForGuild) {
                    if (channelCache.has(channelIdForGuild)) {
                        channel = channelCache.get(channelIdForGuild);
                    } else {
                        // Cache the channel per tick to avoid repeated fetch calls.
                        try {
                            channel = await client.channels.fetch(channelIdForGuild);
                        } catch (err) {
                            console.error(`Error fetching channel ${channelIdForGuild} for guild ${guildId}:`, err);
                            channel = null;
                        }
                        channelCache.set(channelIdForGuild, channel);
                    }
                }

                for (const account of accounts) {
                    if (!account?.puuid || !account?.regional || !account?.platform || !account?.key) {
                        await sleep(perAccountDelayMs);
                        continue;
                    }
                    
                    try {
                        const now = Date.now();
                        if (shouldRefreshRank(account, now, rankRefreshMs)) {
                            try {
                                const refreshed = await refreshRankSnapshot({ riotLimiter, account });
                                
                                await upsertGuildAccountInStore(guildId, {
                                    ...account,
                                    lastRankByQueue: refreshed,
                                });
                                account.lastRankByQueue = refreshed;
                            } catch (err) {
                                console.error(
                                    `Error refreshing rank for account ${account.key} (guild=${guildId}):`,
                                    err
                                );
                            }
                        }

                    // Fetch unseen match IDs, respecting the backfill limit.
                    const unseenMatchIds = await detectUnseenMatchIds({
                        account,
                        matchBackfillLimit: MATCH_BACKFILL_LIMIT,
                        fetchMatchIdsByAccount: ({ count, start }) =>
                            fetchMatchIds({ riotLimiter, account, count, start }),
                    });
                    
                    if (unseenMatchIds.length === 0) {
                        await sleep(perAccountDelayMs);
                        continue;
                    }

                    // Process matches from oldest to newest so deltas line up.
                    const orderedMatchIds = [...unseenMatchIds].reverse();
                    const before = account.lastRankByQueue ?? {};
                    let after = before;
                    const announceQueues = guild?.announceQueues ?? DEFAULT_ANNOUNCE_QUEUES;
                    let recapEvents = Array.isArray(account.recapEvents) ? account.recapEvents : [];
                    let lastProcessedMatchId = account.lastMatchId;

                    const preparedMatches = [];
                    for (const matchId of orderedMatchIds) {

                    // for (const [index, matchId] of orderedMatchIds.entries()) {
                    //     const isMostRecent = index === orderedMatchIds.length - 1;
                        const match = await fetchMatch({ riotLimiter, account, matchId });
                        const participants = match?.info?.participants ?? [];
                        const me = participants.find((p) => p.puuid === account.puuid);
                        const placement = me?.placement ?? null;
                        
                        const meta = detectQueueMetaFromMatch(match);
                        const queueType = meta.queueType || QUEUE_TYPES.RANKED_TFT;
                        const isRanked = isRankedQueue(queueType);
                        const normPlacement = normalizePlacement({ placement, queueType }); 
                        
                        preparedMatches.push({
                            match,
                            matchId,
                            me,
                            normPlacement,
                            queueType,
                            isRanked,
                        });
                    }

                    let latestRankedIndex = -1;
                    for (let i = preparedMatches.length - 1; i >= 0; i -= 1) {
                        if (preparedMatches[i].isRanked) {
                            latestRankedIndex = i;
                            break;
                        }
                    }

                    for (const [index, prepared] of preparedMatches.entries()) {
                        const {
                            match,
                            matchId,
                            me,
                            normPlacement,
                            queueType,
                            isRanked,
                        } = prepared;
                        const isLatestRankedMatch = index === latestRankedIndex;
                        if (isLatestRankedMatch) {
                        // // Only refresh rank once, for the latest ranked match.
                        // if (isMostRecent && isRanked) {
                            try {
                                after = await refreshRankSnapshot({ riotLimiter, account });
                            } catch {
                                // ignore refresh failure for delta calc
                            }
                        }

                        const deltas = computeRankSnapshotDeltas({ before, after });
                        
                        const afterRank = isLatestRankedMatch ? (after?.[queueType] ?? null) : null;
                        const delta = isLatestRankedMatch ? (deltas?.[queueType] ?? 0) : 0;
                        
                        // Capture recap data independently of announcement filtering.
                        if (isRanked) {
                            const gameMs = match.info.game_datetime ?? Date.now();
                            recapEvents = buildRecapEvents({
                                recapEvents,
                                matchId,
                                queueType,
                                delta,
                                placement: normPlacement,
                                gameMs,
                            });
                        }

                        if (!shouldAnnounceMatch({ announceQueues, queueType })) {
                            console.log(
                                `[match-poller] skipping announcement for guild=${guildId} account=${account.key} match=${matchId} queue=${queueType} (not in announceQueues)`
                            );
                            lastProcessedMatchId = matchId;
                            continue;
                        }
                    
                        console.log(
                            `[match-poller] NEW match guild=${guildId} ${account.key} match=${matchId} queue=${queueType} place=${normPlacement} delta=${delta}`
                        );

                        await announceMatchToDiscord({
                            channel,
                            account,
                            placement: normPlacement,
                            matchId,
                            queueType,
                            delta,
                            afterRank,
                            participant: me,
                            messageProfile: guild?.messageProfile,
                            guildId,
                            channelId: channelIdForGuild,
                        });

                        lastProcessedMatchId = matchId;
                    }

                    await upsertGuildAccountInStore(guildId, {
                        ...account,
                        // Persist lastMatchId so we only announce new games.
                        lastMatchId: lastProcessedMatchId,
                        lastRankByQueue: after,
                        recapEvents,
                    });
            } catch (err) {
                console.error(
                    `Error polling matches for account ${account.key} (guild=${guildId}):`,
                    err
                );
            }
            await sleep(perAccountDelayMs);
            }
        }
        } finally {
            isTickRunning = false;
        }        
    };

    // Run immediately, then schedule future ticks.
    await tick();
    setInterval(() => {
        tick().catch((error) => console.error('Match poll tick failed: ', error));
    }, Math.max(10, intervalSeconds) * 1000);
}
