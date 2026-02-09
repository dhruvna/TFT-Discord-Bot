import { loadDb, saveDbIfChanged, upsertGuildAccount} from '../storage.js';
import { getTFTMatch, getTFTMatchIdsByPuuid, getTFTRankByPuuid } from '../riot.js';

import {
    pickRankSnapshot,
    buildMatchResultEmbed,
    detectQueueMetaFromMatch,
    normalizePlacement,
    standardizeRankLp
 } from '../utils/tft.js';

import {
    DEFAULT_ANNOUNCE_QUEUES,
    QUEUE_TYPES,
    isRankedQueue,
} from '../constants/queues.js';

import { createRiotRateLimiter } from '../utils/rateLimiter.js';
import { sleep } from '../utils/utils.js';
import config from '../config.js';

const MATCH_BACKFILL_LIMIT = 10;

function shouldRefreshRank(account, now, maxAgeMs) {
    if (!account?.lastRankByQueue) return true;
    const entries = Object.values(account.lastRankByQueue);
    if (entries.length === 0) return true;
    return entries.some((entry) => {
        const lastUpdatedAt = Number(entry?.lastUpdatedAt ?? 0);
        return !Number.isFinite(lastUpdatedAt) || now - lastUpdatedAt >= maxAgeMs;
    });
}

async function fetchMatchIds({ riotLimiter, account, count, start = 0 }) {
    await riotLimiter.acquire();
    return getTFTMatchIdsByPuuid({
        regional: account.regional,
        puuid: account.puuid,
        count,
        start,
    });
}

async function fetchMatch({ riotLimiter, account, matchId }) {
    await riotLimiter.acquire();
    return getTFTMatch({ 
        regional: account.regional, 
        matchId 
    });
}

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

async function refreshRankSnapshot({ riotLimiter, account }) {
    await riotLimiter.acquire();
    const entries = await getTFTRankByPuuid({
        platform: account.platform,
        puuid: account.puuid,
    });
    return pickRankSnapshot(entries);
}

function computeRankDeltas({ before, after }) {
    const deltas = {};
    for (const [queueType, afterRank] of Object.entries(after)) {
        const beforeRank = before?.[queueType];

        const beforeStd = standardizeRankLp(beforeRank);
        const afterStd = standardizeRankLp(afterRank);

        if (Number.isFinite(beforeStd) && Number.isFinite(afterStd)) {
            deltas[queueType] = afterStd - beforeStd;
        }
    }
    return deltas;
}

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

async function announceMatchToDiscord({
    channel,
    account,
    placement,
    matchId,
    queueType,
    delta,
    afterRank,
    guildId,
    channelId,
}) {
    if (!channel) {
        console.log(
            `[match-poller] no channel for guild=${guildId} (channelId=${channelId ?? "null"})`
        );
        return;
    }

    const embed = await buildMatchResultEmbed({
        account,
        placement,
        matchId,
        queueType,
        delta,
        afterRank,
    });
    await channel.send({ embeds: [embed] });
}

function shouldAnnounceMatch({ announceQueues, queueType }) {
    if (!announceQueues) return true;
    return announceQueues.includes(queueType);
}

export async function startMatchPoller(client) {
    const intervalSeconds = config.matchPollIntervalSeconds;
    const perAccountDelayMs = config.matchPollPerAccountDelayMs;
    const riotLimiter = createRiotRateLimiter({ perSecond: 20, perTwoMinutes: 100 });
    const rankRefreshMinutes = config.rankRefreshIntervalMinutes;
    const rankRefreshMs = rankRefreshMinutes * 60 * 1000;

    const tick = async () => {
        const fallbackChannelId = config.discordChannelId;
        const channelCache = new Map(); // channelId -> channel (cache per tick)

        const db = await loadDb();
        let didChange = false;
        const guildIds = Object.keys(db);
        if (guildIds.length === 0) return;

        console.log(
            `[match-poller] tick guilds=${guildIds.length} interval=${intervalSeconds}s perAccountDelay=${perAccountDelayMs}ms`
        );

        for (const guildId of guildIds) {
            const guild = db[guildId];
            const accounts = guild?.accounts ?? [];
            const channelIdForGuild = guild?.channelId || fallbackChannelId;

            let channel = null;
            if (channelIdForGuild) {
                if (channelCache.has(channelIdForGuild)) {
                    channel = channelCache.get(channelIdForGuild);
                } else {
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
                            
                            await upsertGuildAccount(db, guildId, {
                                ...account,
                                lastRankByQueue: refreshed,
                            });
                            didChange = true;
                        } catch (err) {
                            console.error(
                                `Error refreshing rank for account ${account.key} (guild=${guildId}):`,
                                err
                            );
                        }
                    }

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

                    const orderedMatchIds = [...unseenMatchIds].reverse();
                    const before = account.lastRankByQueue ?? {};
                    let after = before;
                    const announceQueues = guild?.announceQueues ?? DEFAULT_ANNOUNCE_QUEUES;
                    let recapEvents = Array.isArray(account.recapEvents) ? account.recapEvents : [];
                    let lastProcessedMatchId = account.lastMatchId;

                    for (const [index, matchId] of orderedMatchIds.entries()) {
                        const isMostRecent = index === orderedMatchIds.length - 1;
                        const match = await fetchMatch({ riotLimiter, account, matchId });
                        const participants = match?.info?.participants ?? [];
                        const me = participants.find((p => p.puuid === account.puuid));
                        const placement = me?.placement ?? null;
                        
                        const meta = detectQueueMetaFromMatch(match);
                        const queueType = meta.queueType || QUEUE_TYPES.RANKED_TFT;
                        const isRanked = isRankedQueue(queueType);

                        if (isMostRecent && isRanked) {
                            try {
                                after = await refreshRankSnapshot({ riotLimiter, account });
                            } catch {
                                // ignore refresh failure for delta calc
                            }
                        }

                        const deltas = computeRankDeltas({ before, after });
                        
                        if (!shouldAnnounceMatch({ announceQueues, queueType })) {
                            console.log(
                                `[match-poller] skipping announcement for guild=${guildId} account=${account.key} match=${matchId} queue=${queueType} (not in announceQueues)`
                            );
                            lastProcessedMatchId = matchId;
                            continue;
                        }
                    
                        const normPlacement = normalizePlacement({ placement, queueType }); 
                        
                        const afterRank = isRanked && isMostRecent ? (after?.[queueType] ?? null) : null;
                        const delta = isRanked && isMostRecent ? (deltas?.[queueType] ?? 0) : 0;
                    
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
                            guildId,
                            channelId: channelIdForGuild,
                        });

                        lastProcessedMatchId = matchId;
                    }

                    await upsertGuildAccount(db, guildId, {
                        ...account,
                        // lastMatchId: latest,
                        lastMatchId: lastProcessedMatchId,
                        lastRankByQueue: after,
                        recapEvents,
                    });
                    didChange = true;
            } catch (err) {
                console.error(
                    `Error polling matches for account ${account.key} (guild=${guildId}):`,
                    err
                );
            }
            await sleep(perAccountDelayMs);
            }
        }
        await saveDbIfChanged(db, didChange);
    };

    await tick();
    setInterval(() => {
        tick().catch((error) => console.error('Match poll tick failed: ', error));
    }, Math.max(10, intervalSeconds) * 1000);
}
