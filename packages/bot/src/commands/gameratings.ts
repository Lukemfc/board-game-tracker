import { SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { gameRatingsEmbed } from '../embeds.js';
import { errorMessage, gameLocationAutocomplete } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('gameratings')
  .setDescription("See a game's group average and per-player rating breakdown")
  .addStringOption((o) =>
    o.setName('game').setDescription('Game to look up').setRequired(true).setAutocomplete(true),
  );

const gameratings: BotCommand = {
  data,
  async execute(interaction) {
    const game = interaction.options.getString('game', true);

    await interaction.deferReply();
    try {
      const ratings = await api.getGameRatings(game);

      // Surface roster members who haven't rated it yet (only when some have).
      let notRated: string[] = [];
      if (ratings.count > 0) {
        const ratedIds = new Set(ratings.perPlayer.map((r) => r.player.id));
        const players = await api.listPlayers();
        notRated = players
          .filter((p) => !ratedIds.has(p.id))
          .map((p) => p.displayName)
          .sort((a, b) => a.localeCompare(b));
      }

      await interaction.editReply({ embeds: [gameRatingsEmbed(game, ratings, notRated)] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
  autocomplete: gameLocationAutocomplete,
};

export default gameratings;
