// src/utils/tft.js

import { EmbedBuilder } from "discord.js";
import { getTFTMatchUrl, getTftRegaliaThumbnailUrl } from "../riot.js";

export function pickRankSnapshot(entries) {
    const queues = new Set(['RANKED_TFT', 'RANKED_TFT_DOUBLE_UP']);
    return Object.fromEntries(
        (entries ?? [])
            .filter((e) => queues.has(e.queueType))
            .map((e) => [
                e.queueType, 
                { tier: e.tier, rank: e.rank, lp: e.leaguePoints },
            ])
    );
}

export function getQueueIdFromMatch(match) {
    const info = match?.info;
    const q = info?.queueId ?? info?.queue_id ?? null;
    return typeof q === "number" ? q: (q ? Number(q) : null);
}

export function detectQueueMetaFromMatch(match) {
    const queueId = getQueueIdFromMatch(match);

    // const queueId = getQueueIdFromMatch(match);
    if (queueId === 1090) {
        return { queueId, mode: "NORMAL", queueType: "NORMAL_TFT", label: "Normal" };
    }
    if (queueId === 1100) {
        return { queueId, mode: "RANKED", queueType: "RANKED_TFT", label: "Ranked" };
    }
    if (queueId === 1130) {
        return { queueId, mode: "HYPER ROLL", queueType: "RANKED_TFT_TURBO", label: "Hyper Roll" };
    }
    if (queueId === 1160) {
        return { queueId, mode: "DOUBLE UP (Workshop)", queueType: "RANKED_TFT_DOUBLE_UP", label: "Double Up" };
    }
    
    return { queueId, mode: "UNKNOWN", queueType: "UNKNOWN", label: "UNKNOWN" };
}

export function normalizePlacement({ placement, queueType}) {
    if (typeof placement !== "number" || placement < 1 || placement > 8) return null;

    if (queueType === "RANKED_TFT_DOUBLE_UP") {
        return Math.ceil(placement / 2); //
    } 

    return placement;
}

export function formatDelta(delta) {
    if (typeof delta !== "number") return "+0"
    return delta >= 0 ? `+${delta}` : `${delta}`;
}

export function placementToOrdinal(placement) {
    if (!placement) return "?";
    if (placement === 1) return "1st";
    if (placement === 2) return "2nd";
    if (placement === 3) return "3rd";
    return `${placement}th`;
}

export function labelForQueueType(queueType) {
    if (queueType === "RANKED_TFT") return "Ranked";
    if (queueType === "RANKED_TFT_DOUBLE_UP") return "Double Up";
    return queueType || "TFT";
}

export async function buildMatchResultEmbed({ 
    account, 
    placement,
    matchId,
    queueType, 
    delta, 
    afterRank,
 }) {
    const matchUrl = getTFTMatchUrl({ matchId });
    const label = labelForQueueType(queueType);

    const p = typeof placement === "number" ? placement : null;
    const d = typeof delta === "number" ? delta : 0;

    const isRankedQueue =
        queueType === "RANKED_TFT" ||
        queueType === "RANKED_TFT_DOUBLE_UP" ||
        queueType === "RANKED_TFT_TURBO"; // Hyper Roll (if you support it)

    const lpChangeValue = isRankedQueue ? formatDelta(d) : "—";
    const rankValue =
    isRankedQueue && afterRank?.tier
        ? `${afterRank.tier} ${afterRank.rank} — ${afterRank.lp} LP`
        : "—";
            
    const isWin = p !== null && p <= 4;
    const isLoss = p !== null && p >= 5;
    
    const embed = new EmbedBuilder().setURL(matchUrl).setTimestamp(new Date());
    
    if (isRankedQueue) {
        try {
            const thumbUrl = await getTftRegaliaThumbnailUrl({
                queueType,
                tier: afterRank?.tier,
            });
            if (thumbUrl) embed.setThumbnail(thumbUrl);
        } catch {
            // ignore errors loading thumbnail  
        }
    }
    
    const riotId = `${account.gameName}#${account.tagLine}`;
    const ord = p ? placementToOrdinal(p) : 'N/A';

    if (isWin && d >= 0) {
        embed.setColor(0x2dcf71).setTitle(`${label} Victory for ${riotId}!`);
        if (p === 1) embed.setDescription(`**dhruvna coaching DIFF**`);
        else if (p === 2) embed.setDescription(`Highroller took my 1st smh`);
        else if (p === 3) embed.setDescription(`Not too shabby for what I thought would be a 6th!`);
        else embed.setDescription(`A 4th is a 4th, we be aight`);
    } else if (isLoss && d < 0) {
        embed.setColor(0xf34e3c).setTitle(`${label} Defeat for ${riotId}...`);
        if (p === 5) embed.setDescription(`Hey 1st loser isn't too bad`);
        else if (p === 6) embed.setDescription(`Shoulda gone six sevennnnnn`);
        else if (p === 7) embed.setDescription(`At least it's not an 8th!`);
        else if (p === 8) embed.setDescription(`**Lil bro went 8th again...**`);
    } else {
        embed
        .setColor(0x5865f2)
        .setTitle(`${label} Result for ${riotId}`)
        .setDescription(p ? `Finished ${ord}.` : `Match completed.`);
    }

    embed.addFields(
        { name: "Placement", value: p ? ord : "Unknown", inline: true },
        { name: "LP Change", value: lpChangeValue, inline: true },
        { name: "Rank", value: rankValue, inline: true }
    );

    return embed;
}