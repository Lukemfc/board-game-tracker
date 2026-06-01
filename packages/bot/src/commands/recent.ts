import { SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { recentEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('recent')
  .setDescription('Show the most recent plays')
  .addIntegerOption((o) =>
    o.setName('count').setDescription('How many to show (1-20)').setMinValue(1).setMaxValue(20),
  );

const recent: BotCommand = {
  data,
  async execute(interaction) {
    const count = interaction.options.getInteger('count') ?? 5;
    await interaction.deferReply();
    try {
      const sessions = await api.listSessions({ limit: count });
      await interaction.editReply({ embeds: [recentEmbed(sessions)] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default recent;
