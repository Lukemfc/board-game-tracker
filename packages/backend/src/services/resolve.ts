import { normalizeGameName } from '@meeple/shared';
import type { Tx } from '../prisma.js';
import type { GameRecord, PlayerRecord } from '../db.js';

/** Look up a player by id first, then by Discord user id. */
export async function findPlayerByIdOrDiscord(
  db: Tx,
  idOrDiscordId: string,
): Promise<PlayerRecord | null> {
  const byId = await db.player.findUnique({ where: { id: idOrDiscordId } });
  if (byId) return byId;
  return db.player.findUnique({ where: { discordUserId: idOrDiscordId } });
}

/**
 * Look up a game by id first, then by exact (case-insensitive) name, then by
 * normalized name — so free-typed input like "Dune Imperium Uprising" still
 * finds "Dune: Imperium – Uprising". The normalized pass only matches when it
 * is unambiguous (exactly one catalogue game normalizes to the same string).
 */
export async function findGameByIdOrName(db: Tx, idOrName: string): Promise<GameRecord | null> {
  const byId = await db.game.findUnique({ where: { id: idOrName } });
  if (byId) return byId;
  const byName = await db.game.findFirst({
    where: { name: { equals: idOrName, mode: 'insensitive' } },
  });
  if (byName) return byName;

  const wanted = normalizeGameName(idOrName);
  if (!wanted) return null;
  const games = await db.game.findMany();
  const matches = games.filter((g) => normalizeGameName(g.name) === wanted);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
