import type { SessionDto, UpdateSessionInput } from '@meeple/shared';
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { sessionEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';
import {
  buildSessionPlayers,
  parseCommaSeparated,
  validateWinners,
} from '../utils/parsePlayers.js';

export const EDITSESSION_SELECT_ID = 'editsession_select';
export const EDITSESSION_MODAL_PREFIX = 'editsession_modal_';

// Cache sessions from the most recent listSessions call so the select handler
// can build the modal with no async gap before showModal() — required because
// showModal() must be the first and immediate response to a component interaction.
const sessionCache = new Map<string, SessionDto>();

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

const data = new SlashCommandBuilder()
  .setName('editsession')
  .setDescription('Edit a previously logged session');

const editsession: BotCommand = {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const sessions = await api.listSessions({ limit: 20 });
      if (sessions.length === 0) {
        await interaction.editReply({ content: 'No sessions found to edit.' });
        return;
      }

      for (const s of sessions) sessionCache.set(s.id, s);

      const select = new StringSelectMenuBuilder()
        .setCustomId(EDITSESSION_SELECT_ID)
        .setPlaceholder('Select a session to edit')
        .addOptions(
          sessions.map((s) => {
            const players = s.players.map((p) => p.player.displayName).join(', ');
            const label = `${s.game.name} — ${fmtDate(s.playedOn)} — Players: ${players}`;
            return { label: label.slice(0, 100), value: s.id };
          }),
        );

      await interaction.editReply({
        content: 'Select a session to edit:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export async function handleEditSessionSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const sessionId = interaction.values[0];
  if (!sessionId) return;

  const session = sessionCache.get(sessionId);
  if (!session) {
    await interaction.reply({
      content: '⚠️ Session not found in cache. Please run `/editsession` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const winners = session.players.filter((p) => p.isWinner).map((p) => p.player.displayName);
  const allPlayers = session.players.map((p) => p.player.displayName);

  // Discord modals support max 5 fields; notes is omitted and left unchanged by the patch.
  const modal = new ModalBuilder()
    .setCustomId(`${EDITSESSION_MODAL_PREFIX}${sessionId}`)
    .setTitle('Edit Session')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('game')
          .setLabel('Game name')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setValue(session.game.name),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('winners')
          .setLabel('Winner(s) — comma-separated')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(500)
          .setRequired(false)
          .setValue(winners.join(', ')),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('players')
          .setLabel('Players — comma-separated')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(500)
          .setValue(allPlayers.join(', ')),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('date')
          .setLabel('Date (YYYY-MM-DD)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(10)
          .setValue(session.playedOn.slice(0, 10)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('location')
          .setLabel('Location (leave blank to clear)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(false)
          .setValue(session.location?.name ?? ''),
      ),
    );

  await interaction.showModal(modal);
}

export async function handleEditSessionModal(interaction: ModalSubmitInteraction): Promise<void> {
  const sessionId = interaction.customId.slice(EDITSESSION_MODAL_PREFIX.length);

  const game = interaction.fields.getTextInputValue('game').trim();
  const winnersRaw = interaction.fields.getTextInputValue('winners').trim();
  const playersRaw = interaction.fields.getTextInputValue('players').trim();
  const dateRaw = interaction.fields.getTextInputValue('date').trim();
  const locationRaw = interaction.fields.getTextInputValue('location').trim();

  const playerNames = parseCommaSeparated(playersRaw);
  const winnerNames = parseCommaSeparated(winnersRaw);

  if (winnerNames.length > 0) {
    const err = validateWinners(playerNames, winnerNames);
    if (err) {
      await interaction.reply({ content: `⚠️ ${err}`, flags: MessageFlags.Ephemeral });
      return;
    }
  }

  if (Number.isNaN(Date.parse(dateRaw))) {
    await interaction.reply({
      content: '⚠️ Invalid date. Use YYYY-MM-DD format.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const patch: UpdateSessionInput = {
      game: game || undefined,
      playedOn: dateRaw || undefined,
      location: locationRaw !== '' ? locationRaw : null,
      players: playerNames.length > 0 ? buildSessionPlayers(playerNames, winnerNames) : undefined,
    };

    const updated = await api.updateSession(sessionId, patch);
    await interaction.editReply({
      content: '✅ Session updated!',
      embeds: [sessionEmbed(updated)],
    });
  } catch (err) {
    await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
  }
}

export default editsession;
