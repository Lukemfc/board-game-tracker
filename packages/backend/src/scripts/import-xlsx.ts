/**
 * One-off importer for the historical board-game spreadsheet (PLAN.md §5).
 *
 * Usage (omit the angle/square brackets — they denote placeholders/optionals):
 *   pnpm --filter @meeple/backend run import:xlsx -- /abs/path.xlsx [--dry-run] [--sheet=Name]
 *
 * Idempotent: a session is identified by (game, day, set of player names), so
 * re-running imports nothing new. Adjust COLUMNS / PLAYER_SEPARATOR below to
 * match your sheet's exact headers (see PLAN.md Appendix B).
 */
import { existsSync } from 'node:fs';
import XLSX from 'xlsx';
import { playerDisplayName } from '../mappers.js';
import { prisma } from '../prisma.js';

// --- Configure to match your spreadsheet -----------------------------------
const COLUMNS = {
  date: 'Date',
  game: 'Board Game',
  location: 'Venue',
  players: 'Players',
  winners: 'Winner',
  notes: 'Notes',
} as const;

/** Separator between names in the "players"/"winners" cells. */
const PLAYER_SEPARATOR = ',';
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const trimName = (s: string) => s.trim();
const keyName = (s: string) => s.trim().toLowerCase();
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function splitList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(PLAYER_SEPARATOR)
    .map(trimName)
    .filter((s) => s.length > 0);
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  // DD/MM/YYYY (or with - separators)
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
    return new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  }
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : new Date(ts);
}

function getCell(row: Row, column: string): unknown {
  return row[column];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sheetArg = args.find((a) => a.startsWith('--sheet='))?.split('=')[1];
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error(
      'Usage: pnpm --filter @meeple/backend run import:xlsx -- /abs/path.xlsx [--dry-run] [--sheet=Name]',
    );
    process.exit(1);
  }
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = sheetArg ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    console.error(`Sheet not found: ${sheetName ?? '(none)'}`);
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });

  const log = (...a: unknown[]) => console.log(dryRun ? '[dry-run]' : '[import]', ...a);

  log(`Read ${rows.length} row(s) from sheet "${sheetName}".`);

  // Preload existing data for dedupe / new-entity counting.
  const existingGames = new Map((await prisma.game.findMany()).map((g) => [keyName(g.name), g.id]));
  const existingLocations = new Map(
    (await prisma.location.findMany()).map((l) => [keyName(l.name), l.id]),
  );
  const existingPlayers = new Map(
    (await prisma.player.findMany()).map((p) => [keyName(playerDisplayName(p)), p.id]),
  );

  const existingSessions = await prisma.session.findMany({
    include: { game: true, players: { include: { player: true } } },
  });
  const sessionKeys = new Set(
    existingSessions.map((s) =>
      [
        keyName(s.game.name),
        dayKey(s.playedOn),
        s.players
          .map((sp) => keyName(playerDisplayName(sp.player)))
          .sort()
          .join(','),
      ].join('|'),
    ),
  );

  let created = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  const newGames = new Set<string>();
  const newLocations = new Set<string>();
  const newPlayers = new Set<string>();

  for (const [i, row] of rows.entries()) {
    const rowNum = i + 2; // +1 for header, +1 for 1-based
    const gameName = String(getCell(row, COLUMNS.game) ?? '').trim();
    const playedOn = parseDate(getCell(row, COLUMNS.date));
    const playerNames = splitList(getCell(row, COLUMNS.players));
    const winnerNames = splitList(getCell(row, COLUMNS.winners));
    const locationName = String(getCell(row, COLUMNS.location) ?? '').trim();
    const notes = String(getCell(row, COLUMNS.notes) ?? '').trim();

    if (!gameName || !playedOn || playerNames.length === 0) {
      skippedInvalid += 1;
      log(`Row ${rowNum}: skipped (missing game, date, or players).`);
      continue;
    }

    const winnerSet = new Set(winnerNames.map(keyName));
    const dedupeKey = [
      keyName(gameName),
      dayKey(playedOn),
      playerNames.map(keyName).sort().join(','),
    ].join('|');

    if (sessionKeys.has(dedupeKey)) {
      skippedDuplicate += 1;
      continue;
    }
    sessionKeys.add(dedupeKey);

    if (!existingGames.has(keyName(gameName))) newGames.add(keyName(gameName));
    if (locationName && !existingLocations.has(keyName(locationName))) {
      newLocations.add(keyName(locationName));
    }
    for (const name of playerNames) {
      if (!existingPlayers.has(keyName(name))) newPlayers.add(keyName(name));
    }

    if (dryRun) {
      created += 1;
      continue;
    }

    // --- Resolve / create entities (real run) ---
    let gameId = existingGames.get(keyName(gameName));
    if (!gameId) {
      const game = await prisma.game.upsert({
        where: { name: gameName },
        update: {},
        create: { name: gameName },
      });
      gameId = game.id;
      existingGames.set(keyName(gameName), gameId);
    }

    let locationId: string | null = null;
    if (locationName) {
      locationId = existingLocations.get(keyName(locationName)) ?? null;
      if (!locationId) {
        const loc = await prisma.location.upsert({
          where: { name: locationName },
          update: {},
          create: { name: locationName },
        });
        locationId = loc.id;
        existingLocations.set(keyName(locationName), locationId);
      }
    }

    const playerRows: { playerId: string; isWinner: boolean }[] = [];
    const seen = new Set<string>();
    for (const name of playerNames) {
      let playerId = existingPlayers.get(keyName(name));
      if (!playerId) {
        const existing = await prisma.player.findFirst({ where: { realName: name } });
        const player = existing ?? (await prisma.player.create({ data: { realName: name } }));
        playerId = player.id;
        existingPlayers.set(keyName(name), playerId);
      }
      if (seen.has(playerId)) continue;
      seen.add(playerId);
      playerRows.push({ playerId, isWinner: winnerSet.has(keyName(name)) });
    }

    await prisma.session.create({
      data: {
        playedOn,
        gameId,
        locationId,
        notes: notes || null,
        players: { create: playerRows },
      },
    });
    created += 1;
  }

  log('---');
  log(`Sessions ${dryRun ? 'to create' : 'created'}: ${created}`);
  log(`Duplicates skipped: ${skippedDuplicate}`);
  log(`Invalid rows skipped: ${skippedInvalid}`);
  log(
    `New games: ${newGames.size}, new locations: ${newLocations.size}, new players: ${newPlayers.size}`,
  );
  if (dryRun) log('No changes were written (dry run).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
