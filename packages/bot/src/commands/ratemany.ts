import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { GameDto } from '@meeple/shared';
import { api } from '../apiClient.js';
import type { BotCommand } from '../commandTypes.js';
import { rateManyEmbed } from '../embeds.js';
import { errorMessage } from '../util.js';

export const RATEMANY_PREFIX = 'ratemany:';

/** In-flight walkthrough state, keyed by a generated session id. */
interface RateSession {
  userId: string;
  /** Display name to attribute new players to, like `/rate`. */
  name: string | undefined;
  games: GameDto[];
  index: number;
  rated: number;
  skipped: number;
}

// Ephemeral, per-user state. Lost on restart (a stale button reports "expired").
const sessions = new Map<string, RateSession>();
const SESSION_TTL_MS = 15 * 60 * 1000;

function buttonRows(sessionId: string): ActionRowBuilder<ButtonBuilder>[] {
  const starRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[1, 2, 3, 4, 5].map((v) =>
      new ButtonBuilder()
        .setCustomId(`${RATEMANY_PREFIX}${sessionId}:star:${v}`)
        .setLabel(`${v}★`)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RATEMANY_PREFIX}${sessionId}:skip:0`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${RATEMANY_PREFIX}${sessionId}:finish:0`)
      .setLabel('Finish')
      .setStyle(ButtonStyle.Danger),
  );
  return [starRow, controlRow];
}

function summary(session: RateSession): string {
  const { rated, skipped } = session;
  if (rated === 0 && skipped === 0) return 'No games rated.';
  return `✅ Done! Rated **${rated}** game${rated === 1 ? '' : 's'}${
    skipped > 0 ? `, skipped ${skipped}` : ''
  }. Thanks for the ratings!`;
}

const data = new SlashCommandBuilder()
  .setName('ratemany')
  .setDescription("Quickly rate the games you've played but haven't rated yet");

const ratemany: BotCommand = {
  data,
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let games: GameDto[];
    try {
      games = await api.getUnratedGames(interaction.user.id, 'played');
    } catch (err) {
      await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
      return;
    }

    if (games.length === 0) {
      await interaction.editReply({
        content:
          "Nothing to rate — you've rated every game you've played. 🎉 Log more with `/logplay`, or rate a specific game with `/rate`.",
      });
      return;
    }

    const sessionId = randomUUID();
    const name =
      interaction.guild?.members.cache.get(interaction.user.id)?.displayName ??
      interaction.user.displayName ??
      interaction.user.username;
    const session: RateSession = {
      userId: interaction.user.id,
      name,
      games,
      index: 0,
      rated: 0,
      skipped: 0,
    };
    sessions.set(sessionId, session);
    setTimeout(() => sessions.delete(sessionId), SESSION_TTL_MS).unref?.();

    const first = games[0];
    if (!first) return;
    await interaction.editReply({
      embeds: [rateManyEmbed(first, 0, games.length, 0, 0)],
      components: buttonRows(sessionId),
    });
  },
};

/** Handle a star / skip / finish tap in a `/ratemany` walkthrough. */
export async function handleRateManyButton(interaction: ButtonInteraction): Promise<void> {
  const [, sessionId, action, valueRaw] = interaction.customId.split(':');
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    await interaction.update({
      content:
        '⏳ This rating session expired. Run `/ratemany` again to pick up where you left off.',
      embeds: [],
      components: [],
    });
    return;
  }
  // Ephemeral, so only the owner can see it — but guard regardless.
  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: "This isn't your rating session.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'finish') {
    sessions.delete(sessionId as string);
    await interaction.update({ content: summary(session), embeds: [], components: [] });
    return;
  }

  await interaction.deferUpdate();

  const current = session.games[session.index];
  if (action === 'star' && current) {
    try {
      await api.rateGame(current.id, session.userId, session.name, Number(valueRaw));
      session.rated += 1;
    } catch {
      // Keep going — a single failed save shouldn't end the walkthrough.
      session.skipped += 1;
    }
  } else if (action === 'skip') {
    session.skipped += 1;
  }

  session.index += 1;
  const next = session.games[session.index];
  if (!next) {
    sessions.delete(sessionId as string);
    await interaction.editReply({ content: summary(session), embeds: [], components: [] });
    return;
  }

  await interaction.editReply({
    embeds: [
      rateManyEmbed(next, session.index, session.games.length, session.rated, session.skipped),
    ],
    components: buttonRows(sessionId as string),
  });
}

export default ratemany;
