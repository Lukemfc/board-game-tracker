import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { errorMessage, gameLocationAutocomplete } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('renamegame')
  .setDescription("Rename a game to your group's preferred name")
  .addStringOption((o) =>
    o.setName('game').setDescription('The game to rename').setRequired(true).setAutocomplete(true),
  )
  .addStringOption((o) => o.setName('newname').setDescription('The new name').setRequired(true));

const renamegame: BotCommand = {
  data,
  async execute(interaction) {
    const game = interaction.options.getString('game', true);
    const newName = interaction.options.getString('newname', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const updated = await api.renameGame(game, newName);
      await interaction.editReply({ content: `✅ Renamed to **${updated.name}**.` });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
  autocomplete: gameLocationAutocomplete,
};

export default renamegame;
