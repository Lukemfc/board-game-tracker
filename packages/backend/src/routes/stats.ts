import {
  gameStats,
  idParam,
  leaderboard,
  leaderboardQuery,
  playerStats,
  suggestQuery,
  suggestResponse,
} from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getGameStats, getLeaderboard, getPlayerStats } from '../services/stats.js';
import { getSuggestions } from '../services/suggest.js';

export default async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/leaderboard',
    { schema: { querystring: leaderboardQuery, response: { 200: leaderboard } } },
    async (req) => getLeaderboard(req.query.limit),
  );

  // "What should we play tonight?" — drives the bot's /suggest command.
  app.get(
    '/suggest',
    { schema: { querystring: suggestQuery, response: { 200: suggestResponse } } },
    async (req) => getSuggestions(req.query),
  );

  app.get(
    '/players/:id',
    { schema: { params: idParam, response: { 200: playerStats } } },
    async (req) => getPlayerStats(req.params.id),
  );

  app.get(
    '/games/:id',
    { schema: { params: idParam, response: { 200: gameStats } } },
    async (req) => getGameStats(req.params.id),
  );
}
