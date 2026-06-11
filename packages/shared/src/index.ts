/**
 * Meeple Ledger — shared contract.
 *
 * Zod schemas + inferred TypeScript types imported by BOTH the backend
 * (request/response validation) and the bot (typed API calls), so the two
 * can never drift. See PLAN.md §3.
 */
import { z } from 'zod';

export * from './bggMatch.js';

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
  /** Best name to show: realName when set, else discordName, else the Discord id. */
  displayName: z.string(),
  realName: z.string().nullable(),
  discordName: z.string().nullable(),
  discordUserId: z.string().nullable(),
  bggUsername: z.string().nullable(),
  createdAt: z.string(),
});
export type PlayerDto = z.infer<typeof playerDto>;

export const gameDto = z.object({
  id: z.string(),
  name: z.string(),
  bggId: z.number().int().nullable(),
  bggName: z.string().nullable(),
  bggThumbnail: z.string().nullable(),
  description: z.string().nullable(),
  yearPublished: z.number().int().nullable(),
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
  realName: nonEmpty('realName'),
  discordUserId: z.string().trim().min(1).optional(),
});
export type CreatePlayerInput = z.infer<typeof createPlayerInput>;

/** Link (or create-and-link) a Discord account to a player profile — `/linkme`. */
export const linkPlayerInput = z.object({
  realName: nonEmpty('realName'),
  discordUserId: nonEmpty('discordUserId'),
});
export type LinkPlayerInput = z.infer<typeof linkPlayerInput>;

/**
 * Resolve (creating if needed) a player by Discord id, syncing the last-seen
 * Discord nickname. Never touches realName — unlike /players/link.
 */
export const resolvePlayerInput = z.object({
  discordUserId: nonEmpty('discordUserId'),
  discordName: z.string().trim().min(1).optional(),
});
export type ResolvePlayerInput = z.infer<typeof resolvePlayerInput>;

export const createGameInput = z.object({
  name: nonEmpty('name'),
  bggId: z.number().int().positive().optional(),
  bggName: z.string().trim().min(1).optional(),
  bggThumbnail: z.string().trim().url().optional(),
  description: z.string().trim().optional(),
  yearPublished: z.number().int().optional(),
  minPlayers: z.number().int().positive().optional(),
  maxPlayers: z.number().int().positive().optional(),
});
export type CreateGameInput = z.infer<typeof createGameInput>;

/** Rename a game to the group's preferred name (`PATCH /games/:id`). */
export const renameGameInput = z.object({
  name: nonEmpty('name'),
});
export type RenameGameInput = z.infer<typeof renameGameInput>;

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
// BoardGameGeek integration
// ---------------------------------------------------------------------------

/** One row from a BGG game search (`GET /games/bgg-search`). */
export const bggSearchResult = z.object({
  bggId: z.number().int(),
  name: z.string(),
  yearPublished: z.number().int().nullable(),
});
export type BggSearchResult = z.infer<typeof bggSearchResult>;
export const bggSearchResults = z.array(bggSearchResult);

/** Full BGG game details (`GET /games/bgg/:bggId`). */
export const bggGameDetail = z.object({
  bggId: z.number().int(),
  name: z.string(),
  minPlayers: z.number().int().nullable(),
  maxPlayers: z.number().int().nullable(),
  yearPublished: z.number().int().nullable(),
  thumbnail: z.string().nullable(),
  description: z.string().nullable(),
});
export type BggGameDetail = z.infer<typeof bggGameDetail>;

/**
 * Pull a BGG game into the catalogue (`POST /games/import-bgg`). With neither
 * override set the backend reconciles automatically; the overrides let the bot
 * resolve an ambiguous match after asking the user.
 */
export const importBggGameInput = z
  .object({
    bggId: z.number().int().positive(),
    /** Force-link to this existing game (keeps its name). */
    linkToId: z.string().trim().min(1).optional(),
    /** Force-create a new game even if a fuzzy match exists. */
    forceCreate: z.boolean().optional(),
  })
  .refine((v) => !(v.linkToId && v.forceCreate), {
    message: 'linkToId and forceCreate are mutually exclusive',
  });
export type ImportBggGameInput = z.infer<typeof importBggGameInput>;

/** What the backend did (or wants confirmed) for a single BGG game. */
export const bggReconcileAction = z.enum(['created', 'linked', 'enriched', 'ambiguous']);
export type BggReconcileAction = z.infer<typeof bggReconcileAction>;

export const bggReconcileResult = z.object({
  action: bggReconcileAction,
  /** The resulting game; null only when `action` is `ambiguous` (nothing changed). */
  game: gameDto.nullable(),
  /** A like-named existing game the user should confirm before linking. */
  candidate: z.object({ id: z.string(), name: z.string(), score: z.number() }).nullable(),
});
export type BggReconcileResult = z.infer<typeof bggReconcileResult>;

/** Link a BGG username to a player (`POST /players/:id/bgg-link`). */
export const bggLinkInput = z.object({
  bggUsername: nonEmpty('bggUsername'),
});
export type BggLinkInput = z.infer<typeof bggLinkInput>;

/** Summary of a collection import (`POST /players/:id/bgg-import`). */
export const bggImportResult = z.object({
  created: z.number().int(),
  linked: z.number().int(),
  enriched: z.number().int(),
  skipped: z.number().int(),
  /** Ambiguous matches left untouched for manual reconciliation. */
  needsReview: z.array(
    z.object({
      bggId: z.number().int(),
      bggName: z.string(),
      candidateName: z.string(),
      score: z.number(),
    }),
  ),
});
export type BggImportResult = z.infer<typeof bggImportResult>;

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
// Suggestions — "what should we play tonight?"
// ---------------------------------------------------------------------------

/** Query for `GET /stats/suggest`. See docs/features/what-to-play-tonight.md. */
export const suggestQuery = z.object({
  /** Filter by player count; falls back to the number of `playerIds` if given. */
  playerCount: z.coerce.number().int().positive().optional(),
  /** Comma-separated Player ids — scopes affinity, ratings, and never-won checks. */
  playerIds: z.string().trim().min(1).optional(),
  /** A game just played; adds a pairing bonus to games that historically follow it. */
  afterGameId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(20).default(5),
});
export type SuggestQuery = z.infer<typeof suggestQuery>;

/** One suggested game with its (internal) score and human-readable reasons. */
export const suggestion = z.object({
  game: gameDto,
  score: z.number(),
  reasons: z.array(z.string()).min(1),
});
export type Suggestion = z.infer<typeof suggestion>;

export const suggestResponse = z.object({ suggestions: z.array(suggestion) });
export type SuggestResponse = z.infer<typeof suggestResponse>;

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/** One player's enjoyment rating (1–5) for a game. */
export const rating = z.object({ player: playerDto, value: z.number().int().min(1).max(5) });
export type Rating = z.infer<typeof rating>;

/** Aggregate ratings for a single game (`GET /games/:id/ratings`). */
export const gameRatings = z.object({
  /** Mean of all ratings, or null when nobody has rated the game. */
  average: z.number().nullable(),
  count: z.number().int(),
  /** Per-player breakdown, sorted high→low by the route. */
  perPlayer: z.array(rating),
});
export type GameRatings = z.infer<typeof gameRatings>;

/**
 * Upsert a rating (`PUT /games/:id/ratings`). The caller is identified by
 * `discordUserId` (created if needed, like `/logplay`) or an existing
 * `playerId`; at least one is required.
 */
export const upsertRatingInput = z
  .object({
    playerId: z.string().trim().min(1).optional(),
    discordUserId: z.string().trim().min(1).optional(),
    /** Display name to use if the player is created. */
    name: z.string().trim().min(1).optional(),
    value: z.number().int().min(1).max(5),
  })
  .refine((r) => Boolean(r.playerId) || Boolean(r.discordUserId), {
    message: 'playerId or discordUserId is required',
  });
export type UpsertRatingInput = z.infer<typeof upsertRatingInput>;

/** Result of an upsert: the saved rating plus the game's new group average. */
export const upsertRatingResult = z.object({
  rating,
  average: z.number(),
  count: z.number().int(),
});
export type UpsertRatingResult = z.infer<typeof upsertRatingResult>;

/**
 * Which games a player still has to rate (`GET /players/:id/unrated-games`).
 * `played` (default) = games they've logged a session for; `all` = the whole
 * catalogue. Either way, games they've already rated are excluded.
 */
export const unratedGamesQuery = z.object({
  scope: z.enum(['played', 'all']).default('played'),
});
export type UnratedGamesQuery = z.infer<typeof unratedGamesQuery>;

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
