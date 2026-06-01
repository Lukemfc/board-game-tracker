import { createPlayerInput, idParam, linkPlayerInput, playerDto, playerList } from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { notFound } from '../errors.js';
import { toPlayerDto } from '../mappers.js';
import { prisma } from '../prisma.js';
import { linkPlayer } from '../services/players.js';

export default async function playerRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { response: { 200: playerList } } }, async () => {
    const players = await prisma.player.findMany({ orderBy: { displayName: 'asc' } });
    return players.map(toPlayerDto);
  });

  app.post(
    '/',
    { schema: { body: createPlayerInput, response: { 201: playerDto } } },
    async (req, reply) => {
      const player = await prisma.player.create({
        data: { displayName: req.body.displayName, discordUserId: req.body.discordUserId ?? null },
      });
      return reply.status(201).send(toPlayerDto(player));
    },
  );

  app.post(
    '/link',
    { schema: { body: linkPlayerInput, response: { 200: playerDto } } },
    async (req) => {
      return toPlayerDto(await linkPlayer(req.body));
    },
  );

  app.get('/:id', { schema: { params: idParam, response: { 200: playerDto } } }, async (req) => {
    const player = await prisma.player.findUnique({ where: { id: req.params.id } });
    if (!player) throw notFound('player');
    return toPlayerDto(player);
  });
}
