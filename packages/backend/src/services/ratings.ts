import type { GameRatings, UpsertRatingInput, UpsertRatingResult } from '@meeple/shared';
import { notFound } from '../errors.js';
import { toPlayerDto } from '../mappers.js';
import { prisma, type Tx } from '../prisma.js';
import { findGameByIdOrName } from './resolve.js';

/** Resolve (creating from a Discord id if needed) the player doing the rating. */
async function resolveRater(tx: Tx, input: UpsertRatingInput) {
  if (input.discordUserId) {
    return tx.player.upsert({
      where: { discordUserId: input.discordUserId },
      update: {},
      create: {
        discordUserId: input.discordUserId,
        displayName: input.name ?? input.discordUserId,
      },
    });
  }
  // playerId is guaranteed present by the shared schema's refine.
  const player = await tx.player.findUnique({ where: { id: input.playerId as string } });
  if (!player) throw notFound('player');
  return player;
}

/** Mean (or null) and count for a game's ratings, as currently stored. */
async function aggregate(
  tx: Tx,
  gameId: string,
): Promise<{ average: number | null; count: number }> {
  const result = await tx.rating.aggregate({
    where: { gameId },
    _avg: { value: true },
    _count: { _all: true },
  });
  return { average: result._avg.value ?? null, count: result._count._all };
}

/** Upsert the caller's rating for a game and return it with the new group average. */
export async function upsertRating(
  idOrName: string,
  input: UpsertRatingInput,
): Promise<UpsertRatingResult> {
  return prisma.$transaction(async (tx) => {
    const game = await findGameByIdOrName(tx, idOrName);
    if (!game) throw notFound('game');

    const player = await resolveRater(tx, input);

    await tx.rating.upsert({
      where: { playerId_gameId: { playerId: player.id, gameId: game.id } },
      update: { value: input.value },
      create: { playerId: player.id, gameId: game.id, value: input.value },
    });

    const { average, count } = await aggregate(tx, game.id);
    return {
      rating: { player: toPlayerDto(player), value: input.value },
      // At least this rating exists now, so the average is non-null.
      average: average as number,
      count,
    };
  });
}

/** Aggregate + per-player breakdown for a game, sorted high→low. */
export async function getGameRatings(idOrName: string): Promise<GameRatings> {
  const game = await findGameByIdOrName(prisma, idOrName);
  if (!game) throw notFound('game');

  const ratings = await prisma.rating.findMany({
    where: { gameId: game.id },
    include: { player: true },
  });

  const perPlayer = ratings
    .map((r) => ({ player: toPlayerDto(r.player), value: r.value }))
    .sort((a, b) => b.value - a.value || a.player.displayName.localeCompare(b.player.displayName));

  const count = ratings.length;
  const average = count > 0 ? ratings.reduce((sum, r) => sum + r.value, 0) / count : null;

  return { average, count, perPlayer };
}
