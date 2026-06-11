import type { SuggestQuery, SuggestResponse, Suggestion } from '@meeple/shared';
import type { PlayerRecord } from '../db.js';
import { toGameDto } from '../mappers.js';
import { prisma } from '../prisma.js';

/**
 * The `/suggest` scoring engine. Deterministic and transparent — every game in
 * the catalogue gets a score, the top N come back with human-readable reasons.
 * See docs/features/what-to-play-tonight.md for the full rationale.
 *
 *   score = recencyScore * preferenceMultiplier
 *         + varietyBonus + neverPlayedBonus + neverWonBonus + pairingBonus
 */

/** The three tunable knobs. Everything else in the algorithm stays put. */
export interface SuggestWeights {
  /** How much revealed habit (recency-weighted play count) matters. */
  affinity: number;
  /** How much stated enjoyment (1–5★ ratings) matters. */
  rating: number;
  /** How much sequencing ("what we play after what") matters. */
  pairing: number;
}

/**
 * Shipped defaults. Per the phasing plan in docs/features/game-ratings.md,
 * `rating` starts at 0 (affinity-only) until ratings have accumulated over a
 * few game nights — raise it to 0.5 to switch the blend on. No other change
 * needed.
 */
export const DEFAULT_WEIGHTS: SuggestWeights = { affinity: 0.5, rating: 0, pairing: 25 };

const MS_PER_DAY = 86_400_000;
/** Affinity of a play halves every ~6 months — "favourite" means *currently* beloved. */
const AFFINITY_HALF_LIFE_DAYS = 180;
/** Recency (due-ness) saturates at 6 months so ancient games don't dominate forever. */
const RECENCY_CAP_DAYS = 180;
/** Never-played games are treated as this stale. */
const NEVER_PLAYED_DAYS = 365;
const MULTIPLIER_MIN = 0.5;
const MULTIPLIER_MAX = 2.0;
/** Bonus for games played fewer than 3 times ever. */
const VARIETY_BONUS = 30;
const NEVER_PLAYED_BONUS = 50;
/** Per player who has never won the game, capped at 3 players' worth. */
const NEVER_WON_BONUS = 20;
const NEVER_WON_CAP = 60;
/** Minimum observed transitions out of the anchor before the pairing bonus fires. */
const MIN_PAIR_TRANSITIONS = 3;
/** `affinityNorm` at or above this counts as "one of your favourites" in reasons. */
const FAVOURITE_THRESHOLD = 0.75;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Per-game aggregates gathered in one pass over the session history. */
interface GameSignals {
  totalPlays: number;
  lastPlayedAt: Date | null;
  /** Sessions whose players are all members of the playing group. */
  groupPlays: number;
  /** Recency-weighted group play count — the revealed-preference measure. */
  affinity: number;
  /** Players (ids) who have ever won this game. */
  wonBy: Set<string>;
  /** Mean rating over the group's raters, or null if none have rated it. */
  groupRating: number | null;
}

export async function getSuggestions(
  query: SuggestQuery,
  weights: SuggestWeights = DEFAULT_WEIGHTS,
  now: Date = new Date(),
): Promise<SuggestResponse> {
  const requestedIds = query.playerIds
    ? query.playerIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  const [games, sessions, groupPlayers] = await Promise.all([
    prisma.game.findMany(),
    // Ordered timeline — drives recency, affinity, and the pairing transitions.
    prisma.session.findMany({
      orderBy: [{ playedOn: 'asc' }, { createdAt: 'asc' }],
      select: {
        gameId: true,
        playedOn: true,
        players: { select: { playerId: true, isWinner: true } },
      },
    }),
    requestedIds.length > 0
      ? prisma.player.findMany({ where: { id: { in: requestedIds } } })
      : Promise.resolve([] as PlayerRecord[]),
  ]);

  // Keep the caller's order — the never-won reason names the first who qualifies.
  const group = requestedIds
    .map((id) => groupPlayers.find((p) => p.id === id))
    .filter((p): p is PlayerRecord => p !== undefined);
  const groupIds = new Set(group.map((p) => p.id));

  const ratings = await prisma.rating.findMany({
    where: groupIds.size > 0 ? { playerId: { in: [...groupIds] } } : undefined,
    select: { gameId: true, value: true },
  });

  // --- Step 1: gather per-game signals -------------------------------------
  const signals = new Map<string, GameSignals>();
  const signalsFor = (gameId: string): GameSignals => {
    let s = signals.get(gameId);
    if (!s) {
      s = {
        totalPlays: 0,
        lastPlayedAt: null,
        groupPlays: 0,
        affinity: 0,
        wonBy: new Set(),
        groupRating: null,
      };
      signals.set(gameId, s);
    }
    return s;
  };

  for (const session of sessions) {
    const s = signalsFor(session.gameId);
    s.totalPlays += 1;
    if (!s.lastPlayedAt || session.playedOn > s.lastPlayedAt) s.lastPlayedAt = session.playedOn;
    for (const sp of session.players) {
      if (sp.isWinner) s.wonBy.add(sp.playerId);
    }
    // A session belongs to the group when everyone in it is a group member
    // (no group given = the whole roster, so every session counts).
    const isGroupSession =
      groupIds.size === 0 || session.players.every((sp) => groupIds.has(sp.playerId));
    if (isGroupSession) {
      s.groupPlays += 1;
      const daysAgo = Math.max(0, (now.getTime() - session.playedOn.getTime()) / MS_PER_DAY);
      s.affinity += 0.5 ** (daysAgo / AFFINITY_HALF_LIFE_DAYS);
    }
  }

  // Group rating: mean over the group's raters (ratings are pre-filtered).
  const ratingAgg = new Map<string, { sum: number; count: number }>();
  for (const r of ratings) {
    const agg = ratingAgg.get(r.gameId) ?? { sum: 0, count: 0 };
    agg.sum += r.value;
    agg.count += 1;
    ratingAgg.set(r.gameId, agg);
  }
  for (const [gameId, agg] of ratingAgg) {
    signalsFor(gameId).groupRating = agg.sum / agg.count;
  }

  // Pairing: how often each game was the very next thing played after the anchor.
  const afterGame = query.afterGameId ? games.find((g) => g.id === query.afterGameId) : undefined;
  const pairCount = new Map<string, number>();
  let totalTransitions = 0;
  if (afterGame) {
    for (let i = 0; i < sessions.length - 1; i++) {
      if (sessions[i]?.gameId !== afterGame.id) continue;
      const next = sessions[i + 1]?.gameId;
      if (!next) continue;
      pairCount.set(next, (pairCount.get(next) ?? 0) + 1);
      totalTransitions += 1;
    }
  }
  const pairingFires = afterGame !== undefined && totalTransitions >= MIN_PAIR_TRANSITIONS;

  // Affinity is normalised against the catalogue-wide max for this group,
  // computed before the player-count filter so the scale is stable.
  const maxAffinity = Math.max(0, ...games.map((g) => signals.get(g.id)?.affinity ?? 0));

  // --- Step 2: filter by player count --------------------------------------
  const playerCount = query.playerCount ?? (group.length > 0 ? group.length : undefined);
  const candidates =
    playerCount === undefined
      ? games
      : games.filter(
          (g) =>
            (g.minPlayers == null || playerCount >= g.minPlayers) &&
            (g.maxPlayers == null || playerCount <= g.maxPlayers),
        );

  // --- Steps 3 & 4: score and explain --------------------------------------
  const scored = candidates.map((game) => {
    const s = signals.get(game.id);

    const daysSinceLastPlayed = s?.lastPlayedAt
      ? (now.getTime() - s.lastPlayedAt.getTime()) / MS_PER_DAY
      : NEVER_PLAYED_DAYS;
    const recencyScore = (Math.min(daysSinceLastPlayed, RECENCY_CAP_DAYS) / RECENCY_CAP_DAYS) * 100;

    const affinityNorm = maxAffinity > 0 ? (s?.affinity ?? 0) / maxAffinity : 0;
    const groupRating = s?.groupRating ?? null;
    // Centred on 3★ so ratings can suppress as well as boost; unrated = neutral.
    const ratingSignal = groupRating === null ? 0 : (groupRating - 3) / 2;
    const preferenceMultiplier = clamp(
      1 + weights.affinity * affinityNorm + weights.rating * ratingSignal,
      MULTIPLIER_MIN,
      MULTIPLIER_MAX,
    );

    const totalPlays = s?.totalPlays ?? 0;
    const varietyBonus = totalPlays < 3 ? VARIETY_BONUS : 0;
    const neverPlayedBonus = totalPlays === 0 ? NEVER_PLAYED_BONUS : 0;

    const neverWon = group.filter((p) => !s?.wonBy.has(p.id));
    const neverWonBonus = Math.min(neverWon.length * NEVER_WON_BONUS, NEVER_WON_CAP);

    const pairingBonus = pairingFires
      ? weights.pairing * ((pairCount.get(game.id) ?? 0) / totalTransitions)
      : 0;

    const score =
      recencyScore * preferenceMultiplier +
      varietyBonus +
      neverPlayedBonus +
      neverWonBonus +
      pairingBonus;

    return {
      game,
      score,
      reasons: buildReasons({
        weights,
        groupRating,
        affinityNorm,
        groupPlays: s?.groupPlays ?? 0,
        totalPlays,
        daysSinceLastPlayed,
        pairingBonus,
        afterGameName: afterGame?.name,
        neverWonNames: neverWonBonus > 0 ? neverWon.map((p) => p.displayName) : [],
      }),
    };
  });

  scored.sort((a, b) => b.score - a.score || a.game.name.localeCompare(b.game.name));

  return {
    suggestions: scored.slice(0, query.limit).map(
      (entry): Suggestion => ({
        game: toGameDto(entry.game),
        score: entry.score,
        reasons: entry.reasons,
      }),
    ),
  };
}

interface ReasonInputs {
  weights: SuggestWeights;
  groupRating: number | null;
  affinityNorm: number;
  groupPlays: number;
  totalPlays: number;
  daysSinceLastPlayed: number;
  pairingBonus: number;
  afterGameName: string | undefined;
  neverWonNames: string[];
}

/**
 * Up to 2 human-readable reasons, in the spec's priority order. Only signals
 * that actually contributed are mentioned; recency is the always-available
 * fallback, so every suggestion gets at least one reason.
 */
function buildReasons(r: ReasonInputs): string[] {
  const reasons: string[] = [];

  // 1. Rating — only meaningful once the rating knob is on. Preferred over the
  //    favourite reason (stated enjoyment is the more direct signal).
  if (r.weights.rating > 0 && r.groupRating !== null && r.groupRating >= 4) {
    reasons.push(`Highly rated by the group (${r.groupRating.toFixed(1)}★)`);
  } else if (r.affinityNorm >= FAVOURITE_THRESHOLD && r.groupPlays > 0) {
    // 2. Favourite — high affinity relative to the rest of the catalogue.
    reasons.push(`One of your favourites — ${r.groupPlays} play${r.groupPlays === 1 ? '' : 's'}`);
  }

  // 3. Pairing.
  if (r.pairingBonus > 0 && r.afterGameName) {
    reasons.push(`You often follow ${r.afterGameName} with this`);
  }

  // 4. Recency (always applies).
  if (r.totalPlays === 0) {
    reasons.push('Never played');
  } else {
    const days = Math.floor(r.daysSinceLastPlayed);
    reasons.push(
      days === 0 ? 'Last played today' : `Last played ${days} day${days === 1 ? '' : 's'} ago`,
    );
  }

  // 5. Variety (the never-played case is already covered by the recency line).
  if (r.totalPlays === 1) reasons.push('Only played once ever');
  if (r.totalPlays === 2) reasons.push('Only played twice ever');

  // 6. Never-won.
  const neverWonName = r.neverWonNames[0];
  if (neverWonName) reasons.push(`${neverWonName} has never won this`);

  return reasons.slice(0, 2);
}
