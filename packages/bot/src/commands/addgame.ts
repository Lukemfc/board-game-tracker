import type { BggReconcileResult, CreateGameInput } from '@meeple/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { gameEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

export const ADDGAME_SELECT_ID = 'addgame_select';
export const ADDGAME_LINK_PREFIX = 'addgame_link:';
export const ADDGAME_NEW_PREFIX = 'addgame_new:';

const data = new SlashCommandBuilder()
  .setName('addgame')
  .setDescription('Add a game to the catalogue (with BoardGameGeek lookup)')
  .addStringOption((o) => o.setName('name').setDescription('Game name').setRequired(true))
  .addIntegerOption((o) => o.setName('minplayers').setDescription('Minimum players').setMinValue(1))
  .addIntegerOption((o) =>
    o.setName('maxplayers').setDescription('Maximum players').setMinValue(1),
  );

/** Manually add a game by name (no BGG enrichment) and confirm. */
async function addManually(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  input: CreateGameInput,
): Promise<void> {
  const game = await api.addGame(input);
  await interaction.editReply({
    content: `✅ Added **${game.name}** to the catalogue.`,
    embeds: [],
    components: [],
  });
}

const addgame: BotCommand = {
  data,
  async execute(interaction) {
    const name = interaction.options.getString('name', true);
    const minPlayers = interaction.options.getInteger('minplayers') ?? undefined;
    const maxPlayers = interaction.options.getInteger('maxplayers') ?? undefined;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      let results: Awaited<ReturnType<typeof api.bggSearch>> = [];
      try {
        results = await api.bggSearch(name);
      } catch {
        // BGG unreachable — fall back to a plain manual add.
        await addManually(interaction, { name, minPlayers, maxPlayers });
        return;
      }

      if (results.length === 0) {
        await addManually(interaction, { name, minPlayers, maxPlayers });
        return;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(ADDGAME_SELECT_ID)
        .setPlaceholder('Pick the matching game on BGG')
        .addOptions(
          ...results.map((r) => ({
            label: `${r.name}${r.yearPublished ? ` (${r.yearPublished})` : ''}`.slice(0, 100),
            value: `bgg:${r.bggId}`,
          })),
          {
            label: `➕ Add "${name}" manually (no BGG data)`.slice(0, 100),
            value: `manual:${name}`.slice(0, 100),
          },
        );

      await interaction.editReply({
        content: `Found ${results.length} match${results.length === 1 ? '' : 'es'} on BGG for **${name}** — pick one:`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
    }
  },
};

/** Render the outcome of an import-bgg call as a confirmation (or an ask). */
async function presentReconcile(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  bggId: number,
  result: BggReconcileResult,
): Promise<void> {
  if (result.action === 'ambiguous' && result.candidate) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${ADDGAME_LINK_PREFIX}${bggId}:${result.candidate.id}`)
        .setLabel(`Link to "${result.candidate.name}"`.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${ADDGAME_NEW_PREFIX}${bggId}`)
        .setLabel('Add as new game')
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      content: `🤔 This looks a lot like your existing **${result.candidate.name}**. Link them, or add it as a separate game?`,
      embeds: [],
      components: [row],
    });
    return;
  }

  if (!result.game) {
    await interaction.editReply({
      content: '⚠️ Something went wrong adding that game.',
      embeds: [],
      components: [],
    });
    return;
  }

  const verb =
    result.action === 'created' ? 'Added' : result.action === 'linked' ? 'Linked' : 'Updated';
  await interaction.editReply({
    content: `✅ ${verb} **${result.game.name}** with BoardGameGeek details.`,
    embeds: [gameEmbed(result.game)],
    components: [],
  });
}

export async function handleAddgameSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const value = interaction.values[0];
  if (!value) return;

  await interaction.deferUpdate();
  try {
    if (value.startsWith('manual:')) {
      await addManually(interaction, { name: value.slice('manual:'.length) });
      return;
    }
    const bggId = Number.parseInt(value.slice('bgg:'.length), 10);
    const result = await api.importBggGame({ bggId });
    await presentReconcile(interaction, bggId, result);
  } catch (err) {
    await interaction.editReply({ content: `⚠️ ${errorMessage(err)}`, embeds: [], components: [] });
  }
}

export async function handleAddgameButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  try {
    if (interaction.customId.startsWith(ADDGAME_LINK_PREFIX)) {
      const [bggIdRaw, linkToId] = interaction.customId
        .slice(ADDGAME_LINK_PREFIX.length)
        .split(':');
      const bggId = Number.parseInt(bggIdRaw ?? '', 10);
      const result = await api.importBggGame({ bggId, linkToId });
      await presentReconcile(interaction, bggId, result);
    } else if (interaction.customId.startsWith(ADDGAME_NEW_PREFIX)) {
      const bggId = Number.parseInt(interaction.customId.slice(ADDGAME_NEW_PREFIX.length), 10);
      const result = await api.importBggGame({ bggId, forceCreate: true });
      await presentReconcile(interaction, bggId, result);
    }
  } catch (err) {
    await interaction.editReply({ content: `⚠️ ${errorMessage(err)}`, embeds: [], components: [] });
  }
}

export default addgame;
