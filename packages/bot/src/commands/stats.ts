import { SlashCommandBuilder } from 'discord.js';
import { api, ApiError } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { playerStatsEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show stats for you or another player')
  .addUserOption((o) => o.setName('player').setDescription('Whose stats (defaults to you)'));

const stats: BotCommand = {
  data,
  async execute(interaction) {
    const target = interaction.options.getUser('player') ?? interaction.user;
    await interaction.deferReply();
    try {
      const playerStats = await api.getPlayerStats(target.id);
      await interaction.editReply({ embeds: [playerStatsEmbed(playerStats)] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await interaction.editReply({
          content: `No plays recorded for ${target.username} yet. Use \`/linkme\` if you log in under a different name.`,
        });
        return;
      }
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export default stats;
