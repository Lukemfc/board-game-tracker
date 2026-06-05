import {
  bggGameDetail,
  bggReconcileResult,
  bggSearchResults,
  createGameInput,
  gameDto,
  gameList,
  idParam,
  importBggGameInput,
  renameGameInput,
} from '@meeple/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { conflict, notFound } from '../errors.js';
import { toGameDto } from '../mappers.js';
import { prisma } from '../prisma.js';
import { getGameDetail, searchGames } from '../services/bgg.js';
import { reconcileGame } from '../services/bggReconcile.js';
import { findGameByIdOrName } from '../services/resolve.js';

const bggSearchQuery = z.object({ query: z.string().trim().min(1, 'query is required') });
const bggIdParam = z.object({ bggId: z.coerce.number().int().positive() });

export default async function gameRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { response: { 200: gameList } } }, async () => {
    const games = await prisma.game.findMany({ orderBy: { name: 'asc' } });
    return games.map(toGameDto);
  });

  // Search BGG for games to add. Results are cached upstream for 5 minutes.
  app.get(
    '/bgg-search',
    { schema: { querystring: bggSearchQuery, response: { 200: bggSearchResults } } },
    async (req) => searchGames(req.query.query),
  );

  // Full BGG details for a single game (used to pre-fill / enrich).
  app.get(
    '/bgg/:bggId',
    { schema: { params: bggIdParam, response: { 200: bggGameDetail } } },
    async (req) => getGameDetail(req.params.bggId),
  );

  // Pull a BGG game into the catalogue, reconciling against existing games so
  // we link rather than duplicate — and never overwrite a local name.
  app.post(
    '/import-bgg',
    { schema: { body: importBggGameInput, response: { 200: bggReconcileResult } } },
    async (req) => {
      const { bggId, linkToId, forceCreate } = req.body;
      const detail = await getGameDetail(bggId);
      const outcome = await prisma.$transaction((tx) =>
        reconcileGame(
          tx,
          {
            bggId: detail.bggId,
            name: detail.name,
            yearPublished: detail.yearPublished,
            minPlayers: detail.minPlayers,
            maxPlayers: detail.maxPlayers,
            thumbnail: detail.thumbnail,
            description: detail.description,
          },
          { linkToId, forceCreate },
        ),
      );
      return {
        action: outcome.action,
        game: outcome.game ? toGameDto(outcome.game) : null,
        candidate: outcome.candidate,
      };
    },
  );

  // Idempotent: upserts by name so `/addgame` is safe to call repeatedly.
  // `name` is the identity here and is never changed by BGG enrichment.
  app.post(
    '/',
    { schema: { body: createGameInput, response: { 200: gameDto, 201: gameDto } } },
    async (req, reply) => {
      const {
        name,
        bggId,
        bggName,
        bggThumbnail,
        description,
        yearPublished,
        minPlayers,
        maxPlayers,
      } = req.body;
      const existing = await prisma.game.findUnique({ where: { name } });
      const game = await prisma.game.upsert({
        where: { name },
        update: {
          bggId,
          bggName,
          bggThumbnail,
          description,
          yearPublished,
          minPlayers,
          maxPlayers,
        },
        create: {
          name,
          bggId: bggId ?? null,
          bggName: bggName ?? null,
          bggThumbnail: bggThumbnail ?? null,
          description: description ?? null,
          yearPublished: yearPublished ?? null,
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

  // Rename a game to the group's preferred name. `:id` may be a game id or its
  // current name. Renaming never affects `bggId`/`bggName` enrichment.
  app.patch(
    '/:id',
    { schema: { params: idParam, body: renameGameInput, response: { 200: gameDto } } },
    async (req) => {
      const game = await findGameByIdOrName(prisma, req.params.id);
      if (!game) throw notFound('game');
      try {
        const updated = await prisma.game.update({
          where: { id: game.id },
          data: { name: req.body.name },
        });
        return toGameDto(updated);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw conflict(`A game named "${req.body.name}" already exists.`);
        }
        throw err;
      }
    },
  );
}
