// === LOL utilities ===
// This module holds helpers for queue detection, placement formatting, and embeds.

import { EmbedBuilder } from "discord.js";
import { 
    getLatestDDragonVersion,
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

function formatDurationFromSeconds(seconds) {
    const totalSeconds = Number(seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "Unknown";

    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

function buildLolQueueLabel(queueType) {
    if (queueType === LOL_QUEUE_TYPES.RANKED_SOLO_DUO) return "Ranked Solo/Duo";
    if (queueType === LOL_QUEUE_TYPES.RANKED_FLEX) return "Ranked Flex";
    return queueLabel(GAME_TYPES.LOL, queueType);
}

function buildChampionIconUrl(participant, version) {
    const championName = participant?.championName;
    if (!championName || !version) return null;

    // Data Dragon champion icon files map to champion key names.
    const normalized = String(championName).replace(/[ .'_]/g, '');
    if (!normalized) return null;

    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${normalized}.png`;
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
    const matchUrl = getLolMatchUrl({ matchId });
    const label = buildLolQueueLabel(queueType);
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
        .setTitle(`${label} • ${didWin ? "Victory" : "Defeat"} • ${riotId}`)


    const lpChangeValue = isRankedMatch ? formatDelta(didWin ? Math.abs(delta) : -Math.abs(delta)) : "—";
    const rankValue = isRankedMatch ? formatRankWithLp(afterRank) : "—";

    // TODO: Add champion icon

    const championName = participant?.championName ?? "Unknown Champion";
    const totalCs = Number(participant?.totalMinionsKilled ?? 0) + Number(participant?.neutralMinionsKilled ?? 0);
    const duration = formatDurationFromSeconds(participant?.timePlayed ?? 0);
    const csPerMin = duration === "Unknown" ? null : totalCs / (Number(participant?.timePlayed) / 60);
    const csOrVisionValue = Number.isFinite(csPerMin) && csPerMin > 0
        ? `${csPerMin.toFixed(1)} CS/min`
        : (Number.isFinite(participant?.visionScore) ? `${participant.visionScore} vision` : "—");

    embed.addFields(
        { name: "Champion", value: championName.slice(0, 1024), inline: true },
        { name: "K/D/A", value: kda, inline: true },
        { name: "Duration", value: duration, inline: true },
        { name: "CS/Vision", value: csOrVisionValue, inline: true },
        { name: didWin ? "LP Win" : "LP Loss", value: lpChangeValue, inline: true },
        { name: "Rank", value: rankValue.slice(0, 1024), inline: true },
    );

    try {
        const version = await getLatestDDragonVersion();
        const championIconUrl = buildChampionIconUrl(participant, version);
        if (championIconUrl) embed.setThumbnail(championIconUrl);
    } catch {
        // Ignore Data Dragon failures and keep embed safe.
    }
    return { embed, files: [] };
}
