import { gameStats, idParam, leaderboard, leaderboardQuery, playerStats } from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getGameStats, getLeaderboard, getPlayerStats } from '../services/stats.js';

export default async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/leaderboard',
    { schema: { querystring: leaderboardQuery, response: { 200: leaderboard } } },
    async (req) => getLeaderboard(req.query.limit),
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
