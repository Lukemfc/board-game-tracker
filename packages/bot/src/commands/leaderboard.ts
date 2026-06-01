import { SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { leaderboardEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show the win leaderboard')
  .addIntegerOption((o) =>
    o.setName('limit').setDescription('How many players (1-25)').setMinValue(1).setMaxValue(25),
  );

const leaderboard: BotCommand = {
  data,
  async execute(interaction) {
    const limit = interaction.options.getInteger('limit') ?? 10;
    await interaction.deferReply();
    try {
      const entries = await api.getLeaderboard(limit);
      await interaction.editReply({ embeds: [leaderboardEmbed(entries)] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default leaderboard;
