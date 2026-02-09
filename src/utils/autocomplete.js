import { listGuildAccounts } from "../storage.js";

export async function respondWithAccountChoices(interaction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.respond([]);

    const focused = interaction.options.getFocused() ?? "";
    const q = focused.toLowerCase();

    const accounts = await listGuildAccounts(guildId);

    const filtered = 
        q.length === 0
            ? accounts
            : accounts.filter(a => {
                const name = `${a.gameName}#${a.tagLine}`.toLowerCase();
                const region = String(a.region ?? "").toLowerCase();
                return name.includes(q) || region.includes(q);
            });

    await interaction.respond(
        filtered.slice(0, 25).map(a => ({
            name: `${a.gameName}#${a.tagLine} (${a.region})`,
            value: a.key,
        }))
    );
}