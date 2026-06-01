import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { TEST_SERVICE_API_KEY } from './constants';

export function authHeaders(discordUserId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${TEST_SERVICE_API_KEY}`,
    ...(discordUserId ? { 'x-discord-user-id': discordUserId } : {}),
  };
}

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "SessionPlayer", "Session", "Player", "Game", "Location" RESTART IDENTITY CASCADE;',
  );
}

let app: FastifyInstance | undefined;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = buildApp();
    await app.ready();
  }
  return app;
}

export async function teardown(): Promise<void> {
  if (app) {
    await app.close();
    app = undefined;
  }
  await prisma.$disconnect();
}
