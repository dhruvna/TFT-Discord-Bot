// === Game + queue constants ===
// Keep queue identifiers scoped by game so semantics stay explicit.

export const GAME_TYPES = Object.freeze({
    TFT: "TFT",
    LOL: "LOL",
});

export const TRACKING_GAME_CHOICES = Object.freeze([
    { name: "TFT", value: "TFT" },
    { name: "LoL", value: "LOL" },
    { name: "Both", value: "BOTH" },
]);

export const TFT_QUEUE_TYPES = Object.freeze({
    NORMAL: "NORMAL_TFT",
    RANKED: "RANKED_TFT",
    RANKED_DOUBLE_UP: "RANKED_TFT_DOUBLE_UP",
    UNKNOWN: "UNKNOWN_TFT",
});

export const LOL_QUEUE_TYPES = Object.freeze({
    RANKED_SOLO_DUO: "RANKED_SOLO_DUO",
    RANKED_FLEX: "RANKED_FLEX",
    UNKNOWN: "UNKNOWN_LOL",
});

export const GAME_TYPE_CHOICES = Object.freeze([
    { name: "TFT", value: GAME_TYPES.TFT },
    { name: "LoL", value: GAME_TYPES.LOL },
]);

// Backward compatibility alias; prefer TFT_QUEUE_TYPES in new code.
export const QUEUE_TYPES = TFT_QUEUE_TYPES;

const QUEUE_LABELS_BY_GAME = Object.freeze({
    [GAME_TYPES.TFT]: Object.freeze({
        [TFT_QUEUE_TYPES.NORMAL]: "Normal TFT",
        [TFT_QUEUE_TYPES.RANKED]: "Ranked TFT",
        [TFT_QUEUE_TYPES.RANKED_DOUBLE_UP]: "Double Up TFT",
        [TFT_QUEUE_TYPES.UNKNOWN]: "Unknown",
    }),
    [GAME_TYPES.LOL]: Object.freeze({
        [LOL_QUEUE_TYPES.RANKED_SOLO_DUO]: "Ranked Solo/Duo",
        [LOL_QUEUE_TYPES.RANKED_FLEX]: "Ranked Flex",
        [LOL_QUEUE_TYPES.UNKNOWN]: "Unknown",
    }),
});

const RANKED_QUEUES_BY_GAME = Object.freeze({
    [GAME_TYPES.TFT]: new Set([
        TFT_QUEUE_TYPES.RANKED,
        TFT_QUEUE_TYPES.RANKED_DOUBLE_UP,
    ]),
    [GAME_TYPES.LOL]: new Set([
        LOL_QUEUE_TYPES.RANKED_SOLO_DUO,
        LOL_QUEUE_TYPES.RANKED_FLEX,
    ]),
});

// Backward compatibility set used by existing rank snapshot/register flows.
export const RANKED_QUEUES = RANKED_QUEUES_BY_GAME[GAME_TYPES.TFT];

// Default queues to announce when a user has not customized their settings.
export const DEFAULT_ANNOUNCE_QUEUES = [
    TFT_QUEUE_TYPES.RANKED,
    TFT_QUEUE_TYPES.RANKED_DOUBLE_UP,
    LOL_QUEUE_TYPES.RANKED_SOLO_DUO,
    LOL_QUEUE_TYPES.RANKED_FLEX,
];

// Discord choice objects for slash command options.
export const RANKED_QUEUE_CHOICES = [
    { name: "Ranked TFT", value: TFT_QUEUE_TYPES.RANKED },
    { name: "Double Up TFT", value: TFT_QUEUE_TYPES.RANKED_DOUBLE_UP },
];


export const TFT_RECAP_QUEUE_CHOICES = Object.freeze([
    { name: "Ranked TFT", value: TFT_QUEUE_TYPES.RANKED },
    { name: "Double Up TFT", value: TFT_QUEUE_TYPES.RANKED_DOUBLE_UP },
]);

export const LOL_RECAP_QUEUE_CHOICES = Object.freeze([
    { name: "Ranked Solo/Duo", value: LOL_QUEUE_TYPES.RANKED_SOLO_DUO },
    { name: "Ranked Flex", value: LOL_QUEUE_TYPES.RANKED_FLEX },
]);

export const TFT_LEADERBOARD_QUEUE_CHOICES = TFT_RECAP_QUEUE_CHOICES;
export const LOL_LEADERBOARD_QUEUE_CHOICES = LOL_RECAP_QUEUE_CHOICES;

export const ALL_RECAP_QUEUE_CHOICES = Object.freeze([
    ...TFT_RECAP_QUEUE_CHOICES,
    ...LOL_RECAP_QUEUE_CHOICES,
]);

export const ALL_LEADERBOARD_QUEUE_CHOICES = Object.freeze([
    ...TFT_LEADERBOARD_QUEUE_CHOICES,
    ...LOL_LEADERBOARD_QUEUE_CHOICES,
]);

export function defaultRankedQueueForGame(game) {
    return game === GAME_TYPES.LOL ? LOL_QUEUE_TYPES.RANKED_SOLO_DUO : TFT_QUEUE_TYPES.RANKED;
}

export function queueChoicesForRecap(game = GAME_TYPES.TFT) {
    return game === GAME_TYPES.LOL ? LOL_RECAP_QUEUE_CHOICES : TFT_RECAP_QUEUE_CHOICES;
}

export function queueChoicesForLeaderboard(game = GAME_TYPES.TFT) {
    return game === GAME_TYPES.LOL ? LOL_LEADERBOARD_QUEUE_CHOICES : TFT_LEADERBOARD_QUEUE_CHOICES;
}

// === Queue helpers ===
// Provide a single spot to adjust labeling or ranked logic later.
export function queueLabel(game, queueType) {
    if (!queueType) return game === GAME_TYPES.LOL ? "LoL" : "TFT";
    const labels = QUEUE_LABELS_BY_GAME[game] ?? {};
    return labels[queueType] ?? queueType;
}

export function isRankedQueue(game, queueType) {
    const ranked = RANKED_QUEUES_BY_GAME[game];
    return ranked ? ranked.has(queueType) : false;
}

export function isDoubleUpQueue(queueType) {
    return queueType === TFT_QUEUE_TYPES.RANKED_DOUBLE_UP;
}
