import { Prisma } from '@prisma/client';

/** Relations always loaded when returning a session over the API. */
export const sessionInclude = {
  game: true,
  location: true,
  createdBy: true,
  players: { include: { player: true } },
} satisfies Prisma.SessionInclude;

export type SessionWithRelations = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;
export type PlayerRecord = Prisma.PlayerGetPayload<object>;
export type GameRecord = Prisma.GameGetPayload<object>;
export type LocationRecord = Prisma.LocationGetPayload<object>;
