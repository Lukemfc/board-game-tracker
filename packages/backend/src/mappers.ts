import type { GameDto, LocationDto, PlayerDto, SessionDto } from '@meeple/shared';
import type { GameRecord, LocationRecord, PlayerRecord, SessionWithRelations } from './db.js';

export const toPlayerDto = (p: PlayerRecord): PlayerDto => ({
  id: p.id,
  displayName: p.displayName,
  discordUserId: p.discordUserId,
  bggUsername: p.bggUsername,
  createdAt: p.createdAt.toISOString(),
});

export const toGameDto = (g: GameRecord): GameDto => ({
  id: g.id,
  name: g.name,
  bggId: g.bggId,
  bggName: g.bggName,
  bggThumbnail: g.bggThumbnail,
  description: g.description,
  yearPublished: g.yearPublished,
  minPlayers: g.minPlayers,
  maxPlayers: g.maxPlayers,
  createdAt: g.createdAt.toISOString(),
});

export const toLocationDto = (l: LocationRecord): LocationDto => ({
  id: l.id,
  name: l.name,
});

export const toSessionDto = (s: SessionWithRelations): SessionDto => ({
  id: s.id,
  playedOn: s.playedOn.toISOString(),
  notes: s.notes,
  createdAt: s.createdAt.toISOString(),
  game: toGameDto(s.game),
  location: s.location ? toLocationDto(s.location) : null,
  createdBy: s.createdBy ? toPlayerDto(s.createdBy) : null,
  players: s.players
    .map((sp) => ({
      player: toPlayerDto(sp.player),
      isWinner: sp.isWinner,
      score: sp.score,
    }))
    // Winners first, then alphabetical — stable, friendly ordering for embeds.
    .sort(
      (a, b) =>
        Number(b.isWinner) - Number(a.isWinner) ||
        a.player.displayName.localeCompare(b.player.displayName),
    ),
});
