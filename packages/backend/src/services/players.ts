import type { LinkPlayerInput } from '@meeple/shared';
import type { PlayerRecord } from '../db.js';
import { prisma } from '../prisma.js';

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
