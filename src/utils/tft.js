// src/utils/tft.js

import { EmbedBuilder } from "discord.js";
import { getTFTMatchUrl, getTftRegaliaThumbnailUrl } from "../riot.js";
import {
  QUEUE_TYPES,
  isRankedQueue,
  queueLabel,
} from "../constants/queues.js";

export function getQueueIdFromMatch(match) {
    const info = match?.info;
    const q = info?.queueId ?? info?.queue_id ?? null;
    return typeof q === "number" ? q: (q ? Number(q) : null);
}

export function detectQueueMetaFromMatch(match) {
    const queueId = getQueueIdFromMatch(match);

    // const queueId = getQueueIdFromMatch(match);
    if (queueId === 1090) {
        return {
            queueId,
            mode: "NORMAL",
            queueType: QUEUE_TYPES.NORMAL_TFT,
            label: queueLabel(QUEUE_TYPES.NORMAL_TFT),
        };
    }
    if (queueId === 1100) {
        return { queueId, 
            mode: "RANKED", 
            queueType: QUEUE_TYPES.RANKED_TFT, 
            label: queueLabel(QUEUE_TYPES.RANKED_TFT) 
        };
    }
    if (queueId === 1160) {
        return { queueId, 
            mode: "DOUBLE UP (Workshop)", 
            queueType: QUEUE_TYPES.RANKED_TFT_DOUBLE_UP, 
            label: queueLabel(QUEUE_TYPES.RANKED_TFT_DOUBLE_UP) 
        };
    }
    
    return {
        queueId,
        mode: "UNKNOWN",
        queueType: QUEUE_TYPES.UNKNOWN,
        label: queueLabel(QUEUE_TYPES.UNKNOWN),
    };
}

export function normalizePlacement({ placement, queueType}) {
    if (typeof placement !== "number" || placement < 1 || placement > 8) return null;

    if (queueType === "RANKED_TFT_DOUBLE_UP") {
        return Math.ceil(placement / 2); //
    } 

    return placement;
}

export function formatDelta(delta) {
    if (!Number.isFinite(delta)) return "-";
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return `-${Math.abs(delta)}`;
    return "0";
}

export function placementToOrdinal(placement) {
    if (!placement) return "?";
    if (placement === 1) return "1st";
    if (placement === 2) return "2nd";
    if (placement === 3) return "3rd";
    return `${placement}th`;
}

export function labelForQueueType(queueType) {
    return queueLabel(queueType);
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

    const isRanked = isRankedQueue(queueType);
    
    const isWin = p !== null && p <= 4;
    const isLoss = p !== null && p >= 5;
    
    const lpChangeValue = isRanked ? formatDelta(d) : "—";
    const rankValue =
        isRanked && afterRank?.tier
            ? `${afterRank.tier} ${afterRank.rank} — ${afterRank.lp} LP`
            : "—";
            

    
    const embed = new EmbedBuilder().setURL(matchUrl).setTimestamp(new Date());
    
    if (isRanked) {
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

    if (isWin) {
        embed.setColor(0x2dcf71).setTitle(`${label} Victory for ${riotId}!`);
        if (p === 1) embed.setDescription(`**dhruvna coaching DIFF**`);
        else if (p === 2) embed.setDescription(`Highroller took my 1st smh`);
        else if (p === 3) embed.setDescription(`Not too shabby for what I thought would be a 6th!`);
        else embed.setDescription(`A 4th is a 4th, we be aight`);
    } else if (isLoss) {
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