import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import { loadDb, saveDb, setGuildChannel, setGuildQueueConfig } from "../storage.js";
import { DEFAULT_ANNOUNCE_QUEUES } from "../constants/queues.js";

export default {
    data: new SlashCommandBuilder()
        .setName("setchannel")
        .setDescription("Set the channel for match result announcements")
        .addChannelOption((opt) =>
            opt
                .setName("channel")
                .setDescription("Channel to post match tracking embeds in")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addBooleanOption(opt => 
            opt
                .setName("ranked_only")
                .setDescription("Announce only ranked TFT matches")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ 
                content: "This command can only be used in a server.", 
                ephemeral: true 
            });
        return;
        }

        const channel = interaction.options.getChannel("channel", true);
        if (!channel.isTextBased()) {
            await interaction.reply({ 
                content: "Please select a text-based channel.", 
                ephemeral: true 
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        
        const effectiveRankedOnly = interaction.options.getBoolean("ranked_only") ?? true;

        const db = await loadDb();

        await setGuildChannel(db, guildId, channel.id);

        if (effectiveRankedOnly) {
            await setGuildQueueConfig(db, guildId, DEFAULT_ANNOUNCE_QUEUES);
        } else {
            await setGuildQueueConfig(db, guildId, null);
        }
        await saveDb(db);

        await interaction.editReply(
            `Match result announcements will be sent to ${channel}.\n` +
                `Queue filter: **${effectiveRankedOnly ? "Ranked + Double Up only" : "All queues"}**`
        );
    },
}