# Feature: All Plays of a Game (`/recent game:`)

**Status:** Implemented
**Priority:** Medium
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)

---

## Goal

Extend the existing `/recent` command so it can show **every time the group has played a
particular game**, not just the most recent plays across all games. The output keeps the same
shape as `/recent` today — a list of **date · game · winner** lines — but scoped to a single
game and showing the full history rather than the last few.

This answers questions like _"how many times have we played Wingspan, and who's won it?"_ — a
chronological log of one game's sessions.

---

## What already exists

Most of the plumbing is already in place — this is largely a bot-side change.

- **Backend** `GET /sessions` ([`routes/sessions.ts`](../../packages/backend/src/routes/sessions.ts))
  already accepts a `game` query param and filters by it. In
  [`services/sessions.ts`](../../packages/backend/src/services/sessions.ts) `listSessions`
  matches `game` against **either the game id or its name (case-insensitive)**:

  ```ts
  if (query.game) {
    where.game = {
      OR: [{ id: query.game }, { name: { equals: query.game, mode: 'insensitive' } }],
    };
  }
  ```

  Results are already ordered `playedOn desc, createdAt desc`.

- **Query schema** [`sessionListQuery`](../../packages/shared/src/index.ts) already validates
  `game`, `limit` (max 100, default 20) and `offset`.

- **Bot API client** [`api.listSessions(filters)`](../../packages/bot/src/apiClient.ts) already
  forwards `game`, `limit`, etc. via `SessionFilters`.

- **Game autocomplete** already exists — `/logplay` and friends use it
  (`gameLocationAutocomplete` in [`logplay.ts`](../../packages/bot/src/commands/logplay.ts)).

So no backend or shared-schema changes are strictly required. The work is: add a `game` option
to the `/recent` command, raise the limit when a game is given, and render a game-scoped embed.

---

## Discord command

Extend the current command rather than adding a new one:

```
/recent [count:5] [game:<game>]
```

| Option  | Type          | Required | Description                                                              |
| ------- | ------------- | -------- | ------------------------------------------------------------------------ |
| `count` | Integer (1–100) | No     | How many to show. Default 5 with no game; default **all** with a game.   |
| `game`  | String        | No       | Game name (autocomplete from the catalogue). Scopes results to one game. |

Behaviour:

- **No `game`** → unchanged: the most recent `count` plays across all games (default 5).
- **With `game`** → every play of that game, most recent first. `count` becomes an optional cap
  (when omitted, show all plays up to the backend max of 100).
- Raise the `count` max from 20 → 100 so a full game history fits (backend already allows 100).

---

## Bot implementation

File: [`packages/bot/src/commands/recent.ts`](../../packages/bot/src/commands/recent.ts)

1. Add a `game` string option with `.setAutocomplete(true)`.
2. Wire up autocomplete reusing the existing game autocomplete helper (the game half of
   `gameLocationAutocomplete`), so the option suggests catalogue games as the user types.
3. In `execute`:
   - Read `game` and `count`.
   - When `game` is set and `count` is omitted, request `limit: 100` (show the lot); otherwise use
     the supplied `count` (default 5 when no game).
   - Call `api.listSessions({ game, limit })`.
   - Render with `recentEmbed` (no game) or a new `gameHistoryEmbed` (game given) — see below.

```ts
const count = interaction.options.getInteger('count');
const game = interaction.options.getString('game') ?? undefined;
await interaction.deferReply();
try {
  const limit = count ?? (game ? 100 : 5);
  const sessions = await api.listSessions({ game, limit });
  const embed = game ? gameHistoryEmbed(game, sessions) : recentEmbed(sessions);
  await interaction.editReply({ embeds: [embed] });
} catch (err) {
  await interaction.editReply({ content: `⚠️ ${errorMessage(err)}` });
}
```

---

## Embed format

Add `gameHistoryEmbed` to [`packages/bot/src/embeds.ts`](../../packages/bot/src/embeds.ts),
mirroring `recentEmbed` (same **date · winner** lines) but titled and headed for one game. Reuse
the existing `day()` helper and the winner-extraction logic.

```
🎲 Wingspan — 7 plays

**2026-06-18** · 👑 Alice
**2026-05-30** · 👑 Bob, Carol
**2026-05-12** · 👑 Alice
**2026-04-28** · (no winner recorded)
...
```

- Title: the game's display name plus a play count, e.g. `🎲 Wingspan — 7 plays`.
  Pull the name from the first session's `game.name` (the user's `game` input may be an id or a
  different-cased string); fall back to the raw input if there are no sessions.
- Each line: bold date, then winner(s) with the 👑 emoji (same crown styling as `recentEmbed`),
  or a "no winner recorded" note when nobody is flagged as winner.
- The game name is omitted from each line (it's in the title — redundant), which is the one
  visual difference from `recentEmbed`.
- Empty state: if no sessions match, `"No plays of **<game>** logged yet."`

> Note: with up to 100 plays this could exceed Discord's 4096-char description limit for very
> heavily-played games. Keep each line compact; if a list ever overflows, truncate to the most
> recent N and add a `"…and X earlier plays"` footer. Not expected at current data volumes, but
> worth a guard.

---

## Acceptance criteria

- [ ] `/recent` with no options behaves exactly as before (5 most recent plays, all games).
- [ ] `/recent game:Wingspan` lists **every** logged Wingspan play, most recent first.
- [ ] The `game` option autocompletes from the catalogue.
- [ ] Matching is case-insensitive and works whether the user picks the autocomplete value (id)
      or types the name.
- [ ] Each line shows the play date and the winner(s); plays with no winner are clearly marked.
- [ ] The embed title shows the game name and total play count.
- [ ] `/recent game:Wingspan count:3` caps the list to the 3 most recent Wingspan plays.
- [ ] A game with no logged plays returns a friendly empty-state message.
- [ ] `count` accepts up to 100.

---

## Notes & decisions

- **Extend `/recent`, don't add a new command.** The output is the same shape (date · winner)
  just scoped to one game, so a `game` option on the existing command is the least surprising UX
  and avoids command sprawl.
- **No backend changes needed.** The `game` filter and case-insensitive name matching already
  exist in `listSessions`; this feature just exercises them from the bot. If a dedicated
  per-game summary (totals, win breakdown) is wanted later, that's a separate stats feature —
  this one deliberately stays a chronological log.
- **Default-to-all when a game is given.** When you ask for one game's history you almost always
  want the whole thing; `count` stays available as a cap for chatty channels.
- **Reuse over duplication.** `gameHistoryEmbed` shares the `day()` helper and winner logic with
  `recentEmbed`; factor the winner-line snippet into a small helper if it helps readability.
