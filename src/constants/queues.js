// === Queue constants ===
// Centralize queue identifiers so comparisons are consistent across the codebase.
export const QUEUE_TYPES = Object.freeze({
    NORMAL_TFT: "NORMAL_TFT",
    RANKED_TFT: "RANKED_TFT",
    RANKED_TFT_DOUBLE_UP: "RANKED_TFT_DOUBLE_UP",
    UNKNOWN: "UNKNOWN",
});

// Human-friendly labels for UI responses and embeds.
export const QUEUE_LABELS = Object.freeze({
    [QUEUE_TYPES.NORMAL_TFT]: "Normal",
    [QUEUE_TYPES.RANKED_TFT]: "Ranked",
    [QUEUE_TYPES.RANKED_TFT_DOUBLE_UP]: "Double Up",
    [QUEUE_TYPES.UNKNOWN]: "Unknown",
});

// The queues that count as ranked for filtering and recap logic.
export const RANKED_QUEUES = new Set([
    QUEUE_TYPES.RANKED_TFT,
    QUEUE_TYPES.RANKED_TFT_DOUBLE_UP,
]);

// Default queues to announce when a user has not customized their settings.
export const DEFAULT_ANNOUNCE_QUEUES = [
    QUEUE_TYPES.RANKED_TFT,
    QUEUE_TYPES.RANKED_TFT_DOUBLE_UP,
];

// Discord choice objects for slash command options.
export const RANKED_QUEUE_CHOICES = [
    { name: "Ranked", value: QUEUE_TYPES.RANKED_TFT },
    { name: "Double Up", value: QUEUE_TYPES.RANKED_TFT_DOUBLE_UP },
];

// === Queue helpers ===
// Provide a single spot to adjust labeling or ranked logic later.
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
