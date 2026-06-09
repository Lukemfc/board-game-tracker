import type { GameStats, Leaderboard, PlayerStats } from '@meeple/shared';
import { sessionInclude } from '../db.js';
import { notFound } from '../errors.js';
import { toGameDto, toPlayerDto, toSessionDto } from '../mappers.js';
import { prisma } from '../prisma.js';
import { findGameByIdOrName, findPlayerByIdOrDiscord } from './resolve.js';

const winRate = (wins: number, plays: number) => (plays > 0 ? wins / plays : 0);

export async function getLeaderboard(limit: number): Promise<Leaderboard> {
  const [plays, wins] = await Promise.all([
    prisma.sessionPlayer.groupBy({ by: ['playerId'], _count: { _all: true } }),
    prisma.sessionPlayer.groupBy({
      by: ['playerId'],
      where: { isWinner: true },
      _count: { _all: true },
    }),
  ]);

  const winMap = new Map(wins.map((w) => [w.playerId, w._count._all]));
  const players = await prisma.player.findMany({
    where: { id: { in: plays.map((p) => p.playerId) } },
  });
  const playerMap = new Map(players.map((p) => [p.id, p]));

  const entries = plays.flatMap((p) => {
    const player = playerMap.get(p.playerId);
    if (!player) return [];
    const playCount = p._count._all;
    const winCount = winMap.get(p.playerId) ?? 0;
    return [
      {
        player: toPlayerDto(player),
        plays: playCount,
        wins: winCount,
        winRate: winRate(winCount, playCount),
      },
    ];
  });

  entries.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.plays - a.plays);
  return entries.slice(0, limit);
}

export async function getPlayerStats(idOrDiscordId: string): Promise<PlayerStats> {
  const player = await findPlayerByIdOrDiscord(prisma, idOrDiscordId);
  if (!player) throw notFound('player');

  const participations = await prisma.sessionPlayer.findMany({
    where: { playerId: player.id },
    include: { session: { include: sessionInclude } },
  });

  const plays = participations.length;
  const wins = participations.filter((p) => p.isWinner).length;

  // Aggregate by game.
  const byGameMap = new Map<
    string,
    { game: (typeof participations)[number]['session']['game']; plays: number; wins: number }
  >();
  for (const p of participations) {
    const g = p.session.game;
    const entry = byGameMap.get(g.id) ?? { game: g, plays: 0, wins: 0 };
    entry.plays += 1;
    if (p.isWinner) entry.wins += 1;
    byGameMap.set(g.id, entry);
  }
  const byGame = [...byGameMap.values()]
    .map((e) => ({ game: toGameDto(e.game), plays: e.plays, wins: e.wins }))
    .sort(
      (a, b) =>
        b.wins - a.wins || // most wins first
        winRate(b.wins, b.plays) - winRate(a.wins, a.plays) || // then better win rate
        b.plays - a.plays || // then more plays
        a.game.name.localeCompare(b.game.name), // then alphabetical
    );

  const recent = participations
    .map((p) => p.session)
    .sort((a, b) => b.playedOn.getTime() - a.playedOn.getTime())
    .slice(0, 5)
    .map(toSessionDto);

  return {
    player: toPlayerDto(player),
    plays,
    wins,
    winRate: winRate(wins, plays),
    byGame,
    recent,
  };
}

export async function getGameStats(idOrName: string): Promise<GameStats> {
  const game = await findGameByIdOrName(prisma, idOrName);
  if (!game) throw notFound('game');

  const sessions = await prisma.session.findMany({
    where: { gameId: game.id },
    include: { players: { include: { player: true } } },
  });

  const winCounts = new Map<
    string,
    { player: (typeof sessions)[number]['players'][number]['player']; wins: number }
  >();
  for (const session of sessions) {
    for (const sp of session.players) {
      if (!sp.isWinner) continue;
      const entry = winCounts.get(sp.playerId) ?? { player: sp.player, wins: 0 };
      entry.wins += 1;
      winCounts.set(sp.playerId, entry);
    }
  }

  let topWinner: GameStats['topWinner'] = null;
  for (const entry of winCounts.values()) {
    if (!topWinner || entry.wins > topWinner.wins) {
      topWinner = { player: toPlayerDto(entry.player), wins: entry.wins };
    }
  }

  const lastPlayedOn = sessions.reduce<Date | null>((latest, s) => {
    return !latest || s.playedOn > latest ? s.playedOn : latest;
  }, null);

  return {
    game: toGameDto(game),
    plays: sessions.length,
    topWinner,
    lastPlayedOn: lastPlayedOn ? lastPlayedOn.toISOString() : null,
  };
}
