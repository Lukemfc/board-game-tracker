import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { stars } from '../embeds.js';
import { errorMessage, gameLocationAutocomplete } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('rate')
  .setDescription('Rate how much you enjoy a game (1–5 stars)')
  .addStringOption((o) =>
    o.setName('game').setDescription('Game to rate').setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption((o) =>
    o
      .setName('stars')
      .setDescription('How much you enjoy it, 1 (meh) to 5 (love it)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(5),
  );

const rate: BotCommand = {
  data,
  async execute(interaction) {
    const game = interaction.options.getString('game', true);
    const value = interaction.options.getInteger('stars', true);

    // Discord enforces the 1–5 bounds, but guard in case the option changes.
    if (value < 1 || value > 5) {
      await interaction.reply({
        content: 'Pick a rating between 1 and 5 stars.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const name =
        interaction.guild?.members.cache.get(interaction.user.id)?.displayName ??
        interaction.user.displayName ??
        interaction.user.username;
      const result = await api.rateGame(game, interaction.user.id, name, value);
      const avg = result.average.toFixed(1);
      await interaction.editReply({
        content: `You rated **${game}** ${stars(value)} (${value}). Group average is now ${avg}★.`,
      });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
  autocomplete: gameLocationAutocomplete,
};

export default rate;
