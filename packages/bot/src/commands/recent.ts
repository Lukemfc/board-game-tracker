import { SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { gameHistoryEmbed, recentEmbed } from '../embeds.js';
import { errorMessage, gameLocationAutocomplete } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('recent')
  .setDescription('Show the most recent plays')
  .addIntegerOption((o) =>
    o.setName('count').setDescription('How many to show (1-100)').setMinValue(1).setMaxValue(100),
  )
  .addStringOption((o) =>
    o
      .setName('game')
      .setDescription('Show every play of one game')
      .setAutocomplete(true),
  );

const recent: BotCommand = {
  data,
  async execute(interaction) {
    const count = interaction.options.getInteger('count');
    const game = interaction.options.getString('game') ?? undefined;
    await interaction.deferReply();
    try {
      // With a game and no explicit count, show the lot (up to the backend max).
      const limit = count ?? (game ? 100 : 5);
      const sessions = await api.listSessions({ game, limit });
      const embed = game ? gameHistoryEmbed(game, sessions) : recentEmbed(sessions);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
  autocomplete: gameLocationAutocomplete,
};

export default recent;
