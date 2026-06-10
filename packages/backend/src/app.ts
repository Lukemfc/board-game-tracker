import cors from '@fastify/cors';
import { Prisma } from '@prisma/client';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { authHook } from './auth.js';
import { config } from './config.js';
import { HttpError } from './errors.js';
import gameRoutes from './routes/games.js';
import healthRoutes from './routes/health.js';
import locationRoutes from './routes/locations.js';
import playerRoutes from './routes/players.js';
import ratingRoutes from './routes/ratings.js';
import sessionRoutes from './routes/sessions.js';
import statsRoutes from './routes/stats.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, { origin: true });

  // Service-token auth on every route except the health check.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (path === '/health') return;
    return authHook(req, reply);
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Request validation failed',
        details: error.validation,
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: error.errorCode,
        message: error.message,
        details: error.details,
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.status(409).send({ error: 'conflict', message: 'Resource already exists' });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({ error: 'not_found', message: 'Resource not found' });
      }
    }
    req.log.error(error);
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    return reply.status(status >= 500 ? 500 : status).send({
      error: 'internal_error',
      message: status >= 500 ? 'Internal server error' : error.message,
    });
  });

  app.register(healthRoutes);
  app.register(playerRoutes, { prefix: '/players' });
  app.register(gameRoutes, { prefix: '/games' });
  app.register(ratingRoutes, { prefix: '/games' });
  app.register(locationRoutes, { prefix: '/locations' });
  app.register(sessionRoutes, { prefix: '/sessions' });
  app.register(statsRoutes, { prefix: '/stats' });

  return app;
}
