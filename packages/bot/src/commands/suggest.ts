import { normalizeGameName } from '@meeple/shared';
import { SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { suggestionsEmbed } from '../embeds.js';
import { errorMessage, gameLocationAutocomplete, parseMentions } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('What should we play tonight? Get suggestions from the catalogue')
  .addStringOption((o) =>
    o
      .setName('players')
      .setDescription("Who's playing tonight, e.g. @Alice @Bob (defaults to everyone)"),
  )
  .addIntegerOption((o) =>
    o
      .setName('count')
      .setDescription('Number of suggestions (default 3)')
      .setMinValue(1)
      .setMaxValue(6),
  )
  .addStringOption((o) =>
    o
      .setName('after')
      .setDescription('A game you just finished — surfaces what pairs well with it')
      .setAutocomplete(true),
  );

const suggest: BotCommand = {
  data,
  async execute(interaction) {
    const playersRaw = interaction.options.getString('players') ?? '';
    const count = interaction.options.getInteger('count') ?? 3;
    const afterRaw = interaction.options.getString('after') ?? undefined;

    const mentionIds = parseMentions(playersRaw);

    await interaction.deferReply();
    try {
      // Resolve mentions to Players (creating them if needed), like /logplay.
      let playerIds: string[] | undefined;
      if (mentionIds.length > 0) {
        const members = interaction.guild
          ? await interaction.guild.members.fetch({ user: mentionIds }).catch(() => null)
          : null;
        const players = await Promise.all(
          mentionIds.map((id) =>
            api.resolvePlayer(
              { discordUserId: id, discordName: members?.get(id)?.displayName },
              interaction.user.id,
            ),
          ),
        );
        playerIds = players.map((p) => p.id);
      }

      // Resolve `after` to a catalogue game; if it doesn't match, ignore it
      // silently rather than erroring — suggestions still come back.
      let afterGameId: string | undefined;
      let afterName: string | undefined;
      if (afterRaw) {
        const wanted = normalizeGameName(afterRaw);
        const games = await api.listGames();
        const match =
          games.find((g) => g.name.toLowerCase() === afterRaw.toLowerCase()) ??
          games.find((g) => normalizeGameName(g.name) === wanted);
        if (match) {
          afterGameId = match.id;
          afterName = match.name;
        }
      }

      const { suggestions } = await api.getSuggestions({ playerIds, afterGameId, limit: count });

      if (suggestions.length === 0) {
        const playerCount = playerIds?.length;
        await interaction.editReply(
          playerCount
            ? `No games in the catalogue fit ${playerCount} player${playerCount === 1 ? '' : 's'}. Add more games with \`/addgame\`.`
            : 'No games in the catalogue yet. Add some with `/addgame`.',
        );
        return;
      }

      await interaction.editReply({
        embeds: [suggestionsEmbed(suggestions, { playerCount: playerIds?.length, afterName })],
      });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
  autocomplete: gameLocationAutocomplete,
};

export default suggest;
