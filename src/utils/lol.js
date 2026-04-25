// === LOL utilities ===
// This module holds helpers for queue detection, placement formatting, and embeds.

import { EmbedBuilder } from "discord.js";
import { 
    getLolMatchUrl,
} from "../riot.js";
import {
  GAME_TYPES,
  LOL_QUEUE_TYPES,
  isRankedQueue,
  queueLabel,
} from "../constants/queues.js";
import { formatRankWithLp } from "./presentation.js";

function formatDelta(delta) {
    if (!Number.isFinite(delta)) return "-";
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return `-${Math.abs(delta)}`;
    return "0";
}

// === Queue helpers ===
// Extract the queue id from a match payload while handling API variations.
export function getQueueIdFromLolMatch(match) {
    const info = match?.info;
    const q = info?.queueId ?? info?.queue_id ?? null;
    return typeof q === "number" ? q : (q ? Number(q) : null);
}

// Convert queue id into human-friendly metadata.
export function detectLolQueueMetaFromMatch(match) {
    const queueId = getQueueIdFromLolMatch(match);
    if (queueId === 420) {
        return {
            queueId,
            queueType: LOL_QUEUE_TYPES.RANKED_SOLO_DUO,
            label: queueLabel(GAME_TYPES.LOL, LOL_QUEUE_TYPES.RANKED_SOLO_DUO),
        };
    }
    if (queueId === 440) {
        return {
            queueId,
            queueType: LOL_QUEUE_TYPES.RANKED_FLEX,
            label: queueLabel(GAME_TYPES.LOL, LOL_QUEUE_TYPES.RANKED_FLEX),
        };
    }

    return {
        queueId,
        queueType: LOL_QUEUE_TYPES.UNKNOWN,
        label: queueLabel(GAME_TYPES.LOL, LOL_QUEUE_TYPES.UNKNOWN),
    };
}

// === Embed construction ===
// Build the Discord embed used for match announcements.
export async function buildLolMatchResultEmbed({
    account, 
    matchId,
    queueType, 
    delta, 
    afterRank,
    participant,
 }) {
    const matchUrl = getLolMatchUrl(matchId);
    const label = queueLabel(GAME_TYPES.LOL, queueType);
    const riotId = `${account.gameName}#${account.tagLine}`;

    const kills = Number(participant?.kills ?? 0);
    const deaths = Number(participant?.deaths ?? 0);
    const assists = Number(participant?.assists ?? 0);
    const kda = `${kills}/${deaths}/${assists}`;
    const didWin = participant?.win === true;
    const isRankedMatch = isRankedQueue(GAME_TYPES.LOL, queueType);

    const embed = new EmbedBuilder()
        .setURL(matchUrl)
        .setTimestamp(new Date())
        .setColor(didWin ? 0x2dcf71 : 0xf34e3c)
        .setTitle(`${label} ${didWin ? "Victory" : "Defeat"} for ${riotId}`);

    const lpChangeValue = isRankedMatch ? formatDelta(delta) : "—";
    const rankValue = isRankedMatch ? formatRankWithLp(afterRank) : "—";

    embed.addFields(
        { name: "Result", value: didWin ? "Win" : "Loss", inline: true },
        { name: "K/D/A", value: kda, inline: true },
        { name: "LP Change", value: lpChangeValue, inline: true },
        { name: "Rank", value: rankValue, inline: true },
    );

    return { embed, files: [] };
}
