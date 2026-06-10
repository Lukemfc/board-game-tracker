import {
  bggImportResult,
  bggLinkInput,
  createPlayerInput,
  gameList,
  idParam,
  linkPlayerInput,
  playerDto,
  playerList,
  unratedGamesQuery,
} from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { badRequest, notFound } from '../errors.js';
import { toGameDto, toPlayerDto } from '../mappers.js';
import { prisma } from '../prisma.js';
import { importCollection } from '../services/bggReconcile.js';
import { linkBggUsername, linkPlayer } from '../services/players.js';
import { getUnratedGamesForPlayer } from '../services/ratings.js';

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

  // Games this player still has to rate — drives the `/ratemany` walkthrough.
  // `:id` may be a player id or a Discord user id.
  app.get(
    '/:id/unrated-games',
    { schema: { params: idParam, querystring: unratedGamesQuery, response: { 200: gameList } } },
    async (req) => {
      const games = await getUnratedGamesForPlayer(req.params.id, req.query.scope);
      return games.map(toGameDto);
    },
  );

  // `:id` may be a player id or a Discord user id (the bot passes the latter).
  app.post(
    '/:id/bgg-link',
    { schema: { params: idParam, body: bggLinkInput, response: { 200: playerDto } } },
    async (req) => toPlayerDto(await linkBggUsername(req.params.id, req.body.bggUsername)),
  );

  app.post(
    '/:id/bgg-import',
    { schema: { params: idParam, response: { 200: bggImportResult } } },
    async (req) => {
      const player = await prisma.player.findFirst({
        where: { OR: [{ id: req.params.id }, { discordUserId: req.params.id }] },
      });
      if (!player) throw notFound('player');
      if (!player.bggUsername) {
        throw badRequest('Link a BGG account first with `/linkbgg` before importing.');
      }
      return importCollection(player.bggUsername);
    },
  );
}
