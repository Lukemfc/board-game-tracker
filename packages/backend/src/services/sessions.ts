import type {
  CreateSessionInput,
  SessionListQuery,
  SessionPlayerInput,
  UpdateSessionInput,
} from '@meeple/shared';
import { Prisma } from '@prisma/client';
import { sessionInclude, type SessionWithRelations } from '../db.js';
import { notFound } from '../errors.js';
import { prisma, type Tx } from '../prisma.js';

async function upsertGameByName(tx: Tx, name: string) {
  return tx.game.upsert({ where: { name }, update: {}, create: { name } });
}

async function upsertLocationByName(tx: Tx, name: string) {
  return tx.location.upsert({ where: { name }, update: {}, create: { name } });
}

/** Resolve (creating if needed) the player referenced by a session-player entry. */
async function resolvePlayer(tx: Tx, input: SessionPlayerInput) {
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
  // name is guaranteed present by the shared schema's refine when discordUserId is absent.
  const name = input.name as string;
  const existing = await tx.player.findFirst({ where: { displayName: name } });
  return existing ?? tx.player.create({ data: { displayName: name } });
}

/** Resolve (creating a placeholder if needed) the acting user from the request header. */
async function resolveActor(tx: Tx, actingDiscordUserId?: string) {
  if (!actingDiscordUserId) return null;
  return tx.player.upsert({
    where: { discordUserId: actingDiscordUserId },
    update: {},
    create: { discordUserId: actingDiscordUserId, displayName: actingDiscordUserId },
  });
}

function getById(db: Tx, id: string): Promise<SessionWithRelations | null> {
  return db.session.findUnique({ where: { id }, include: sessionInclude });
}

/**
 * Resolve the session-player entries into deduplicated rows. If the same player
 * appears twice, their winner flags are OR-ed and the last non-null score wins.
 */
async function buildSessionPlayerRows(tx: Tx, players: SessionPlayerInput[]) {
  const byPlayerId = new Map<
    string,
    { playerId: string; isWinner: boolean; score: number | null }
  >();
  for (const input of players) {
    const player = await resolvePlayer(tx, input);
    const existing = byPlayerId.get(player.id);
    byPlayerId.set(player.id, {
      playerId: player.id,
      isWinner: (existing?.isWinner ?? false) || input.isWinner,
      score: input.score ?? existing?.score ?? null,
    });
  }
  return [...byPlayerId.values()];
}

export async function createSession(
  input: CreateSessionInput,
  actingDiscordUserId?: string,
): Promise<SessionWithRelations> {
  const created = await prisma.$transaction(
    async (tx) => {
      const game = await upsertGameByName(tx, input.game);
      const location = input.location ? await upsertLocationByName(tx, input.location) : null;
      const actor = await resolveActor(tx, actingDiscordUserId);
      const rows = await buildSessionPlayerRows(tx, input.players);

      const session = await tx.session.create({
        data: {
          playedOn: input.playedOn ? new Date(input.playedOn) : new Date(),
          gameId: game.id,
          locationId: location?.id ?? null,
          notes: input.notes ?? null,
          createdById: actor?.id ?? null,
          players: { create: rows },
        },
        include: sessionInclude,
      });
      return session;
    },
    { timeout: 15000 },
  );
  return created;
}

export async function getSession(id: string): Promise<SessionWithRelations> {
  const session = await getById(prisma, id);
  if (!session) throw notFound('session');
  return session;
}

export async function listSessions(query: SessionListQuery): Promise<SessionWithRelations[]> {
  const where: Prisma.SessionWhereInput = {};

  if (query.game) {
    where.game = {
      OR: [{ id: query.game }, { name: { equals: query.game, mode: 'insensitive' } }],
    };
  }
  if (query.player) {
    where.players = {
      some: { player: { OR: [{ id: query.player }, { discordUserId: query.player }] } },
    };
  }
  if (query.from || query.to) {
    where.playedOn = {};
    if (query.from) where.playedOn.gte = new Date(query.from);
    if (query.to) where.playedOn.lte = new Date(query.to);
  }

  return prisma.session.findMany({
    where,
    include: sessionInclude,
    orderBy: [{ playedOn: 'desc' }, { createdAt: 'desc' }],
    take: query.limit,
    skip: query.offset,
  });
}

export async function updateSession(
  id: string,
  input: UpdateSessionInput,
): Promise<SessionWithRelations> {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.session.findUnique({ where: { id } });
      if (!existing) throw notFound('session');

      const data: Prisma.SessionUpdateInput = {};
      if (input.playedOn !== undefined) data.playedOn = new Date(input.playedOn);
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.game !== undefined) {
        const game = await upsertGameByName(tx, input.game);
        data.game = { connect: { id: game.id } };
      }
      if (input.location !== undefined) {
        data.location =
          input.location === null
            ? { disconnect: true }
            : { connect: { id: (await upsertLocationByName(tx, input.location)).id } };
      }

      await tx.session.update({ where: { id }, data });

      if (input.players !== undefined) {
        const rows = await buildSessionPlayerRows(tx, input.players);
        await tx.sessionPlayer.deleteMany({ where: { sessionId: id } });
        await tx.sessionPlayer.createMany({
          data: rows.map((r) => ({ ...r, sessionId: id })),
        });
      }

      const updated = await getById(tx, id);
      if (!updated) throw notFound('session');
      return updated;
    },
    { timeout: 15000 },
  );
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await prisma.session.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw notFound('session');
    }
    throw err;
  }
}
