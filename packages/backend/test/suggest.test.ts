import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerDto, SuggestResponse } from '@meeple/shared';
import { getSuggestions } from '../src/services/suggest.js';
import { authHeaders, getApp, resetDb, teardown } from './helpers';

afterAll(teardown);
beforeEach(resetDb);

/** YYYY-MM-DD for `n` days before now — keeps the seeds relative to "today". */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function logSession(
  game: string,
  playedOn: string,
  players: { name: string; isWinner?: boolean }[],
): Promise<void> {
  const app = await getApp();
  const res = await app.inject({
    method: 'POST',
    url: '/sessions',
    headers: authHeaders(),
    payload: { game, playedOn, players },
  });
  expect(res.statusCode).toBe(201);
}

async function addGame(payload: Record<string, unknown>): Promise<void> {
  const app = await getApp();
  const res = await app.inject({ method: 'POST', url: '/games', headers: authHeaders(), payload });
  expect(res.statusCode).toBe(201);
}

async function rateGame(game: string, discordUserId: string, value: number): Promise<void> {
  const app = await getApp();
  const res = await app.inject({
    method: 'PUT',
    url: `/games/${encodeURIComponent(game)}/ratings`,
    headers: authHeaders(),
    payload: { discordUserId, name: discordUserId, value },
  });
  expect(res.statusCode).toBe(200);
}

async function suggest(query: Record<string, string>): Promise<SuggestResponse> {
  const app = await getApp();
  const res = await app.inject({
    method: 'GET',
    url: '/stats/suggest',
    headers: authHeaders(),
    query,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as SuggestResponse;
}

async function listPlayers(): Promise<PlayerDto[]> {
  const app = await getApp();
  return (await app.inject({ method: 'GET', url: '/players', headers: authHeaders() })).json();
}

const names = (r: SuggestResponse) => r.suggestions.map((s) => s.game.name);

describe('GET /stats/suggest', () => {
  it('returns all games (with at least one reason each) when fewer exist than the limit', async () => {
    await addGame({ name: 'Catan' });
    await addGame({ name: 'Wingspan' });

    const result = await suggest({});
    expect(result.suggestions).toHaveLength(2);
    for (const s of result.suggestions) {
      expect(s.reasons.length).toBeGreaterThanOrEqual(1);
      expect(s.reasons).toContain('Never played');
    }
  });

  it('respects the limit parameter', async () => {
    await addGame({ name: 'Catan' });
    await addGame({ name: 'Wingspan' });
    await addGame({ name: 'Azul' });

    const result = await suggest({ limit: '1' });
    expect(result.suggestions).toHaveLength(1);
  });

  it('filters by player count using minPlayers/maxPlayers, keeping unbounded games', async () => {
    await addGame({ name: 'Big Box', minPlayers: 3, maxPlayers: 5 });
    await addGame({ name: 'Duel', minPlayers: 2, maxPlayers: 2 });
    await addGame({ name: 'No Limits' });

    const result = await suggest({ playerCount: '2' });
    expect(names(result).sort()).toEqual(['Duel', 'No Limits']);
  });

  it('returns an empty list when no games fit the player count', async () => {
    await addGame({ name: 'Big Box', minPlayers: 4 });
    const result = await suggest({ playerCount: '2' });
    expect(result.suggestions).toEqual([]);
  });

  it('ranks a frequently-chosen game above an equally-neglected rarely-chosen one (affinity)', async () => {
    // Both last played 30 days ago, both ≥3 plays (no variety bonus); the
    // favourite has been freely chosen far more often, and recently.
    for (const d of [30, 35, 40, 45, 50])
      await logSession('Favourite', daysAgo(d), [{ name: 'Alice' }]);
    for (const d of [30, 350, 360]) await logSession('Wallflower', daysAgo(d), [{ name: 'Alice' }]);

    const result = await suggest({});
    expect(names(result)).toEqual(['Favourite', 'Wallflower']);

    const favourite = result.suggestions[0]!;
    expect(favourite.reasons).toContain('One of your favourites — 5 plays');
  });

  it('keeps exploration alive: a never-played game outranks a recent favourite', async () => {
    for (const d of [1, 5, 10, 15])
      await logSession('Daily Driver', daysAgo(d), [{ name: 'Alice' }]);
    await addGame({ name: 'New Box' });

    const result = await suggest({});
    expect(names(result)[0]).toBe('New Box');
  });

  it('does not re-suggest a favourite played yesterday (multiplier scales recency)', async () => {
    // Beloved and heavily played — but played yesterday, so barely due.
    for (const d of [1, 8, 15, 22]) await logSession('Beloved', daysAgo(d), [{ name: 'Alice' }]);
    await rateGame('Beloved', 'd-alice', 5);
    // So-so game, genuinely due.
    for (const d of [100, 110, 120]) await logSession('Due Game', daysAgo(d), [{ name: 'Alice' }]);

    const result = await getSuggestions({ limit: 5 }, { affinity: 0.5, rating: 0.5, pairing: 25 });
    expect(result.suggestions.map((s) => s.game.name)).toEqual(['Due Game', 'Beloved']);
  });

  it('scopes affinity and the never-won bonus to playerIds', async () => {
    // Charlie hammers his solo game; Alice & Bob have their own favourite.
    for (const d of [10, 12, 14, 16, 18])
      await logSession('Solo Grind', daysAgo(d), [{ name: 'Charlie' }]);
    for (const d of [20, 25, 30, 35]) {
      await logSession('Group Fav', daysAgo(d), [
        { name: 'Alice' },
        { name: 'Bob', isWinner: true },
      ]);
    }
    await addGame({ name: 'Crowd Pleaser', minPlayers: 5 });

    const players = await listPlayers();
    const alice = players.find((p) => p.displayName === 'Alice')!;
    const bob = players.find((p) => p.displayName === 'Bob')!;

    const result = await suggest({ playerIds: `${alice.id},${bob.id}` });

    // playerCount falls back to playerIds length (2), so the 5+ game is filtered out.
    expect(names(result)).not.toContain('Crowd Pleaser');

    // Group Fav is the favourite *for this group*; Charlie's grinding doesn't count.
    const groupFav = result.suggestions.find((s) => s.game.name === 'Group Fav')!;
    expect(groupFav.reasons).toContain('One of your favourites — 4 plays');
    const solo = result.suggestions.find((s) => s.game.name === 'Solo Grind')!;
    expect(solo.reasons.join(' ')).not.toContain('favourites');
    // Alice has never won Solo Grind (never even played it) — fairness surfaces it.
    expect(solo.reasons).toContain('Alice has never won this');
  });

  it('boosts highly-rated and suppresses low-rated games when the rating knob is on', async () => {
    // Identical play history for all three games.
    for (const game of ['Loved', 'Meh Unrated', 'Hated']) {
      for (const d of [60, 90, 120]) await logSession(game, daysAgo(d), [{ name: 'Alice' }]);
    }
    await rateGame('Loved', 'd-alice', 5);
    await rateGame('Hated', 'd-alice', 1);

    const blended = await getSuggestions({ limit: 5 }, { affinity: 0.5, rating: 0.5, pairing: 25 });
    expect(blended.suggestions.map((s) => s.game.name)).toEqual(['Loved', 'Meh Unrated', 'Hated']);

    const loved = blended.suggestions[0]!;
    expect(loved.reasons).toContain('Highly rated by the group (5.0★)');

    // The unrated game sits exactly between: rating term contributes 0.
    const [top, mid, bottom] = blended.suggestions;
    expect(mid!.score).toBeLessThan(top!.score);
    expect(bottom!.score).toBeLessThan(mid!.score);
  });

  it('reproduces affinity-only suggestions with RATING_WEIGHT = 0', async () => {
    for (const game of ['Loved', 'Meh Unrated', 'Hated']) {
      for (const d of [60, 90, 120]) await logSession(game, daysAgo(d), [{ name: 'Alice' }]);
    }
    await rateGame('Loved', 'd-alice', 5);
    await rateGame('Hated', 'd-alice', 1);

    const affinityOnly = await getSuggestions(
      { limit: 5 },
      { affinity: 0.5, rating: 0, pairing: 25 },
    );
    // Ratings contribute nothing: identical histories ⇒ identical scores.
    const scores = affinityOnly.suggestions
      .filter((s) => ['Loved', 'Meh Unrated', 'Hated'].includes(s.game.name))
      .map((s) => s.score);
    expect(new Set(scores).size).toBe(1);
    // And no rating-based reason is shown for a signal that didn't contribute.
    for (const s of affinityOnly.suggestions) {
      expect(s.reasons.join(' ')).not.toContain('Highly rated');
    }
  });

  it('scopes ratings to playerIds', async () => {
    for (const d of [60, 90]) {
      await logSession('Marmite', daysAgo(d), [{ name: 'Alice' }, { name: 'Charlie' }]);
    }
    const players = await listPlayers();
    const alice = players.find((p) => p.displayName === 'Alice')!;
    const charlie = players.find((p) => p.displayName === 'Charlie')!;

    const app = await getApp();
    await app.inject({
      method: 'PUT',
      url: '/games/Marmite/ratings',
      headers: authHeaders(),
      payload: { playerId: charlie.id, value: 5 },
    });

    // Only Charlie rated it; scoped to Alice the game is unrated → no rating reason.
    const scoped = await getSuggestions(
      { playerIds: alice.id, limit: 5 },
      { affinity: 0.5, rating: 0.5, pairing: 25 },
    );
    const marmite = scoped.suggestions.find((s) => s.game.name === 'Marmite')!;
    expect(marmite.reasons.join(' ')).not.toContain('Highly rated');
  });

  it('applies the pairing bonus only with an anchor and ≥3 observed transitions', async () => {
    // Alternating nights: Wingspan → Cascadia three times over.
    const order = ['Wingspan', 'Cascadia', 'Wingspan', 'Cascadia', 'Wingspan', 'Cascadia'];
    for (let i = 0; i < order.length; i++) {
      await logSession(order[i]!, daysAgo(60 - i * 7), [{ name: 'Alice' }]);
    }
    await addGame({ name: 'Azul' });

    const app = await getApp();
    const games = (
      await app.inject({ method: 'GET', url: '/games', headers: authHeaders() })
    ).json() as { id: string; name: string }[];
    const wingspan = games.find((g) => g.name === 'Wingspan')!;
    const cascadia = games.find((g) => g.name === 'Cascadia')!;

    const withAnchor = await suggest({ afterGameId: wingspan.id });
    const cascadiaEntry = withAnchor.suggestions.find((s) => s.game.name === 'Cascadia')!;
    expect(cascadiaEntry.reasons).toContain('You often follow Wingspan with this');

    // Without an anchor the pairing signal never fires.
    const noAnchor = await suggest({});
    for (const s of noAnchor.suggestions) {
      expect(s.reasons.join(' ')).not.toContain('often follow');
    }

    // Fewer than 3 transitions out of the anchor → no bonus either.
    const fromCascadia = await suggest({ afterGameId: cascadia.id });
    for (const s of fromCascadia.suggestions) {
      expect(s.reasons.join(' ')).not.toContain('often follow');
    }
  });
});
