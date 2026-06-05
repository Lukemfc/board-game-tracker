/**
 * Reconcile incoming BGG games against the existing catalogue.
 *
 * The golden rule: `Game.name` is the group's name and is never overwritten.
 * BGG data only ever links to an existing game (filling blank metadata) or, as
 * a last resort, creates a new one. See docs/features/bgg-integration.md.
 */
import type { BggImportResult, BggReconcileAction } from '@meeple/shared';
import { bestMatch, classifyScore } from '@meeple/shared';
import { Prisma } from '@prisma/client';
import type { GameRecord } from '../db.js';
import { notFound } from '../errors.js';
import { prisma, type Tx } from '../prisma.js';
import { getCollection } from './bgg.js';

/** Everything reconciliation needs from a BGG game (details or a collection row). */
export interface BggReconcileInput {
  bggId: number;
  name: string;
  yearPublished?: number | null;
  minPlayers?: number | null;
  maxPlayers?: number | null;
  thumbnail?: string | null;
  description?: string | null;
}

export interface ReconcileOptions {
  /** Force-link to this existing game (keeps its name). */
  linkToId?: string;
  /** Force-create a new game even if a fuzzy match exists. */
  forceCreate?: boolean;
}

export interface ReconcileOutcome {
  action: BggReconcileAction;
  game: GameRecord | null;
  candidate: { id: string; name: string; score: number } | null;
}

/**
 * Build an update that only *fills in* blank fields — it never touches `name`,
 * and never clobbers a value the group may have set by hand.
 */
function enrichData(game: GameRecord, d: BggReconcileInput): Prisma.GameUpdateInput {
  const data: Prisma.GameUpdateInput = {};
  if (game.bggId == null) data.bggId = d.bggId;
  if (!game.bggName) data.bggName = d.name;
  if (!game.bggThumbnail && d.thumbnail) data.bggThumbnail = d.thumbnail;
  if (!game.description && d.description) data.description = d.description;
  if (game.yearPublished == null && d.yearPublished != null) data.yearPublished = d.yearPublished;
  if (game.minPlayers == null && d.minPlayers != null) data.minPlayers = d.minPlayers;
  if (game.maxPlayers == null && d.maxPlayers != null) data.maxPlayers = d.maxPlayers;
  return data;
}

async function createFromBgg(tx: Tx, d: BggReconcileInput): Promise<GameRecord> {
  try {
    return await tx.game.create({
      data: {
        name: d.name, // first and only time BGG sets `name`
        bggId: d.bggId,
        bggName: d.name,
        bggThumbnail: d.thumbnail ?? null,
        description: d.description ?? null,
        yearPublished: d.yearPublished ?? null,
        minPlayers: d.minPlayers ?? null,
        maxPlayers: d.maxPlayers ?? null,
      },
    });
  } catch (err) {
    // A game with this exact name already exists — link to it rather than fail.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await tx.game.findFirst({
        where: { name: { equals: d.name, mode: 'insensitive' } },
      });
      if (existing)
        return tx.game.update({ where: { id: existing.id }, data: enrichData(existing, d) });
    }
    throw err;
  }
}

/**
 * Decide what to do with one BGG game. Match order: explicit override →
 * existing `bggId` → confident fuzzy name → ambiguous (asks the caller) → create.
 */
export async function reconcileGame(
  tx: Tx,
  d: BggReconcileInput,
  opts: ReconcileOptions = {},
): Promise<ReconcileOutcome> {
  if (opts.forceCreate) {
    return { action: 'created', game: await createFromBgg(tx, d), candidate: null };
  }

  if (opts.linkToId) {
    const target = await tx.game.findUnique({ where: { id: opts.linkToId } });
    if (!target) throw notFound('game');
    const game = await tx.game.update({ where: { id: target.id }, data: enrichData(target, d) });
    return { action: 'linked', game, candidate: null };
  }

  const byBggId = await tx.game.findUnique({ where: { bggId: d.bggId } });
  if (byBggId) {
    const game = await tx.game.update({ where: { id: byBggId.id }, data: enrichData(byBggId, d) });
    return { action: 'enriched', game, candidate: null };
  }

  const games = await tx.game.findMany();
  const match = bestMatch(d.name, games);
  if (match) {
    const verdict = classifyScore(match.score);
    if (verdict === 'confident') {
      const game = await tx.game.update({
        where: { id: match.candidate.id },
        data: enrichData(match.candidate, d),
      });
      return { action: 'linked', game, candidate: null };
    }
    if (verdict === 'ambiguous') {
      return {
        action: 'ambiguous',
        game: null,
        candidate: { id: match.candidate.id, name: match.candidate.name, score: match.score },
      };
    }
  }

  return { action: 'created', game: await createFromBgg(tx, d), candidate: null };
}

/**
 * Import a BGG user's owned games. Each game is reconciled in its own
 * transaction so later items see games created by earlier ones. Ambiguous
 * matches are left untouched and reported for manual review — we'd rather skip
 * than wrongly merge two different games.
 */
export async function importCollection(bggUsername: string): Promise<BggImportResult> {
  const items = await getCollection(bggUsername);
  const result: BggImportResult = {
    created: 0,
    linked: 0,
    enriched: 0,
    skipped: 0,
    needsReview: [],
  };

  for (const item of items) {
    const outcome = await prisma.$transaction((tx) =>
      reconcileGame(tx, {
        bggId: item.bggId,
        name: item.name,
        yearPublished: item.yearPublished,
      }),
    );
    switch (outcome.action) {
      case 'created':
        result.created++;
        break;
      case 'linked':
        result.linked++;
        break;
      case 'enriched':
        result.enriched++;
        break;
      case 'ambiguous':
        result.skipped++;
        if (outcome.candidate) {
          result.needsReview.push({
            bggId: item.bggId,
            bggName: item.name,
            candidateName: outcome.candidate.name,
            score: outcome.candidate.score,
          });
        }
        break;
    }
  }

  return result;
}
