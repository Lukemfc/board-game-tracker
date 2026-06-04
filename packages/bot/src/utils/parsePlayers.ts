import type { SessionPlayerInput } from '@meeple/shared';

export function parseCommaSeparated(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildSessionPlayers(
  playerNames: string[],
  winnerNames: string[],
): SessionPlayerInput[] {
  const winnerSet = new Set(winnerNames.map((n) => n.toLowerCase()));
  return playerNames.map((name) => ({
    name,
    isWinner: winnerSet.has(name.toLowerCase()),
  }));
}

/** Returns an error message if any winner is not in the players list, otherwise null. */
export function validateWinners(playerNames: string[], winnerNames: string[]): string | null {
  const playerSet = new Set(playerNames.map((n) => n.toLowerCase()));
  for (const winner of winnerNames) {
    if (!playerSet.has(winner.toLowerCase())) {
      return `Winner '${winner}' is not in the players list.`;
    }
  }
  return null;
}
