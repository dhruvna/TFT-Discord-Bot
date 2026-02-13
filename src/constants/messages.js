// === Match result message constants ===

export const MESSAGE_PROFILES = Object.freeze({
    NEUTRAL: 'neutral',
    PERSONAL: 'personal',
});

const PERSONAL_OUTCOME_MESSAGES = Object.freeze({
    win: Object.freeze({
        1:`**dhruvna coaching DIFF**`,
        2: `Highroller took my 1st smh`,
        3:`Not too shabby for what I thought would be a 6th!`,
        4: `A 4th is a 4th, we be aight`,
    }),
    loss: Object.freeze({
        5: `Hey 1st loser isn't too bad`,
        6: `Shoulda gone six sevennnnnn`,
        7: `At least it's not an 8th!`,
        8: `**Lil bro went 8th again...**`,
    }),
    other: Object.freeze({
        default: `Match completed.`,
    }),
});

const NEUTRAL_OUTCOME_MESSAGES = Object.freeze({
    win: Object.freeze({
        1: 'Great game!',
        2: 'Strong finish!',
        3: 'Nice top four.',
        4: 'Top four secured.',
    }),
    loss: Object.freeze({
        5: 'Close one. Keep it up.',
        6: 'Tough one, go next.',
        7: 'Rough game, bounce back next match.',
        8: 'It happens. Next game is a fresh start.',
    }),
    other: Object.freeze({
        default: 'Match completed.',
    }),
});

export const MATCH_RESULT_MESSAGES = Object.freeze({
    [MESSAGE_PROFILES.NEUTRAL]: NEUTRAL_OUTCOME_MESSAGES,
    [MESSAGE_PROFILES.PERSONAL]: PERSONAL_OUTCOME_MESSAGES,
});

export function resolveMatchResultDescription({ placement, profile = MESSAGE_PROFILES.NEUTRAL }) {
    const tonePack = MATCH_RESULT_MESSAGES[profile] ?? MATCH_RESULT_MESSAGES[MESSAGE_PROFILES.NEUTRAL];

    if (typeof placement !== 'number') {
        return tonePack.other.default;
    }

    const outcomeKey = placement <= 4 ? 'win' : placement >= 5 ? 'loss' : 'other';
    const selectedMessage = tonePack[outcomeKey]?.[placement];

    // Deterministic, audience-safe fallback text.
    if (selectedMessage) return selectedMessage;

    if (placement >= 1 && placement <= 8) {
        return placement <= 4 ? 'Solid result.' : 'Tough one, go next.';
    }

    return tonePack.other.default;
}
