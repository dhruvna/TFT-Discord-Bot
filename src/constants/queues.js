export const QUEUE_TYPES = Object.freeze({
    NORMAL_TFT: "NORMAL_TFT",
    RANKED_TFT: "RANKED_TFT",
    RANKED_TFT_DOUBLE_UP: "RANKED_TFT_DOUBLE_UP",
    UNKNOWN: "UNKNOWN",
});

export const QUEUE_LABELS = Object.freeze({
    [QUEUE_TYPES.NORMAL_TFT]: "Normal",
    [QUEUE_TYPES.RANKED_TFT]: "Ranked",
    [QUEUE_TYPES.RANKED_TFT_DOUBLE_UP]: "Double Up",
    [QUEUE_TYPES.UNKNOWN]: "Unknown",
});

export const RANKED_QUEUES = new Set([
    QUEUE_TYPES.RANKED_TFT,
    QUEUE_TYPES.RANKED_TFT_DOUBLE_UP,
]);

export const DEFAULT_ANNOUNCE_QUEUES = [
    QUEUE_TYPES.RANKED_TFT,
    QUEUE_TYPES.RANKED_TFT_DOUBLE_UP,
];

export const RANKED_QUEUE_CHOICES = [
    { name: "Ranked", value: QUEUE_TYPES.RANKED_TFT },
    { name: "Double Up", value: QUEUE_TYPES.RANKED_TFT_DOUBLE_UP },
];

export function queueLabel(queueType) {
    if (!queueType) return "TFT";
    return QUEUE_LABELS[queueType] ?? queueType;
}

export function isRankedQueue(queueType) {
    return RANKED_QUEUES.has(queueType);
}

export function isDoubleUpQueue(queueType) {
    return queueType === QUEUE_TYPES.RANKED_TFT_DOUBLE_UP;
}
