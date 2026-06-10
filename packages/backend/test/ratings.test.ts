import type { GameRatings, UpsertRatingResult } from '@meeple/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeaders, getApp, resetDb, teardown } from './helpers';

afterAll(teardown);
beforeEach(resetDb);

async function addGame(name: string) {
  const app = await getApp();
  await app.inject({ method: 'POST', url: '/games', headers: authHeaders(), payload: { name } });
}

function rate(game: string, discordUserId: string, name: string, value: number) {
  return getApp().then((app) =>
    app.inject({
      method: 'PUT',
      url: `/games/${encodeURIComponent(game)}/ratings`,
      headers: authHeaders(discordUserId),
      payload: { discordUserId, name, value },
    }),
  );
}

describe('PUT /games/:id/ratings', () => {
  it('records a rating and returns the new group average', async () => {
    await addGame('Wingspan');

    const res = await rate('Wingspan', 'd-alice', 'Alice', 4);

    expect(res.statusCode).toBe(200);
    const body = res.json() as UpsertRatingResult;
    expect(body.rating.value).toBe(4);
    expect(body.rating.player.displayName).toBe('Alice');
    expect(body.average).toBe(4);
    expect(body.count).toBe(1);
  });

  it('overwrites an existing rating rather than duplicating it', async () => {
    await addGame('Wingspan');

    await rate('Wingspan', 'd-alice', 'Alice', 2);
    const res = await rate('Wingspan', 'd-alice', 'Alice', 5);

    const body = res.json() as UpsertRatingResult;
    expect(body.average).toBe(5);
    expect(body.count).toBe(1);
  });

  it('averages across multiple raters', async () => {
    await addGame('Wingspan');

    await rate('Wingspan', 'd-alice', 'Alice', 5);
    await rate('Wingspan', 'd-bob', 'Bob', 4);
    const res = await rate('Wingspan', 'd-carol', 'Carol', 3);

    const body = res.json() as UpsertRatingResult;
    expect(body.average).toBe(4);
    expect(body.count).toBe(3);
  });

  it('rejects a rating outside 1–5', async () => {
    await addGame('Wingspan');
    const res = await rate('Wingspan', 'd-alice', 'Alice', 6);
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown game', async () => {
    const res = await rate('Nonexistent', 'd-alice', 'Alice', 3);
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /games/:id/ratings', () => {
  it('returns the aggregate and per-player breakdown sorted high→low', async () => {
    await addGame('Wingspan');
    await rate('Wingspan', 'd-alice', 'Alice', 5);
    await rate('Wingspan', 'd-bob', 'Bob', 4);
    await rate('Wingspan', 'd-carol', 'Carol', 3);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/games/Wingspan/ratings',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as GameRatings;
    expect(body.average).toBeCloseTo(4);
    expect(body.count).toBe(3);
    expect(body.perPlayer.map((r) => r.value)).toEqual([5, 4, 3]);
    expect(body.perPlayer[0]?.player.displayName).toBe('Alice');
  });

  it('returns nulls for an unrated game', async () => {
    await addGame('Azul');
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/games/Azul/ratings',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as GameRatings;
    expect(body.average).toBeNull();
    expect(body.count).toBe(0);
    expect(body.perPlayer).toEqual([]);
  });

  it('404s for an unknown game', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/games/Nonexistent/ratings',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });
});
