import { RANKED_QUEUES } from "../constants/queues.js";

const TIER_BASE = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
};

// Keep monotonic above Diamond I
const MASTER_PLUS_BASE = 2800;

const DIV_OFFSET = {
  IV: 0,
  III: 100,
  II: 200,
  I: 300,
};

export function standardizeRankLp(rank) {
    if (!rank) return null;

    const tier = typeof rank.tier === "string" ? rank.tier.toUpperCase() : null;
    const div = typeof rank.rank === "string" ? rank.rank.toUpperCase() : null;
    const lp = Number(rank.lp);

    if (!tier || !Number.isFinite(lp)) return null;

    // Handle Master, Grandmaster, Challenger
    if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier)) {
        return MASTER_PLUS_BASE + lp;
    }

    const base = TIER_BASE[tier];
    const offset = DIV_OFFSET[div];

    if (!Number.isFinite(base) || !Number.isFinite(offset)) return null;
    return base + offset + lp;  
}

export function toRankSnapshot(entries, { now = Date.now(), rankedQueues = RANKED_QUEUES } = {}) {
    const rows = Array.isArray(entries) ? entries : [];

    return Object.fromEntries(
        rows
            .filter((e) => rankedQueues.has(e.queueType))
            .map((e) => [
                e.queueType,
                { 
                    tier: e.tier ?? null,
                    rank: e.rank ?? null, // null for MASTER+ (and sometimes other cases)
                    lp: Number(e.leaguePoints ?? 0),
                    wins: Number(e.wins ?? 0),
                    losses: Number(e.losses ?? 0),
                    lastUpdatedAt: now,
                },
            ])
        );
    }

export function computeRankSnapshotDeltas({ before = {}, after = {} }) {
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


export function getRankSnapshotForQueue(account, queueType) {
  return account?.lastRankByQueue?.[queueType] ?? null;
}
