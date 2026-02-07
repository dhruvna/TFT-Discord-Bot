import { SlashCommandBuilder } from "discord.js";

import {
    getAccountByRiotId,
    getTFTRankByPuuid,
    getTFTMatchIdsByPuuid,
    REGION_CHOICES,
    resolveRegion,
} from '../riot.js';

import {
    makeAccountKey,
    loadDb,
    saveDb,
    upsertGuildAccount,
} from '../storage.js';

export default {
    data: new SlashCommandBuilder()
        .setName("register")
        .setDescription("Register Riot ID in this server for future lookup")
        .addStringOption((opt) =>
            opt.setName('gamename').setDescription('Riot ID Gamename (before #)').setRequired(true)
        )
        .addStringOption((opt) =>
            opt.setName('tagline').setDescription('Riot ID Tagline (after #)').setRequired(true)
        )
        .addStringOption((opt) =>
            opt.setName('region').setDescription('Region like NA, EUW, KR').setRequired(true).addChoices(...REGION_CHOICES)
        ),

    async execute(interaction) {
        // 1. Ensure command is run in a server only
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({content: "This command can only be used in a server (not DMs).", ephemeral: true});
            return;
        }

        // 2. Pull user inputs from disc command
        const gameName = interaction.options.getString("gamename", true);
        const tagLine = interaction.options.getString("tagline", true);
        const regionInput = interaction.options.getString("region", true);

        // 3. Normalize platform + get regional routing 
        const { platform, regional, region } = resolveRegion(regionInput);
        
        // 4. Defer reply in case of Riot API delay
        await interaction.deferReply({ ephemeral: true });

        // 5. Riot ID -> Account PUUID
        let account;
        try {
            account = await getAccountByRiotId({ regional,  gameName, tagLine });
        } catch {
            await interaction.editReply("Couldn't find that Riot ID. Please double-check spelling and try again.");
            return;
        }

        // 6. Snapshot current TFT rank, for use in LP delta tracking
        let lastRankByQueue = {};
        try {
            const entries = await getTFTRankByPuuid({ platform, puuid: account.puuid });

            const now = Date.now();
            const wanted = new Set(["RANKED_TFT", "RANKED_TFT_DOUBLE_UP"]);
            
            for (const e of Array.isArray(entries) ? entries : []) {
                if (!wanted.has(e.queueType)) continue;

                lastRankByQueue[e.queueType] = {
                    tier: e.tier,
                    rank: e.rank ?? null,                 // null for MASTER+ and some queues
                    lp: Number(e.leaguePoints ?? 0),
                    wins: Number(e.wins ?? 0),
                    losses: Number(e.losses ?? 0),
                    lastUpdatedAt: now,
                };
            }
        } catch {
        lastRankByQueue = {};
        }
        
        // 7. Snapshot latest match ID, for use in game tracking
        let lastMatchId = null;
        try {
            const ids = await getTFTMatchIdsByPuuid({ regional, puuid: account.puuid, count: 1 });
            lastMatchId = Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
        } catch {
            lastMatchId = null;
        }

        // 8. Build stored record
        const stored = {
            key: makeAccountKey({ gameName: account.gameName, tagLine: account.tagLine, platform }),
            gameName: account.gameName,
            tagLine: account.tagLine,
            region,
            platform,
            regional,
            puuid: account.puuid,
            lastMatchId,
            lastRankByQueue,
            recapEvents: [],
        };

        // 9. Upsert into storage
        const db = await loadDb();
        const { existed } = await upsertGuildAccount(db, guildId, stored);
        await saveDb(db);

        // 10. Confirm to user
        if (existed) {
            await interaction.editReply(`**${stored.gameName}#${stored.tagLine}** is already registered in this server.`);
            return;
        }
    
        await interaction.editReply(`Successfully registered **${stored.gameName}#${stored.tagLine}** for this server.`); 
    },
};
