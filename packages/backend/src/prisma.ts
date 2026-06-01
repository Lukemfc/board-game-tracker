import { PrismaClient } from '@prisma/client';
import { isProduction } from './config.js';

export const prisma = new PrismaClient({
  log: isProduction ? ['error'] : ['warn', 'error'],
});

export type PrismaClientLike = typeof prisma;

/** A Prisma transaction client (subset of the full client). */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
