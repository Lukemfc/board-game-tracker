import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma.js';
import { reconcileGame, type BggReconcileInput } from '../src/services/bggReconcile.js';
import { resetDb, teardown } from './helpers';

afterAll(teardown);
beforeEach(resetDb);

const detail = (over: Partial<BggReconcileInput> = {}): BggReconcileInput => ({
  bggId: 13,
  name: 'CATAN',
  yearPublished: 1995,
  minPlayers: 3,
  maxPlayers: 4,
  thumbnail: 'https://example.com/catan.png',
  description: 'Trade, build, settle.',
  ...over,
});

const run = (d: BggReconcileInput, opts = {}) =>
  prisma.$transaction((tx) => reconcileGame(tx, d, opts));

describe('reconcileGame', () => {
  it('links a manually-added game instead of duplicating, keeping its local name', async () => {
    await prisma.game.create({ data: { name: 'Catan' } });

    const outcome = await run(detail());

    expect(outcome.action).toBe('linked');
    expect(outcome.game?.name).toBe('Catan'); // group's name preserved
    expect(outcome.game?.bggId).toBe(13);
    expect(outcome.game?.bggName).toBe('CATAN');
    expect(outcome.game?.bggThumbnail).toBe('https://example.com/catan.png');
    expect(await prisma.game.count()).toBe(1);
  });

  it('enriches by bggId match without ever touching the name', async () => {
    await prisma.game.create({ data: { name: 'Catan', bggId: 13 } });

    const outcome = await run(detail({ name: 'CATAN — Base Game' }));

    expect(outcome.action).toBe('enriched');
    expect(outcome.game?.name).toBe('Catan');
    expect(outcome.game?.yearPublished).toBe(1995);
    expect(await prisma.game.count()).toBe(1);
  });

  it('does not auto-link an ambiguous match — leaves it untouched for review', async () => {
    const existing = await prisma.game.create({ data: { name: 'Splendor' } });

    const outcome = await run(detail({ bggId: 999, name: 'Splendid' }));

    expect(outcome.action).toBe('ambiguous');
    expect(outcome.candidate?.name).toBe('Splendor');
    // Nothing changed on the existing game.
    const after = await prisma.game.findUnique({ where: { id: existing.id } });
    expect(after?.bggId).toBeNull();
    expect(await prisma.game.count()).toBe(1);
  });

  it('creates a new game when nothing matches', async () => {
    const outcome = await run(detail({ bggId: 266192, name: 'Wingspan', yearPublished: 2019 }));

    expect(outcome.action).toBe('created');
    expect(outcome.game?.name).toBe('Wingspan');
    expect(outcome.game?.bggId).toBe(266192);
    expect(outcome.game?.bggName).toBe('Wingspan');
  });

  it('honours an explicit linkToId override', async () => {
    const a = await prisma.game.create({ data: { name: 'Our House Catan' } });

    const outcome = await run(detail(), { linkToId: a.id });

    expect(outcome.action).toBe('linked');
    expect(outcome.game?.id).toBe(a.id);
    expect(outcome.game?.name).toBe('Our House Catan');
    expect(outcome.game?.bggId).toBe(13);
  });
});
