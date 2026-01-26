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

export function detectQueueTypeFromMatch(match) {
    const info = match?.info;
    if (!info) return null;

    const gameType = String(info.tft_game_type || "").toLowerCase();
    if (gameType === "pairs") return "RANKED_TFT_DOUBLE_UP";

    return "RANKED_TFT";
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

    const isWin = p !== null && p <= 4;
    const isLoss = p !== null && p >= 5;
    
    const embed = new EmbedBuilder().setURL(matchUrl).setTimestamp(new Date());
    
    try {
        const thumbUrl = await getTftRegaliaThumbnailUrl({
            queueType,
            tier: afterRank?.tier,
        });
        if (thumbUrl) embed.setThumbnail(thumbUrl);
    } catch {
        // ignore errors loading thumbnail  
    }

    const riotId = `${account.gameName}#${account.tagLine}`;
    const ord = p ? placementToOrdinal(p) : 'N/A';

    if (isWin && d >= 0) {
        embed.setColor(0x2dcf71).setTitle(`${label} Victory for ${riotId}!`);
        if (placement === 1) embed.setDescription(`**dhruvna coaching DIFF**`);
        else if (placement === 2) embed.setDescription(`Highroller took my 1st smh`);
        else if (placement === 3) embed.setDescription(`Not too shabby for what I thought would be a 6th!`);
        else embed.setDescription(`A 4th is a 4th, we be aight`);
    } else if (isLoss && d < 0) {
        embed.setColor(0xf34e3c).setTitle(`${label} Defeat for ${riotId}...`);
        if (placement === 5) embed.setDescription(`Hey 1st loser isn't too bad`);
        else if (placement === 6) embed.setDescription(`Shoulda gone six sevennnnnn`);
        else if (placement === 7) embed.setDescription(`At least it's not an 8th!`);
        else if (placement === 8) embed.setDescription(`**Lil bro went 8th again...**`);
    } else {
        embed
            .setColor(0x5865f2)
            .setTitle(`${label} Result for ${riotId}`)
            .setDescription(p ? `Finished ${ord}.` : `Match completed.`);
    }

    const rankValue = afterRank?.tier
        ? `${afterRank.tier} ${afterRank.rank} — ${afterRank.lp} LP`
        : "Unranked / not found";
    
    const placementValue = p ? `${ord}` : "Unknown";
    const lpChangeValue = formatDelta(d);
    embed.addFields(
        { name: "Placement", value: placementValue, inline: true },
        { name: "LP Change", value: lpChangeValue, inline: true },
        { name: "Rank", value: rankValue, inline: true }
    );

    return embed;
}