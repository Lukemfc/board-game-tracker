import type { GameDto, LeaderboardEntry, PlayerStats, SessionDto } from '@meeple/shared';
import { EmbedBuilder } from 'discord.js';

const COLOR = 0x4caf50;

const day = (iso: string) => iso.slice(0, 10);

function playerLine(p: SessionDto['players'][number]): string {
  const crown = p.isWinner ? '👑 ' : '• ';
  const score = p.score != null ? ` (${p.score})` : '';
  return `${crown}${p.player.displayName}${score}`;
}

export function sessionEmbed(s: SessionDto): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🎲 ${s.game.name}`)
    .addFields({ name: 'Date', value: day(s.playedOn), inline: true });

  if (s.location) embed.addFields({ name: 'Where', value: s.location.name, inline: true });
  embed.addFields({ name: 'Players', value: s.players.map(playerLine).join('\n') || '—' });
  if (s.notes) embed.addFields({ name: 'Notes', value: s.notes });
  if (s.createdBy) embed.setFooter({ text: `Logged by ${s.createdBy.displayName}` });
  return embed;
}

export function recentEmbed(sessions: SessionDto[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🕑 Recent plays');
  if (sessions.length === 0) {
    return embed.setDescription('No plays logged yet. Use `/logplay` to add one!');
  }
  embed.setDescription(
    sessions
      .map((s) => {
        const winners = s.players.filter((p) => p.isWinner).map((p) => p.player.displayName);
        const won = winners.length ? ` — 👑 ${winners.join(', ')}` : '';
        return `**${day(s.playedOn)}** · ${s.game.name}${won}`;
      })
      .join('\n'),
  );
  return embed;
}

export function gamesEmbed(games: GameDto[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🎲 Game catalogue');
  if (games.length === 0) {
    return embed.setDescription('No games yet. Add one with `/addgame`.');
  }
  return embed.setDescription(games.map((g) => `• ${g.name}`).join('\n'));
}

export function playersEmbed(
  players: { displayName: string; discordUserId: string | null }[],
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🧑‍🤝‍🧑 Players');
  if (players.length === 0) {
    return embed.setDescription('No players yet.');
  }
  return embed.setDescription(
    players
      .map((p) => `• ${p.displayName}${p.discordUserId ? '' : ' _(no Discord link)_'}`)
      .join('\n'),
  );
}

export function leaderboardEmbed(entries: LeaderboardEntry[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🏆 Leaderboard');
  if (entries.length === 0) {
    return embed.setDescription('No plays logged yet.');
  }
  const medals = ['🥇', '🥈', '🥉'];
  embed.setDescription(
    entries
      .map((e, i) => {
        const rank = medals[i] ?? `${i + 1}.`;
        const pct = Math.round(e.winRate * 100);
        return `${rank} **${e.player.displayName}** — ${e.wins} win${e.wins === 1 ? '' : 's'} / ${e.plays} play${e.plays === 1 ? '' : 's'} (${pct}%)`;
      })
      .join('\n'),
  );
  return embed;
}

export function playerStatsEmbed(stats: PlayerStats): EmbedBuilder {
  const pct = Math.round(stats.winRate * 100);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`📊 ${stats.player.displayName}`)
    .addFields(
      { name: 'Plays', value: String(stats.plays), inline: true },
      { name: 'Wins', value: String(stats.wins), inline: true },
      { name: 'Win rate', value: `${pct}%`, inline: true },
    );

  if (stats.byGame.length > 0) {
    embed.addFields({
      name: 'By game',
      value: stats.byGame
        .slice(0, 10)
        .map((g) => `• ${g.game.name}: ${g.wins}/${g.plays}`)
        .join('\n'),
    });
  }
  return embed;
}
