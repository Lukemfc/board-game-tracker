import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('addgame')
  .setDescription('Add a game to the catalogue')
  .addStringOption((o) => o.setName('name').setDescription('Game name').setRequired(true))
  .addIntegerOption((o) => o.setName('minplayers').setDescription('Minimum players').setMinValue(1))
  .addIntegerOption((o) =>
    o.setName('maxplayers').setDescription('Maximum players').setMinValue(1),
  );

const addgame: BotCommand = {
  data,
  async execute(interaction) {
    const name = interaction.options.getString('name', true);
    const minPlayers = interaction.options.getInteger('minplayers') ?? undefined;
    const maxPlayers = interaction.options.getInteger('maxplayers') ?? undefined;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const game = await api.addGame({ name, minPlayers, maxPlayers });
      await interaction.editReply({ content: `✅ Added **${game.name}** to the catalogue.` });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default addgame;
