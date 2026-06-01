import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './prisma.js';

const app = buildApp();

async function start() {
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  app.log.info(`Received ${signal}, shutting down...`);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

void start();
