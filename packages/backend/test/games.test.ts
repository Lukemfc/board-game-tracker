import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameDto } from '@meeple/shared';
import { authHeaders, getApp, resetDb, teardown } from './helpers';

afterAll(teardown);
beforeEach(resetDb);

async function addGame(name: string) {
  const app = await getApp();
  return app.inject({ method: 'POST', url: '/games', headers: authHeaders(), payload: { name } });
}

describe('PATCH /games/:id (rename)', () => {
  it('renames a game by its current name', async () => {
    const app = await getApp();
    await addGame('CATAN');

    const res = await app.inject({
      method: 'PATCH',
      url: '/games/CATAN',
      headers: authHeaders(),
      payload: { name: 'Catan' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as GameDto).name).toBe('Catan');
  });

  it('rejects a rename that collides with another game', async () => {
    const app = await getApp();
    await addGame('Catan');
    await addGame('Wingspan');

    const res = await app.inject({
      method: 'PATCH',
      url: '/games/Wingspan',
      headers: authHeaders(),
      payload: { name: 'Catan' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('404s when the game does not exist', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/games/Nonexistent',
      headers: authHeaders(),
      payload: { name: 'Whatever' },
    });

    expect(res.statusCode).toBe(404);
  });
});
