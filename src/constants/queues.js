// === Game + queue constants ===
// Keep queue identifiers scoped by game so semantics stay explicit.

export const GAME_TYPES = Object.freeze({
    TFT: "TFT",
    LOL: "LOL",
});

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

// Backward compatibility alias; prefer TFT_QUEUE_TYPES in new code.
export const QUEUE_TYPES = TFT_QUEUE_TYPES;

const QUEUE_LABELS_BY_GAME = Object.freeze({
    [GAME_TYPES.TFT]: Object.freeze({
        [TFT_QUEUE_TYPES.NORMAL]: "Normal",
        [TFT_QUEUE_TYPES.RANKED]: "Ranked",
        [TFT_QUEUE_TYPES.RANKED_DOUBLE_UP]: "Double Up",
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
];

// Discord choice objects for slash command options.
export const RANKED_QUEUE_CHOICES = [
    { name: "Ranked", value: TFT_QUEUE_TYPES.RANKED },
    { name: "Double Up", value: TFT_QUEUE_TYPES.RANKED_DOUBLE_UP },
];

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
