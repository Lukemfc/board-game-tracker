import {
  type CreateGameInput,
  type CreateSessionInput,
  type GameDto,
  gameDto,
  gameList,
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

  createSession(input: CreateSessionInput, discordUserId: string): Promise<SessionDto> {
    return this.request(sessionDto, '/sessions', { method: 'POST', body: input, discordUserId });
  }

  listSessions(filters: SessionFilters = {}): Promise<SessionDto[]> {
    return this.request(sessionList, '/sessions', { query: { ...filters } });
  }

  listGames(): Promise<GameDto[]> {
    return this.request(gameList, '/games');
  }

  addGame(input: CreateGameInput): Promise<GameDto> {
    return this.request(gameDto, '/games', { method: 'POST', body: input });
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
}

export const api = new ApiClient(config.API_BASE_URL, config.SERVICE_API_KEY);
