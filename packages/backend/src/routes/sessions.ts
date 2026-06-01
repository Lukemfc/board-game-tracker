import {
  createSessionInput,
  idParam,
  sessionDto,
  sessionList,
  sessionListQuery,
  updateSessionInput,
} from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { toSessionDto } from '../mappers.js';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from '../services/sessions.js';

export default async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/',
    { schema: { querystring: sessionListQuery, response: { 200: sessionList } } },
    async (req) => {
      const sessions = await listSessions(req.query);
      return sessions.map(toSessionDto);
    },
  );

  app.post(
    '/',
    { schema: { body: createSessionInput, response: { 201: sessionDto } } },
    async (req, reply) => {
      const session = await createSession(req.body, req.actingDiscordUserId);
      return reply.status(201).send(toSessionDto(session));
    },
  );

  app.get('/:id', { schema: { params: idParam, response: { 200: sessionDto } } }, async (req) => {
    return toSessionDto(await getSession(req.params.id));
  });

  app.patch(
    '/:id',
    { schema: { params: idParam, body: updateSessionInput, response: { 200: sessionDto } } },
    async (req) => {
      return toSessionDto(await updateSession(req.params.id, req.body));
    },
  );

  app.delete('/:id', { schema: { params: idParam } }, async (req, reply) => {
    await deleteSession(req.params.id);
    return reply.status(204).send();
  });
}
