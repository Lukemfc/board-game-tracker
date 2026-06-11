import { normalizeGameName } from '@meeple/shared';
import type { AutocompleteInteraction } from 'discord.js';
import { api, ApiError } from './apiClient.js';

/** Extract unique Discord user ids from `<@123>` / `<@!123>` mentions in a string. */
export function parseMentions(text: string): string[] {
  const ids = new Set<string>();
  const re = /<@!?(\d+)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Friendly message for any error thrown while talking to the API. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/** Shared autocomplete for `game` and `location` string options. */
export async function gameLocationAutocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const value = focused.value.toLowerCase();
  // Normalized comparison so punctuation never hides a game: typing
  // "dune imperium" must still match "Dune: Imperium – Uprising".
  const wanted = normalizeGameName(focused.value);
  let choices: string[] = [];
  try {
    choices =
      focused.name === 'location'
        ? (await api.listLocations()).map((l) => l.name)
        : (await api.listGames()).map((g) => g.name);
  } catch {
    choices = [];
  }
  const filtered = choices
    .filter((c) => c.toLowerCase().includes(value) || normalizeGameName(c).includes(wanted))
    .sort((a, b) => {
      // Prefix matches first, then alphabetical.
      const ap = normalizeGameName(a).startsWith(wanted) ? 0 : 1;
      const bp = normalizeGameName(b).startsWith(wanted) ? 0 : 1;
      return ap - bp || a.localeCompare(b);
    })
    .slice(0, 25);
  // Discord hard-rejects the entire response if any choice exceeds 100 chars,
  // so clamp defensively — one long name must not blank out every suggestion.
  await interaction.respond(
    filtered.map((c) => ({ name: c.slice(0, 100), value: c.slice(0, 100) })),
  );
}
