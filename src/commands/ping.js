import { SlashCommandBuilder } from "discord.js";

export default {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check that the bot is alive and responsive"),

    async execute(interaction) {
        await interaction.reply("Pong!");
    },
};
