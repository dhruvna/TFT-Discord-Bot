import { SlashCommandBuilder } from "discord.js";

import {
    getAccountByRiotId,
    resolveRegion,
} from '../riot.js';

import { REGION_CHOICES } from '../constants/regions.js';

import {
    makeAccountKey,
    upsertGuildAccountInStore,
} from '../storage.js';
import { bootstrapTrackedGame } from "../services/accountBootstrap.js";

const logBootstrapFailure = ({ gameType, step, err, gameName, tagLine, region, platform, regional, puuid }) => {
    const status = err?.status;
    console.error(
        '[register] riot-bootstrap failed',
        {
            gameType,
            step,
            status: status ?? 'unknown',
            endpoint: err?.endpoint ?? 'unknown',
            gameName,
            tagLine,
            region,
            platform,
            regional,
            puuid: puuid ?? null,
            responseText: err?.responseText ?? null,
        }
    );
};

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

        // 5. Resolve Riot IDs -> Account PUUIDs
        let tftAccount;
        let lolAccount;
        // let account;
        try {
            tftAccount = await getAccountByRiotId({ regional, gameName, tagLine, gameType: 'TFT' });
            lolAccount = await getAccountByRiotId({ regional, gameName, tagLine, gameType: 'LOL' });
        } catch (err) {
            const status = err?.status;
            console.error(
                `[register] getAccountByRiotId failed status=${status ?? 'unknown'} endpoint=${err?.endpoint ?? 'unknown'} gameName=${gameName} tagLine=${tagLine} region=${region}`,
                err?.responseText ? { responseText: err.responseText } : err
            );

            if (status === 404) {
                await interaction.editReply("Couldn't find that Riot ID. Please double-check spelling and try again.");
                return;
            }

            if (status === 401 || status === 403) {
                await interaction.editReply('Riot API key/config issue. Please try again later.');
                return;
            }

            if (status === 429) {
                await interaction.editReply('Riot API rate limited, try again shortly.');
                return;
            }

            await interaction.editReply('Temporary Riot API failure. Please try again shortly.');
            return;
        }

        // 6. Snapshot tracked games state in parallel for LP delta + latest match tracking
        const [
            { lastRankByQueue: tftLastRankByQueue, lastMatchId: tftLastMatchId, lastMatchAt: tftLastMatchAt },
            { lastRankByQueue: lolLastRankByQueue, lastMatchId: lolLastMatchId, lastMatchAt: lolLastMatchAt },
        ] = await Promise.all([
            bootstrapTrackedGame({
                gameType: 'TFT',
                platform,
                regional,
                puuid: tftAccount?.puuid,
                onError: ({ step, gameType, err, platform: p, regional: r, puuid }) =>
                    logBootstrapFailure({ gameType, step, err, gameName, tagLine, region, platform: p, regional: r, puuid }),
            }),
            bootstrapTrackedGame({
                gameType: 'LOL',
                platform,
                regional,
                puuid: lolAccount?.puuid,
                onError: ({ step, gameType, err, platform: p, regional: r, puuid }) =>
                    logBootstrapFailure({ gameType, step, err, gameName, tagLine, region, platform: p, regional: r, puuid }),
            }),
        ]);

        // 7. Build stored record
        const stored = {
            key: makeAccountKey({ gameName: tftAccount.gameName, tagLine: tftAccount.tagLine, platform }),
            gameName: tftAccount.gameName,
            tagLine: tftAccount.tagLine,
            region,
            platform,
            regional,
            identity: {
                tft: { puuid: tftAccount.puuid ?? null },
                lol: { puuid: lolAccount?.puuid ?? null },
            },
            trackedGames: {
                tft: {
                    enabled: true,
                    lastMatchId: tftLastMatchId,
                    lastMatchAt: tftLastMatchAt,
                    lastRankByQueue: tftLastRankByQueue,
                    recapEvents: [],
                },
                lol: {
                    enabled: true,
                    lastMatchId: lolLastMatchId,
                    lastMatchAt: lolLastMatchAt,
                    lastRankByQueue: lolLastRankByQueue,
                    recapEvents: [],
                },
            },
        };

        // 8. Upsert into storage
        const { existed } = await upsertGuildAccountInStore(guildId, stored);

        // 9. Confirm to user
        if (existed) {
            await interaction.editReply(`**${stored.gameName}#${stored.tagLine}** is already registered in this server.`);
            return;
        }
    
        await interaction.editReply(`Successfully registered **${stored.gameName}#${stored.tagLine}** for this server.`);
    },
};
