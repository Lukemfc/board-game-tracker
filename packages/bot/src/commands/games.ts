import { SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { gamesEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('games')
  .setDescription('List games in the catalogue');

const games: BotCommand = {
  data,
  async execute(interaction) {
    await interaction.deferReply();
    try {
      const list = await api.listGames();
      await interaction.editReply({ embeds: [gamesEmbed(list)] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default games;
