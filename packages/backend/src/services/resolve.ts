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

/** Look up a game by id first, then by exact (case-insensitive) name. */
export async function findGameByIdOrName(db: Tx, idOrName: string): Promise<GameRecord | null> {
  const byId = await db.game.findUnique({ where: { id: idOrName } });
  if (byId) return byId;
  return db.game.findFirst({ where: { name: { equals: idOrName, mode: 'insensitive' } } });
}
