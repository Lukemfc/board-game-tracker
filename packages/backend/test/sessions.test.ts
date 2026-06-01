import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionDto } from '@meeple/shared';
import { authHeaders, getApp, resetDb, teardown } from './helpers';

afterAll(teardown);
beforeEach(resetDb);

async function createSampleSession(discordUserId?: string) {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url: '/sessions',
    headers: authHeaders(discordUserId),
    payload: {
      game: 'Catan',
      playedOn: '2026-05-01',
      location: "Alice's place",
      notes: 'good game',
      players: [
        { name: 'Alice', isWinner: true, score: 10 },
        { name: 'Bob', score: 8 },
        { name: 'Carol', score: 7 },
      ],
    },
  });
}

describe('POST /sessions', () => {
  it('creates a session, upserting game/location/players by name', async () => {
    const res = await createSampleSession('discord-actor-1');
    expect(res.statusCode).toBe(201);
    const session = res.json() as SessionDto;

    expect(session.game.name).toBe('Catan');
    expect(session.location?.name).toBe("Alice's place");
    expect(session.notes).toBe('good game');
    expect(session.players).toHaveLength(3);
    // Winners are sorted first by the mapper.
    expect(session.players[0]?.player.displayName).toBe('Alice');
    expect(session.players[0]?.isWinner).toBe(true);
    // The acting Discord user is recorded as creator.
    expect(session.createdBy?.discordUserId).toBe('discord-actor-1');
  });

  it('reuses existing game/players across sessions instead of duplicating', async () => {
    const app = await getApp();
    await createSampleSession();
    await createSampleSession();

    const games = (
      await app.inject({ method: 'GET', url: '/games', headers: authHeaders() })
    ).json();
    const players = (
      await app.inject({ method: 'GET', url: '/players', headers: authHeaders() })
    ).json();
    expect(games).toHaveLength(1);
    expect(players).toHaveLength(3);
  });

  it('rejects an empty players list with 400', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: authHeaders(),
      payload: { game: 'Catan', players: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('rejects a missing game with 400', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: authHeaders(),
      payload: { players: [{ name: 'Alice' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a player with neither name nor discordUserId', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: authHeaders(),
      payload: { game: 'Catan', players: [{ isWinner: true }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET/PATCH/DELETE /sessions', () => {
  it('lists, filters, fetches, edits and deletes', async () => {
    const app = await getApp();
    const created = (await createSampleSession()).json() as SessionDto;

    // list
    const list = await app.inject({ method: 'GET', url: '/sessions', headers: authHeaders() });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    // filter by player name match (no results for unknown)
    const filtered = await app.inject({
      method: 'GET',
      url: '/sessions?game=Catan',
      headers: authHeaders(),
    });
    expect(filtered.json()).toHaveLength(1);

    // get by id
    const got = await app.inject({
      method: 'GET',
      url: `/sessions/${created.id}`,
      headers: authHeaders(),
    });
    expect(got.statusCode).toBe(200);

    // patch notes
    const patched = await app.inject({
      method: 'PATCH',
      url: `/sessions/${created.id}`,
      headers: authHeaders(),
      payload: { notes: 'edited' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as SessionDto).notes).toBe('edited');

    // delete
    const del = await app.inject({
      method: 'DELETE',
      url: `/sessions/${created.id}`,
      headers: authHeaders(),
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/sessions/${created.id}`,
      headers: authHeaders(),
    });
    expect(after.statusCode).toBe(404);
  });

  it('returns 404 for an unknown session', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/sessions/does-not-exist',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });
});
