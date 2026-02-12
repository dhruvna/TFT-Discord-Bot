// === Imports ===
// The recap autoposter builds recap embeds and sends them on a schedule.
import { getKnownGuildIds, loadDb, setGuildRecapLastSentYmdInStore } from '../storage.js';
import { QUEUE_TYPES } from '../constants/queues.js';
import { buildRecapEmbed, computeRecapRows, hoursForMode } from '../utils/recap.js';
import config from "../config.js";

// === Date helpers ===
// Use local dates for daily scheduling (matching users' expectations).
export function getLocalYmd(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// Calculate cutoff timestamp for recap aggregation.
export function getRecapCutoffTimestamp({ now, hours}) {
    return now.getTime() - hours * 60 * 60 * 1000;
}

// === Scheduling logic ===
// Decide whether we should fire at the current time, accounting for last send.
export function shouldFireRecapAutopost({ 
    now,
    fireHour,
    fireMinute,
    lastSentYmd,
    getYmd = getLocalYmd,
}) {
    const today = getYmd(now);
    const scheduledTime = new Date(now);
    scheduledTime.setHours(fireHour, fireMinute, 0, 0);
    return {
        shouldFire: now >= scheduledTime && lastSentYmd !== today,
        today,
        scheduledTime,
    };
}


// === Service entry point ===
// Polls on a configurable interval to see if a recap should be posted.
export async function startRecapAutoposter(client, { fireHour, fireMinute, pollIntervalMs } = {}) {
    const FIRE_HOUR = fireHour ?? config.recapAutopostHour;
    const FIRE_MINUTE = fireMinute ?? config.recapAutopostMinute;
    const POLL_INTERVAL_MS = pollIntervalMs ?? 5 * 60 * 1000;
    // One polling iteration. Splitting this out keeps the interval handler small.
    const tick = async () => {
        const fallbackChannelId = config.discordChannelId;

        const db = await loadDb();
        const guildIds = getKnownGuildIds(db);
        if (guildIds.length === 0) return;

        const now = new Date();
        const { today, scheduledTime } = shouldFireRecapAutopost({
            now,
            fireHour: FIRE_HOUR,
            fireMinute: FIRE_MINUTE,
            lastSentYmd: null,
        });

        console.log(
            `[recap-autopost] tick today=${today} now=${now.toISOString()} scheduledTime=${scheduledTime.toISOString()} lastSentYmd=<per-guild> guilds=${guildIds.length}`
        );

        for (const guildId of guildIds) {
            const guild = db[guildId];
            if (!guild?.recap?.enabled) continue;

            const {
                mode = 'DAILY',
                queue = QUEUE_TYPES.RANKED_TFT,
                lastSentYmd = null,
            } = guild.recap;

            const { shouldFire, scheduledTime: guildScheduledTime } = shouldFireRecapAutopost({
                now,
                fireHour: FIRE_HOUR,
                fireMinute: FIRE_MINUTE,
                lastSentYmd,
            });

            console.log(
                `[recap-autopost] evaluate guild=${guildId} now=${now.toISOString()} scheduledTime=${guildScheduledTime.toISOString()} lastSentYmd=${lastSentYmd ?? 'null'} shouldFire=${shouldFire}`
            );

            if (!shouldFire) continue;

            const channelId = guild?.channelId || fallbackChannelId;
            if (!channelId) continue;

            let channel = null;
            try {
                channel = await client.channels.fetch(channelId);
            } catch {
                channel = null;
            }

            if (!channel || !channel.isTextBased()) {
                console.log(
                `[recap-autopost] skip guild=${guildId} (channel not found or not text-based) channelId=${channelId}`
                );
                continue;
            }

            console.log(
                `[recap-autopost] firing guild=${guildId} mode=${mode} queue=${queue} channelId=${channelId}`
            );

            // Build recap rows from stored recapEvents (same logic as /recap)
            const hours = hoursForMode(mode);
            const cutoff = getRecapCutoffTimestamp({ now, hours });

            const accounts = guild?.accounts ?? [];
            const rows = computeRecapRows(accounts, cutoff, queue);
            const embed = buildRecapEmbed({ rows, mode, queue, hours });
        
            await channel.send({ embeds: [embed] });
            
            // Persist the send date to prevent duplicate posts on the same day.
            const updated = await setGuildRecapLastSentYmdInStore(guildId, today);
            console.log(`[recap-autopost] sent guild=${guildId} today=${today} stored=${updated}`);
        }
    };

    // Run immediately and then continue polling; firing logic allows catch-up after fire minute.
    await tick();
    setInterval(() => tick().catch((e) => console.error("Recap autopost tick failed:", e)), POLL_INTERVAL_MS);
}
