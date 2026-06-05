/**
 * Fuzzy matching for reconciling BGG games with the existing catalogue.
 *
 * The group's `Game.name` is authoritative — BGG data only ever *links to* an
 * existing game or *fills in* missing metadata, never renames. Both the
 * `/addgame` search flow and `/importcollection` use these helpers so they
 * apply identical rules. See docs/features/bgg-integration.md.
 */

/** Confident auto-link at or above this similarity. */
export const MATCH_CONFIDENT = 0.8;
/** Below this, treat as no match. The [AMBIGUOUS, CONFIDENT) band needs a human. */
export const MATCH_AMBIGUOUS = 0.6;

export type MatchVerdict = 'confident' | 'ambiguous' | 'none';

/**
 * Normalise a game name before comparing:
 * lowercase, drop a trailing `(YYYY)`, strip punctuation and edition noise,
 * and collapse whitespace. `Catan (1995)` and `CATAN` both become `catan`.
 */
export function normalizeGameName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(\s*\d{4}\s*\)/g, ' ') // year suffix, e.g. "(1995)"
    .replace(/[:–—\-_,.'"!?()]/g, ' ') // punctuation
    .replace(/\b(?:the|edition|ed)\b/g, ' ') // edition noise
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bigram (Dice) coefficient of two strings, in [0, 1]. */
export function similarity(a: string, b: string): number {
  const x = normalizeGameName(a);
  const y = normalizeGameName(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const bg = x.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const bg = y.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (x.length - 1 + (y.length - 1));
}

export function classifyScore(score: number): MatchVerdict {
  if (score >= MATCH_CONFIDENT) return 'confident';
  if (score >= MATCH_AMBIGUOUS) return 'ambiguous';
  return 'none';
}

/** Anything with a local name and (optionally) a stored BGG name. */
export interface NameCandidate {
  name: string;
  bggName?: string | null;
}

/** Best similarity of an incoming BGG name against one candidate's names. */
export function scoreCandidate(bggName: string, candidate: NameCandidate): number {
  const local = similarity(bggName, candidate.name);
  const stored = candidate.bggName ? similarity(bggName, candidate.bggName) : 0;
  return Math.max(local, stored);
}

/** Highest-scoring candidate for an incoming BGG name, or null if none given. */
export function bestMatch<T extends NameCandidate>(
  bggName: string,
  candidates: readonly T[],
): { candidate: T; score: number } | null {
  let best: { candidate: T; score: number } | null = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(bggName, candidate);
    if (!best || score > best.score) best = { candidate, score };
  }
  return best;
}
