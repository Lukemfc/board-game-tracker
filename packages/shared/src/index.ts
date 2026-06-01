/**
 * Meeple Ledger — shared contract.
 *
 * Zod schemas + inferred TypeScript types imported by BOTH the backend
 * (request/response validation) and the bot (typed API calls), so the two
 * can never drift. See PLAN.md §3.
 */
import { z } from 'zod';

/** A trimmed, non-empty string. */
const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);

/** Accepts "YYYY-MM-DD" or any value parseable by `Date`. */
const dateInput = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'invalid date' });

// ---------------------------------------------------------------------------
// Output DTOs
//
// These describe what the API returns. Dates are ISO strings because handlers
// map Prisma `Date`s to strings before serializing (keeps the DB decoupled
// from the wire format).
// ---------------------------------------------------------------------------

export const playerDto = z.object({
  id: z.string(),
  displayName: z.string(),
  discordUserId: z.string().nullable(),
  createdAt: z.string(),
});
export type PlayerDto = z.infer<typeof playerDto>;

export const gameDto = z.object({
  id: z.string(),
  name: z.string(),
  bggId: z.number().int().nullable(),
  minPlayers: z.number().int().nullable(),
  maxPlayers: z.number().int().nullable(),
  createdAt: z.string(),
});
export type GameDto = z.infer<typeof gameDto>;

export const locationDto = z.object({
  id: z.string(),
  name: z.string(),
});
export type LocationDto = z.infer<typeof locationDto>;

export const sessionPlayerDto = z.object({
  player: playerDto,
  isWinner: z.boolean(),
  score: z.number().int().nullable(),
});
export type SessionPlayerDto = z.infer<typeof sessionPlayerDto>;

export const sessionDto = z.object({
  id: z.string(),
  playedOn: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  game: gameDto,
  location: locationDto.nullable(),
  createdBy: playerDto.nullable(),
  players: z.array(sessionPlayerDto),
});
export type SessionDto = z.infer<typeof sessionDto>;

export const playerList = z.array(playerDto);
export const gameList = z.array(gameDto);
export const locationList = z.array(locationDto);
export const sessionList = z.array(sessionDto);

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const idParam = z.object({ id: nonEmpty('id') });
export type IdParam = z.infer<typeof idParam>;

export const createPlayerInput = z.object({
  displayName: nonEmpty('displayName'),
  discordUserId: z.string().trim().min(1).optional(),
});
export type CreatePlayerInput = z.infer<typeof createPlayerInput>;

/** Link (or create-and-link) a Discord account to a player profile — `/linkme`. */
export const linkPlayerInput = z.object({
  displayName: nonEmpty('displayName'),
  discordUserId: nonEmpty('discordUserId'),
});
export type LinkPlayerInput = z.infer<typeof linkPlayerInput>;

export const createGameInput = z.object({
  name: nonEmpty('name'),
  bggId: z.number().int().positive().optional(),
  minPlayers: z.number().int().positive().optional(),
  maxPlayers: z.number().int().positive().optional(),
});
export type CreateGameInput = z.infer<typeof createGameInput>;

export const createLocationInput = z.object({
  name: nonEmpty('name'),
});
export type CreateLocationInput = z.infer<typeof createLocationInput>;

/**
 * One player within a session-create payload. The backend upserts the player
 * by `discordUserId` (preferred) or `name`, so the bot can pass human-friendly
 * values. At least one identifier is required.
 */
export const sessionPlayerInput = z
  .object({
    name: z.string().trim().min(1).optional(),
    discordUserId: z.string().trim().min(1).optional(),
    isWinner: z.boolean().optional().default(false),
    score: z.number().int().nullable().optional(),
  })
  .refine((p) => Boolean(p.name) || Boolean(p.discordUserId), {
    message: 'each player needs a name or discordUserId',
  });
export type SessionPlayerInput = z.infer<typeof sessionPlayerInput>;

export const createSessionInput = z.object({
  game: nonEmpty('game'),
  playedOn: dateInput.optional(),
  location: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
  players: z.array(sessionPlayerInput).min(1, 'at least one player is required'),
});
export type CreateSessionInput = z.infer<typeof createSessionInput>;

export const updateSessionInput = z.object({
  game: z.string().trim().min(1).optional(),
  playedOn: dateInput.optional(),
  location: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  players: z.array(sessionPlayerInput).min(1).optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionInput>;

export const sessionListQuery = z.object({
  game: z.string().trim().min(1).optional(),
  /** Player id or Discord user id. */
  player: z.string().trim().min(1).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type SessionListQuery = z.infer<typeof sessionListQuery>;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const leaderboardEntry = z.object({
  player: playerDto,
  plays: z.number().int(),
  wins: z.number().int(),
  /** 0..1 */
  winRate: z.number(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntry>;

export const leaderboard = z.array(leaderboardEntry);
export type Leaderboard = z.infer<typeof leaderboard>;

export const leaderboardQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuery>;

export const playerGameStat = z.object({
  game: gameDto,
  plays: z.number().int(),
  wins: z.number().int(),
});
export type PlayerGameStat = z.infer<typeof playerGameStat>;

export const playerStats = z.object({
  player: playerDto,
  plays: z.number().int(),
  wins: z.number().int(),
  winRate: z.number(),
  byGame: z.array(playerGameStat),
  recent: z.array(sessionDto),
});
export type PlayerStats = z.infer<typeof playerStats>;

export const gameStats = z.object({
  game: gameDto,
  plays: z.number().int(),
  topWinner: z.object({ player: playerDto, wins: z.number().int() }).nullable(),
  lastPlayedOn: z.string().nullable(),
});
export type GameStats = z.infer<typeof gameStats>;

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const healthResponse = z.object({
  status: z.literal('ok'),
  uptime: z.number(),
});
export type HealthResponse = z.infer<typeof healthResponse>;

export const errorResponse = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponse>;
