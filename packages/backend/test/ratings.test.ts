import type { GameDto, GameRatings, UpsertRatingResult } from '@meeple/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeaders, getApp, resetDb, teardown } from './helpers';

afterAll(teardown);
beforeEach(resetDb);

async function addGame(name: string) {
  const app = await getApp();
  await app.inject({ method: 'POST', url: '/games', headers: authHeaders(), payload: { name } });
}

async function logPlay(game: string, discordUserId: string, name: string) {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url: '/sessions',
    headers: authHeaders(discordUserId),
    payload: { game, players: [{ discordUserId, name }] },
  });
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

  it('resolves a free-typed name that differs only in punctuation', async () => {
    await addGame('Dune: Imperium – Uprising');
    await rate('Dune: Imperium – Uprising', 'd-alice', 'Alice', 5);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/games/${encodeURIComponent('Dune Imperium Uprising')}/ratings`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as GameRatings).average).toBe(5);
  });

  it('does not fuzzy-resolve when two games normalize identically', async () => {
    await addGame('Catan!');
    await addGame('CATAN?');

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/games/Catan/ratings',
      headers: authHeaders(),
    });

    // Ambiguous — refuse to guess.
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /players/:id/unrated-games', () => {
  it('returns played games the player has not yet rated (played scope)', async () => {
    await logPlay('Wingspan', 'd-alice', 'Alice');
    await logPlay('Azul', 'd-alice', 'Alice');
    await rate('Wingspan', 'd-alice', 'Alice', 4);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/players/d-alice/unrated-games',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const games = res.json() as GameDto[];
    expect(games.map((g) => g.name)).toEqual(['Azul']);
  });

  it('excludes games the player has not played (played scope)', async () => {
    await addGame('Catan'); // in catalogue, never played by Alice
    await logPlay('Wingspan', 'd-alice', 'Alice');

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/players/d-alice/unrated-games',
      headers: authHeaders(),
    });

    const games = res.json() as GameDto[];
    expect(games.map((g) => g.name)).toEqual(['Wingspan']);
  });

  it('returns the whole unrated catalogue with scope=all', async () => {
    await addGame('Catan');
    await logPlay('Wingspan', 'd-alice', 'Alice');
    await rate('Wingspan', 'd-alice', 'Alice', 5);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/players/d-alice/unrated-games?scope=all',
      headers: authHeaders(),
    });

    const games = res.json() as GameDto[];
    // Catan (never played) included; Wingspan excluded because already rated.
    expect(games.map((g) => g.name)).toEqual(['Catan']);
  });

  it('404s for an unknown player', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/players/nobody/unrated-games',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });
});
