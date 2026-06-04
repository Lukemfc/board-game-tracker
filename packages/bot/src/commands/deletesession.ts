import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { errorMessage } from '../util.js';

export const DELETESESSION_SELECT_ID = 'deletesession_select';
export const DELETESESSION_CONFIRM_PREFIX = 'deletesession_confirm_';
export const DELETESESSION_CANCEL_PREFIX = 'deletesession_cancel_';

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

const data = new SlashCommandBuilder()
  .setName('deletesession')
  .setDescription('Delete a previously logged session');

const deletesession: BotCommand = {
  data,
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const sessions = await api.listSessions({ limit: 20 });
      if (sessions.length === 0) {
        await interaction.editReply({ content: 'No sessions found to delete.' });
        return;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(DELETESESSION_SELECT_ID)
        .setPlaceholder('Select a session to delete')
        .addOptions(
          sessions.map((s) => {
            const players = s.players.map((p) => p.player.displayName).join(', ');
            const label = `${s.game.name} — ${fmtDate(s.playedOn)} — Players: ${players}`;
            return { label: label.slice(0, 100), value: s.id };
          }),
        );

      await interaction.editReply({
        content: 'Select a session to delete:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

export async function handleDeleteSessionSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const sessionId = interaction.values[0];
  if (!sessionId) return;

  await interaction.deferUpdate();
  try {
    const session = await api.getSession(sessionId);
    const players = session.players.map((p) => p.player.displayName).join(', ');
    const winners =
      session.players
        .filter((p) => p.isWinner)
        .map((p) => p.player.displayName)
        .join(', ') || '—';

    const embed = new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle('⚠️ Delete this session?')
      .addFields(
        { name: 'Game', value: session.game.name, inline: true },
        { name: 'Date', value: fmtDate(session.playedOn), inline: true },
        { name: 'Players', value: players },
        { name: 'Winner', value: winners, inline: true },
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${DELETESESSION_CONFIRM_PREFIX}${sessionId}`)
        .setLabel('Confirm Delete')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${DELETESESSION_CANCEL_PREFIX}${sessionId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ content: '', embeds: [embed], components: [row] });
  } catch (err) {
    await interaction.editReply({ content: `⚠️ ${errorMessage(err)}`, embeds: [], components: [] });
  }
}

export async function handleDeleteSessionButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const isConfirm = interaction.customId.startsWith(DELETESESSION_CONFIRM_PREFIX);
  const sessionId = isConfirm
    ? interaction.customId.slice(DELETESESSION_CONFIRM_PREFIX.length)
    : interaction.customId.slice(DELETESESSION_CANCEL_PREFIX.length);

  if (isConfirm) {
    try {
      await api.deleteSession(sessionId);
      await interaction.update({ content: '✅ Session deleted.', embeds: [], components: [] });
    } catch (err) {
      await interaction.update({
        content: `⚠️ ${errorMessage(err)}`,
        embeds: [],
        components: [],
      });
    }
  } else {
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
  }
}

export default deletesession;
