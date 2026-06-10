import {
  type BggImportResult,
  bggImportResult,
  type BggReconcileResult,
  bggReconcileResult,
  type BggSearchResult,
  bggSearchResults,
  type CreateGameInput,
  type CreateSessionInput,
  type GameDto,
  gameDto,
  type GameRatings,
  gameRatings,
  gameList,
  type ImportBggGameInput,
  leaderboard,
  type LeaderboardEntry,
  type LinkPlayerInput,
  type LocationDto,
  locationList,
  type PlayerDto,
  playerDto,
  playerList,
  type PlayerStats,
  playerStats,
  type SessionDto,
  sessionDto,
  sessionList,
  type UpdateSessionInput,
  type UpsertRatingResult,
  upsertRatingResult,
} from '@meeple/shared';
import type { z } from 'zod';
import { config } from './config.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  discordUserId?: string;
}

interface SessionFilters {
  game?: string;
  player?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(
    schema: z.ZodType<T>,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.discordUserId) headers['x-discord-user-id'] = opts.discordUserId;

    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const data = (await res.json()) as { message?: string };
        if (data?.message) message = data.message;
      } catch {
        // non-JSON error body; keep the generic message
      }
      throw new ApiError(res.status, message);
    }

    return schema.parse(await res.json());
  }

  private async requestVoid(path: string, opts: RequestOptions = {}): Promise<void> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.discordUserId) headers['x-discord-user-id'] = opts.discordUserId;
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const data = (await res.json()) as { message?: string };
        if (data?.message) message = data.message;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, message);
    }
  }

  createSession(input: CreateSessionInput, discordUserId: string): Promise<SessionDto> {
    return this.request(sessionDto, '/sessions', { method: 'POST', body: input, discordUserId });
  }

  listSessions(filters: SessionFilters = {}): Promise<SessionDto[]> {
    return this.request(sessionList, '/sessions', { query: { ...filters } });
  }

  getSession(id: string): Promise<SessionDto> {
    return this.request(sessionDto, `/sessions/${encodeURIComponent(id)}`);
  }

  updateSession(id: string, input: UpdateSessionInput): Promise<SessionDto> {
    return this.request(sessionDto, `/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  deleteSession(id: string): Promise<void> {
    return this.requestVoid(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listGames(): Promise<GameDto[]> {
    return this.request(gameList, '/games');
  }

  addGame(input: CreateGameInput): Promise<GameDto> {
    return this.request(gameDto, '/games', { method: 'POST', body: input });
  }

  renameGame(idOrName: string, name: string): Promise<GameDto> {
    return this.request(gameDto, `/games/${encodeURIComponent(idOrName)}`, {
      method: 'PATCH',
      body: { name },
    });
  }

  bggSearch(query: string): Promise<BggSearchResult[]> {
    return this.request(bggSearchResults, '/games/bgg-search', { query: { query } });
  }

  importBggGame(input: ImportBggGameInput): Promise<BggReconcileResult> {
    return this.request(bggReconcileResult, '/games/import-bgg', { method: 'POST', body: input });
  }

  linkBgg(discordUserId: string, bggUsername: string): Promise<PlayerDto> {
    return this.request(playerDto, `/players/${encodeURIComponent(discordUserId)}/bgg-link`, {
      method: 'POST',
      body: { bggUsername },
      discordUserId,
    });
  }

  importCollection(discordUserId: string): Promise<BggImportResult> {
    return this.request(
      bggImportResult,
      `/players/${encodeURIComponent(discordUserId)}/bgg-import`,
      {
        method: 'POST',
        discordUserId,
      },
    );
  }

  listLocations(): Promise<LocationDto[]> {
    return this.request(locationList, '/locations');
  }

  listPlayers(): Promise<PlayerDto[]> {
    return this.request(playerList, '/players');
  }

  linkPlayer(input: LinkPlayerInput, discordUserId: string): Promise<PlayerDto> {
    return this.request(playerDto, '/players/link', {
      method: 'POST',
      body: input,
      discordUserId,
    });
  }

  getLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
    return this.request(leaderboard, '/stats/leaderboard', { query: { limit } });
  }

  getPlayerStats(idOrDiscordId: string): Promise<PlayerStats> {
    return this.request(playerStats, `/stats/players/${encodeURIComponent(idOrDiscordId)}`);
  }

  rateGame(
    gameIdOrName: string,
    discordUserId: string,
    name: string | undefined,
    value: number,
  ): Promise<UpsertRatingResult> {
    return this.request(upsertRatingResult, `/games/${encodeURIComponent(gameIdOrName)}/ratings`, {
      method: 'PUT',
      body: { discordUserId, name, value },
      discordUserId,
    });
  }

  getGameRatings(gameIdOrName: string): Promise<GameRatings> {
    return this.request(gameRatings, `/games/${encodeURIComponent(gameIdOrName)}/ratings`);
  }

  getUnratedGames(idOrDiscordId: string, scope: 'played' | 'all' = 'played'): Promise<GameDto[]> {
    return this.request(gameList, `/players/${encodeURIComponent(idOrDiscordId)}/unrated-games`, {
      query: { scope },
    });
  }
}

export const api = new ApiClient(config.API_BASE_URL, config.SERVICE_API_KEY);
