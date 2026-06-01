import { healthResponse } from '@meeple/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export default async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/health', { schema: { response: { 200: healthResponse } } }, async () => ({
    status: 'ok' as const,
    uptime: process.uptime(),
  }));
}
