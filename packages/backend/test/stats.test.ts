import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameStats, LeaderboardEntry, PlayerStats } from '@meeple/shared';
import { authHeaders, getApp, resetDb, teardown } from './helpers';

afterAll(teardown);
beforeEach(resetDb);

async function seedPlays() {
  const app = await getApp();
  // Alice beats Bob at Catan.
  await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: authHeaders(),
    payload: {
      game: 'Catan',
      playedOn: '2026-05-01',
      players: [{ name: 'Alice', isWinner: true }, { name: 'Bob' }],
    },
  });
  // Alice beats Bob again at Wingspan.
  await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: authHeaders(),
    payload: {
      game: 'Wingspan',
      playedOn: '2026-05-08',
      players: [{ name: 'Alice', isWinner: true }, { name: 'Bob' }],
    },
  });
  // Bob wins one Catan.
  await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: authHeaders(),
    payload: {
      game: 'Catan',
      playedOn: '2026-05-15',
      players: [{ name: 'Alice' }, { name: 'Bob', isWinner: true }],
    },
  });
}

describe('stats', () => {
  it('leaderboard ranks by wins then win rate', async () => {
    const app = await getApp();
    await seedPlays();

    const res = await app.inject({
      method: 'GET',
      url: '/stats/leaderboard',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const board = res.json() as LeaderboardEntry[];
    expect(board).toHaveLength(2);

    const alice = board.find((e) => e.player.displayName === 'Alice')!;
    const bob = board.find((e) => e.player.displayName === 'Bob')!;
    expect(alice.plays).toBe(3);
    expect(alice.wins).toBe(2);
    expect(alice.winRate).toBeCloseTo(2 / 3);
    expect(bob.wins).toBe(1);
    // Alice has more wins, so she ranks first.
    expect(board[0]?.player.displayName).toBe('Alice');
  });

  it('per-player stats break down by game', async () => {
    const app = await getApp();
    await seedPlays();

    const players = (
      await app.inject({ method: 'GET', url: '/players', headers: authHeaders() })
    ).json() as { id: string; displayName: string }[];
    const alice = players.find((p) => p.displayName === 'Alice')!;

    const res = await app.inject({
      method: 'GET',
      url: `/stats/players/${alice.id}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json() as PlayerStats;
    expect(stats.plays).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.byGame.find((g) => g.game.name === 'Catan')?.plays).toBe(2);
    expect(stats.recent.length).toBeGreaterThan(0);

    // byGame is ordered by wins desc, then win rate. Alice won Catan (1/2) and
    // Wingspan (1/1) once each, so equal wins put the higher win rate first.
    expect(stats.byGame.map((g) => g.game.name)).toEqual(['Wingspan', 'Catan']);
  });

  it('per-game stats report plays and top winner', async () => {
    const app = await getApp();
    await seedPlays();

    const res = await app.inject({
      method: 'GET',
      url: '/stats/games/Catan',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json() as GameStats;
    expect(stats.game.name).toBe('Catan');
    expect(stats.plays).toBe(2);
    // Alice and Bob each won one Catan; topWinner has 1 win.
    expect(stats.topWinner?.wins).toBe(1);
    expect(stats.lastPlayedOn).not.toBeNull();
  });
});
