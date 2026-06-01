import { createGameInput, gameDto, gameList, idParam } from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { notFound } from '../errors.js';
import { toGameDto } from '../mappers.js';
import { prisma } from '../prisma.js';

export default async function gameRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { response: { 200: gameList } } }, async () => {
    const games = await prisma.game.findMany({ orderBy: { name: 'asc' } });
    return games.map(toGameDto);
  });

  // Idempotent: upserts by name so `/addgame` is safe to call repeatedly.
  app.post(
    '/',
    { schema: { body: createGameInput, response: { 200: gameDto, 201: gameDto } } },
    async (req, reply) => {
      const { name, bggId, minPlayers, maxPlayers } = req.body;
      const existing = await prisma.game.findUnique({ where: { name } });
      const game = await prisma.game.upsert({
        where: { name },
        update: { bggId, minPlayers, maxPlayers },
        create: {
          name,
          bggId: bggId ?? null,
          minPlayers: minPlayers ?? null,
          maxPlayers: maxPlayers ?? null,
        },
      });
      return reply.status(existing ? 200 : 201).send(toGameDto(game));
    },
  );

  app.get('/:id', { schema: { params: idParam, response: { 200: gameDto } } }, async (req) => {
    const game = await prisma.game.findUnique({ where: { id: req.params.id } });
    if (!game) throw notFound('game');
    return toGameDto(game);
  });
}
