import { gameRatings, idParam, upsertRatingInput, upsertRatingResult } from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getGameRatings, upsertRating } from '../services/ratings.js';

/**
 * Game enjoyment ratings. Registered under the `/games` prefix, so these live
 * at `/games/:id/ratings`. `:id` may be a game id or its name (case-insensitive).
 */
export default async function ratingRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Upsert the caller's rating; returns the rating and the new group average.
  app.put(
    '/:id/ratings',
    { schema: { params: idParam, body: upsertRatingInput, response: { 200: upsertRatingResult } } },
    async (req) => upsertRating(req.params.id, req.body),
  );

  // Aggregate + per-player breakdown for a game.
  app.get(
    '/:id/ratings',
    { schema: { params: idParam, response: { 200: gameRatings } } },
    async (req) => getGameRatings(req.params.id),
  );
}
