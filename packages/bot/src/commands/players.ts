import { SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { playersEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder().setName('players').setDescription('List known players');

const players: BotCommand = {
  data,
  async execute(interaction) {
    await interaction.deferReply();
    try {
      const list = await api.listPlayers();
      await interaction.editReply({ embeds: [playersEmbed(list)] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default players;
