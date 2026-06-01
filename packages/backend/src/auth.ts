import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Discord user id of the caller, forwarded by the bot via `x-discord-user-id`. */
    actingDiscordUserId?: string;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * onRequest hook: require `Authorization: Bearer <SERVICE_API_KEY>` and capture
 * the acting Discord user id (if forwarded) for handlers to resolve the actor.
 */
export async function authHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization ?? '';
  const expected = `Bearer ${config.SERVICE_API_KEY}`;
  if (!safeEqual(header, expected)) {
    await reply
      .status(401)
      .send({ error: 'unauthorized', message: 'Missing or invalid service token' });
    return;
  }

  const discordUserId = req.headers['x-discord-user-id'];
  req.actingDiscordUserId = typeof discordUserId === 'string' ? discordUserId : undefined;
}
