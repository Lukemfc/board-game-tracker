import type {
  GameRatings,
  UnratedGamesQuery,
  UpsertRatingInput,
  UpsertRatingResult,
} from '@meeple/shared';
import type { GameRecord } from '../db.js';
import { notFound } from '../errors.js';
import { toPlayerDto } from '../mappers.js';
import { prisma, type Tx } from '../prisma.js';
import { findGameByIdOrName, findPlayerByIdOrDiscord } from './resolve.js';

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

/**
 * Games a player still has to rate, for the bulk `/ratemany` walkthrough.
 * `played` (default) returns games they've logged a session for, ordered by how
 * often they've played them (most-played first); `all` returns the whole
 * catalogue alphabetically. Games the player has already rated are excluded.
 */
export async function getUnratedGamesForPlayer(
  idOrDiscord: string,
  scope: UnratedGamesQuery['scope'],
): Promise<GameRecord[]> {
  const player = await findPlayerByIdOrDiscord(prisma, idOrDiscord);
  if (!player) throw notFound('player');

  const rated = await prisma.rating.findMany({
    where: { playerId: player.id },
    select: { gameId: true },
  });
  const ratedIds = new Set(rated.map((r) => r.gameId));

  if (scope === 'all') {
    const games = await prisma.game.findMany({ orderBy: { name: 'asc' } });
    return games.filter((g) => !ratedIds.has(g.id));
  }

  // `played`: count this player's participations per game, newest interest first.
  const participations = await prisma.sessionPlayer.findMany({
    where: { playerId: player.id },
    select: { session: { select: { gameId: true } } },
  });
  const playCount = new Map<string, number>();
  for (const p of participations) {
    const gameId = p.session.gameId;
    playCount.set(gameId, (playCount.get(gameId) ?? 0) + 1);
  }

  const candidateIds = [...playCount.keys()].filter((id) => !ratedIds.has(id));
  if (candidateIds.length === 0) return [];

  const games = await prisma.game.findMany({ where: { id: { in: candidateIds } } });
  return games.sort(
    (a, b) =>
      (playCount.get(b.id) ?? 0) - (playCount.get(a.id) ?? 0) || a.name.localeCompare(b.name),
  );
}
