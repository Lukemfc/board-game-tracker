import type { CreateSessionInput } from '@meeple/shared';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { sessionEmbed } from '../embeds.js';
import { errorMessage, gameLocationAutocomplete, parseMentions } from '../util.js';

const data = new SlashCommandBuilder()
  .setName('logplay')
  .setDescription('Record a board game play')
  .addStringOption((o) =>
    o.setName('game').setDescription('Game played').setRequired(true).setAutocomplete(true),
  )
  .addStringOption((o) =>
    o
      .setName('players')
      .setDescription('Mention everyone who played, e.g. @Alice @Bob')
      .setRequired(true),
  )
  .addStringOption((o) => o.setName('winner').setDescription('Mention the winner(s)'))
  .addStringOption((o) =>
    o.setName('date').setDescription('Date played (YYYY-MM-DD); defaults to today'),
  )
  .addStringOption((o) =>
    o.setName('location').setDescription('Where it was played').setAutocomplete(true),
  )
  .addStringOption((o) => o.setName('notes').setDescription('Any notes'));

const logplay: BotCommand = {
  data,
  async execute(interaction) {
    const gameName = interaction.options.getString('game', true);
    const playersRaw = interaction.options.getString('players', true);
    const winnerRaw = interaction.options.getString('winner') ?? '';
    const date = interaction.options.getString('date') ?? undefined;
    const location = interaction.options.getString('location') ?? undefined;
    const notes = interaction.options.getString('notes') ?? undefined;

    const playerIds = parseMentions(playersRaw);
    if (playerIds.length === 0) {
      await interaction.reply({
        content: 'Mention at least one player, e.g. `@Alice @Bob`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const winnerIds = new Set(parseMentions(winnerRaw));

    await interaction.deferReply();
    try {
      // Resolve display names so players are created with friendly names + linked ids.
      const members = interaction.guild
        ? await interaction.guild.members.fetch({ user: playerIds }).catch(() => null)
        : null;

      const players: CreateSessionInput['players'] = playerIds.map((id) => ({
        discordUserId: id,
        name: members?.get(id)?.displayName,
        isWinner: winnerIds.has(id),
      }));

      const session = await api.createSession(
        { game: gameName, playedOn: date, location, notes, players },
        interaction.user.id,
      );
      await interaction.editReply({ content: '✅ Play logged!', embeds: [sessionEmbed(session)] });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
  autocomplete: gameLocationAutocomplete,
};

export default logplay;
