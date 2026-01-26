import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { loadDb, saveDb, setGuildChannel } from "../storage.js";

export default {
    data: new SlashCommandBuilder()
        .setName("setchannel")
        .setDescription("Set the channel for match result announcements")
        .addChannelOption((opt) =>
            opt
                .setName("channel")
                .setDescription("Channel to post match tracking embeds in")
                .setRequired(true)
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

        const db = await loadDb();
        await setGuildChannel(db, guildId, channel.id);
        await saveDb(db);

        await interaction.editReply(`Match result announcements will be sent to ${channel}.`);
    },
}