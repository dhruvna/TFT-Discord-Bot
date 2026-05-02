import {
    getTFTMatch,
    getTFTRankByPuuid,
    getTFTMatchIdsByPuuid,
    getLolRankByPuuid,
    getLolMatchIdsByPuuid,
    getLolMatch,
} from '../riot.js';

import { LOL_QUEUE_TYPES, TFT_QUEUE_TYPES } from '../constants/queues.js';
import { toRankSnapshot } from '../utils/rankSnapshot.js';

const BOOTSTRAP_BY_GAME_TYPE = {
    TFT: {
        getRankByPuuid: getTFTRankByPuuid,
        getMatchIdsByPuuid: getTFTMatchIdsByPuuid,
        getMatch: getTFTMatch,
        getRankedQueues: () => RANKED_QUEUES,
        getMatchTimestamp: (match) => {
            const gameDatetime = Number(match?.info?.game_datetime ?? 0);
            return Number.isFinite(gameDatetime) && gameDatetime > 0 ? gameDatetime : null;
        },
    },
    LOL: {
        getRankByPuuid: getLolRankByPuuid,
        getMatchIdsByPuuid: getLolMatchIdsByPuuid,
        getMatch: getLolMatch,
        getRankedQueues: () => new Set([
            LOL_QUEUE_TYPES.RANKED_SOLO_DUO,
            LOL_QUEUE_TYPES.RANKED_FLEX,
        ]),
        getMatchTimestamp: (match) => {
            const gameEndTimestamp = Number(match?.info?.gameEndTimestamp ?? 0);
            if (Number.isFinite(gameEndTimestamp) && gameEndTimestamp > 0) return gameEndTimestamp;

            const gameCreation = Number(match?.info?.gameCreation ?? 0);
            return Number.isFinite(gameCreation) && gameCreation > 0 ? gameCreation : null;
        },
    },
};

export async function bootstrapTrackedGame({ gameType, platform, regional, puuid, onError }) {
    const config = BOOTSTRAP_BY_GAME_TYPE[gameType];
    if (!config) {
        throw new Error(`Unsupported bootstrap game type: ${gameType}`);
    }

    let lastRankByQueue = {};
    let lastMatchId = null;
    let lastMatchAt = null;

    try {
        const entries = await config.getRankByPuuid({ platform, puuid });
        lastRankByQueue = toRankSnapshot(entries, { rankedQueues: config.getRankedQueues() });
    } catch (err) {
        onError?.({ step: 'rank', gameType, err, platform, regional, puuid });
    }

    try {
        const ids = await config.getMatchIdsByPuuid({ regional, puuid, count: 1 });
        lastMatchId = Array.isArray(ids) && ids.length > 0 ? ids[0] : null;

        if (lastMatchId) {
            const latestMatch = await config.getMatch({ regional, matchId: lastMatchId });
            lastMatchAt = config.getMatchTimestamp(latestMatch);
        }
    } catch (err) {
        onError?.({ step: 'match', gameType, err, platform, regional, puuid });
        lastMatchId = null;
        lastMatchAt = null;
    }

    return { lastRankByQueue, lastMatchId, lastMatchAt };
}
