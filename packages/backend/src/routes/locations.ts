import { createLocationInput, locationDto, locationList } from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { toLocationDto } from '../mappers.js';
import { prisma } from '../prisma.js';

export default async function locationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { response: { 200: locationList } } }, async () => {
    const locations = await prisma.location.findMany({ orderBy: { name: 'asc' } });
    return locations.map(toLocationDto);
  });

  app.post(
    '/',
    { schema: { body: createLocationInput, response: { 200: locationDto, 201: locationDto } } },
    async (req, reply) => {
      const { name } = req.body;
      const existing = await prisma.location.findUnique({ where: { name } });
      const location = await prisma.location.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      return reply.status(existing ? 200 : 201).send(toLocationDto(location));
    },
  );
}
