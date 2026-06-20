import type {
  BggImportResult,
  GameDto,
  GameRatings,
  LeaderboardEntry,
  PlayerStats,
  SessionDto,
  Suggestion,
} from '@meeple/shared';
import { EmbedBuilder } from 'discord.js';

const COLOR = 0x4caf50;

const day = (iso: string) => iso.slice(0, 10);

/** Render a 1–5 value as filled/empty stars, e.g. 4 → "★★★★☆". */
export const stars = (value: number) => '★'.repeat(value) + '☆'.repeat(5 - value);

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

/** "👑 Alice, Bob" for a session's winners, or a "no winner" note when none. */
function winnersLabel(s: SessionDto): string {
  const winners = s.players.filter((p) => p.isWinner).map((p) => p.player.displayName);
  return winners.length ? `👑 ${winners.join(', ')}` : '_(no winner recorded)_';
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

/**
 * A single game's full play history — a chronological log of date · winner lines.
 * The game name lives in the title (not each line, where it'd be redundant).
 */
export function gameHistoryEmbed(game: string, sessions: SessionDto[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR);
  if (sessions.length === 0) {
    return embed
      .setTitle(`🎲 ${game}`)
      .setDescription(`No plays of **${game}** logged yet.`);
  }

  // Prefer the catalogue name from the data — the user's input may be an id or oddly-cased.
  const name = sessions[0]?.game.name ?? game;
  embed.setTitle(`🎲 ${name} — ${sessions.length} play${sessions.length === 1 ? '' : 's'}`);

  const lines = sessions.map((s) => `**${day(s.playedOn)}** · ${winnersLabel(s)}`);

  // Guard Discord's 4096-char description limit: truncate and note the remainder.
  const LIMIT = 4096;
  let description = lines.join('\n');
  if (description.length > LIMIT) {
    const kept: string[] = [];
    let length = 0;
    for (const line of lines) {
      const footer = `\n…and ${sessions.length - kept.length} earlier plays`;
      if (length + line.length + 1 + footer.length > LIMIT) break;
      kept.push(line);
      length += line.length + 1;
    }
    description = `${kept.join('\n')}\n…and ${sessions.length - kept.length} earlier plays`;
  }
  return embed.setDescription(description);
}

/** A single game's details — used after adding/enriching via BGG. */
export function gameEmbed(game: GameDto, title = `🎲 ${game.name}`): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(title);

  if (game.bggThumbnail) embed.setThumbnail(game.bggThumbnail);
  if (game.description) embed.setDescription(game.description);

  const players =
    game.minPlayers != null && game.maxPlayers != null
      ? game.minPlayers === game.maxPlayers
        ? `${game.minPlayers}`
        : `${game.minPlayers}–${game.maxPlayers}`
      : (game.minPlayers ?? game.maxPlayers)?.toString();
  if (players) embed.addFields({ name: 'Players', value: players, inline: true });
  if (game.yearPublished) {
    embed.addFields({ name: 'Year', value: String(game.yearPublished), inline: true });
  }
  if (game.bggId) {
    embed.addFields({
      name: 'BGG',
      value: `[View on BGG](https://boardgamegeek.com/boardgame/${game.bggId})`,
      inline: true,
    });
  }
  return embed;
}

export function gamesEmbed(games: GameDto[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🎲 Game catalogue');
  if (games.length === 0) {
    return embed.setDescription('No games yet. Add one with `/addgame`.');
  }
  return embed.setDescription(games.map((g) => `• ${g.name}`).join('\n'));
}

export function bggImportEmbed(result: BggImportResult): EmbedBuilder {
  const total = result.created + result.linked + result.enriched;
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('📦 BGG collection imported')
    .setDescription(
      `Processed **${total}** game${total === 1 ? '' : 's'} — ` +
        `${result.created} new, ${result.linked} linked to existing, ${result.enriched} enriched.`,
    );

  if (result.created > 0) {
    embed.addFields({
      name: '✏️ New games use their BGG name',
      value:
        `The ${result.created} new game${result.created === 1 ? '' : 's'} came in with BoardGameGeek's name. ` +
        "Use `/renamegame` to switch any to your group's simpler name.",
    });
  }

  if (result.needsReview.length > 0) {
    const list = result.needsReview
      .slice(0, 10)
      .map((r) => `• ${r.bggName} — looks like **${r.candidateName}**`)
      .join('\n');
    const more =
      result.needsReview.length > 10 ? `\n…and ${result.needsReview.length - 10} more.` : '';
    embed.addFields({
      name: `⚠️ ${result.needsReview.length} need review (left untouched)`,
      value: `${list}${more}\nUse \`/addgame\` to link these manually — existing names were not changed.`,
    });
  }
  return embed;
}

export function playersEmbed(
  players: { displayName: string; realName: string | null; discordUserId: string | null }[],
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🧑‍🤝‍🧑 Players');
  if (players.length === 0) {
    return embed.setDescription('No players yet.');
  }
  return embed.setDescription(
    players
      .map((p) => {
        const flag = !p.discordUserId
          ? ' _(no Discord link)_'
          : p.realName
            ? ''
            : ' _(no real name — use `/linkme`)_';
        return `• ${p.displayName}${flag}`;
      })
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

/**
 * A game's enjoyment ratings: group average plus a per-player breakdown.
 * `notRated` lists roster members who haven't rated it yet.
 */
export function gameRatingsEmbed(
  gameName: string,
  ratings: GameRatings,
  notRated: string[],
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLOR);

  if (ratings.count === 0) {
    return embed
      .setTitle(`⭐ ${gameName}`)
      .setDescription(`No ratings yet for **${gameName}**. Be the first with \`/rate\`.`);
  }

  const avg = (ratings.average ?? 0).toFixed(1);
  embed.setTitle(`⭐ ${gameName} — ${avg}★ avg`);

  const pad = Math.max(...ratings.perPlayer.map((r) => r.player.displayName.length));
  const lines = ratings.perPlayer.map(
    (r) => `\`${r.player.displayName.padEnd(pad)}\`  ${stars(r.value)}  (${r.value})`,
  );
  embed.setDescription(lines.join('\n'));

  embed.setFooter({
    text: `${ratings.count} rating${ratings.count === 1 ? '' : 's'}`,
  });
  if (notRated.length > 0) {
    embed.addFields({ name: 'Not yet rated', value: notRated.join(', ') });
  }
  return embed;
}

/** One step of the `/ratemany` walkthrough: the game to rate plus progress. */
export function rateManyEmbed(
  game: GameDto,
  index: number,
  total: number,
  rated: number,
  skipped: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('⭐ Quick rate')
    .setDescription(`How much do you enjoy **${game.name}**?\nTap a star, or skip it.`)
    .setFooter({ text: `Game ${index + 1} of ${total} · ${rated} rated · ${skipped} skipped` });
  if (game.bggThumbnail) embed.setThumbnail(game.bggThumbnail);
  return embed;
}

/** Tonight's `/suggest` picks — numbered, each with its one-line reasons. */
export function suggestionsEmbed(
  suggestions: Suggestion[],
  opts: { playerCount?: number; afterName?: string } = {},
): EmbedBuilder {
  const who = opts.playerCount
    ? ` (${opts.playerCount} player${opts.playerCount === 1 ? '' : 's'})`
    : '';
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(`🎲 Tonight's suggestions${who}`);

  const lines = suggestions.map(
    (s, i) => `**${i + 1}. ${s.game.name}**\n→ ${s.reasons.join(' • ')}`,
  );
  embed.setDescription(`${lines.join('\n\n')}\n\nReact with 🎲 on the one you want to play!`);

  const thumbnail = suggestions[0]?.game.bggThumbnail;
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (opts.afterName) embed.setFooter({ text: `Paired with what follows ${opts.afterName}.` });
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
