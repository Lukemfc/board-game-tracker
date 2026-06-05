import type { LinkPlayerInput } from '@meeple/shared';
import type { PlayerRecord } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { prisma } from '../prisma.js';
import { findPlayerByIdOrDiscord } from './resolve.js';
import { collectionExists } from './bgg.js';

/**
 * Link a Discord account to a player profile (`/linkme`):
 *  - if the Discord id is already linked, update that player's display name;
 *  - else if a ghost player (no Discord id) has the same name, attach the id;
 *  - else create a new linked player.
 */
export async function linkPlayer({
  displayName,
  discordUserId,
}: LinkPlayerInput): Promise<PlayerRecord> {
  return prisma.$transaction(async (tx) => {
    const linked = await tx.player.findUnique({ where: { discordUserId } });
    if (linked) {
      return tx.player.update({ where: { id: linked.id }, data: { displayName } });
    }

    const ghost = await tx.player.findFirst({ where: { displayName, discordUserId: null } });
    if (ghost) {
      return tx.player.update({ where: { id: ghost.id }, data: { discordUserId } });
    }

    return tx.player.create({ data: { displayName, discordUserId } });
  });
}

/**
 * Validate a BGG username (its collection must be reachable) and store it on
 * the player. Idempotent — re-linking a different username just updates it.
 * `idOrDiscordId` lets the bot pass the invoking Discord user id.
 */
export async function linkBggUsername(
  idOrDiscordId: string,
  bggUsername: string,
): Promise<PlayerRecord> {
  const player = await findPlayerByIdOrDiscord(prisma, idOrDiscordId);
  if (!player) throw notFound('player');

  // Throws a friendly HttpError if the username/collection isn't usable.
  await collectionExists(bggUsername);

  const taken = await prisma.player.findUnique({ where: { bggUsername } });
  if (taken && taken.id !== player.id) {
    throw badRequest(`BGG account "${bggUsername}" is already linked to another player.`);
  }

  return prisma.player.update({ where: { id: player.id }, data: { bggUsername } });
}
