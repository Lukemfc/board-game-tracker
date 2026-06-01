/**
 * Dev seed: a few players, games, a location, and one sample session.
 * Idempotent — safe to run repeatedly. Run with `pnpm --filter @meeple/backend seed`.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [alice, bob, carol] = await Promise.all([
    prisma.player.upsert({
      where: { discordUserId: 'seed-alice' },
      update: {},
      create: { displayName: 'Alice', discordUserId: 'seed-alice' },
    }),
    prisma.player.upsert({
      where: { discordUserId: 'seed-bob' },
      update: {},
      create: { displayName: 'Bob', discordUserId: 'seed-bob' },
    }),
    // A "ghost" player with no Discord account.
    prisma.player.upsert({
      where: { id: 'seed-carol-fixed-id' },
      update: {},
      create: { id: 'seed-carol-fixed-id', displayName: 'Carol' },
    }),
  ]);

  const [catan, wingspan] = await Promise.all([
    prisma.game.upsert({
      where: { name: 'Catan' },
      update: {},
      create: { name: 'Catan', minPlayers: 3, maxPlayers: 4 },
    }),
    prisma.game.upsert({
      where: { name: 'Wingspan' },
      update: {},
      create: { name: 'Wingspan', minPlayers: 1, maxPlayers: 5 },
    }),
  ]);

  const home = await prisma.location.upsert({
    where: { name: "Alice's place" },
    update: {},
    create: { name: "Alice's place" },
  });

  // Sample sessions (only created if none exist yet, to stay idempotent).
  const existing = await prisma.session.findFirst();
  if (!existing) {
    await prisma.session.create({
      data: {
        playedOn: new Date('2026-05-01'),
        gameId: catan.id,
        locationId: home.id,
        notes: 'Close game, decided on the last roll.',
        createdById: alice.id,
        players: {
          create: [
            { playerId: alice.id, isWinner: true, score: 10 },
            { playerId: bob.id, isWinner: false, score: 8 },
            { playerId: carol.id, isWinner: false, score: 7 },
          ],
        },
      },
    });
    await prisma.session.create({
      data: {
        playedOn: new Date('2026-05-15'),
        gameId: wingspan.id,
        locationId: home.id,
        createdById: bob.id,
        players: {
          create: [
            { playerId: bob.id, isWinner: true, score: 92 },
            { playerId: carol.id, isWinner: false, score: 85 },
          ],
        },
      },
    });
  }

  console.log('Seed complete: players, games, location, and a sample session.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
