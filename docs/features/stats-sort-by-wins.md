# Feature: Sort `/stats` "By game" by wins

**Status:** Done  
**Priority:** Low  
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)

---

## Goal

The `/stats` command shows a player's per-game breakdown as a "By game" list (`wins/plays` per game). Today that list is **sorted by number of plays**, so the games you've sat down to most often float to the top — regardless of whether you ever win them. The list should instead be **sorted by number of wins**, so the games you're actually good at lead.

This is a small, self-contained change: the data already carries `wins` per game; only the sort order (and one display tweak) changes.

---

## Current behaviour

`getPlayerStats` in `packages/backend/src/services/stats.ts` builds `byGame` and sorts it:

```ts
const byGame = [...byGameMap.values()]
  .map((e) => ({ game: toGameDto(e.game), plays: e.plays, wins: e.wins }))
  .sort((a, b) => b.plays - a.plays || a.game.name.localeCompare(b.game.name));
```

The bot then renders the top 10 in `playerStatsEmbed` (`packages/bot/src/embeds.ts`) as:

```
• Wingspan: 8/21
• Catan: 3/15
...
```

(format is `wins/plays`.)

So a game played 21 times with 8 wins ranks **above** a game played 6 times with 6 wins — even though the player wins the second far more reliably.

---

## Change

Re-sort `byGame` by wins descending, with sensible tie-breakers:

```ts
const byGame = [...byGameMap.values()]
  .map((e) => ({ game: toGameDto(e.game), plays: e.plays, wins: e.wins }))
  .sort(
    (a, b) =>
      b.wins - a.wins || // most wins first
      b.wins / b.plays - a.wins / a.plays || // then better win rate
      b.plays - a.plays || // then more plays
      a.game.name.localeCompare(b.game.name), // then alphabetical
  );
```

Tie-breaker rationale: two games with equal wins should be separated by win **rate** (5 wins from 6 plays beats 5 wins from 30 plays), then by raw plays, then name for stability.

No API/shape change: `PlayerStats.byGame` keeps the same `{ game, plays, wins }` entries — only their order changes. The bot embed needs no change, since it already renders `wins/plays` in whatever order the backend returns.

### Optional display polish (not required)

- Games with **0 wins** will now sink to the bottom. With the top-10 slice in the embed, a player who's played 15 games but only won 4 of them will see their 4 winning games plus the 6 most-played win-less ones. That's the intended emphasis, but if it reads oddly we could label the section "By wins" instead of "By game" to set expectations.

---

## Scope

- **Backend:** one sort comparator in `getPlayerStats` (`services/stats.ts`). ~1 line.
- **Bot:** none required. Optionally relabel the embed field to "By wins".
- **Shared types:** none.
- **Migration:** none.

---

## Acceptance criteria

- [x] In `/stats`, the "By game" list is ordered by wins descending.
- [x] Two games with equal wins are ordered by win rate, then plays, then name.
- [x] Games with zero wins appear after all games with at least one win.
- [x] Existing `/stats` tests updated to assert the new ordering (`packages/backend/test/stats.test.ts`).

---

## Notes & decisions

- **Wins, not win rate, as the primary sort.** The request was explicit: order by _number of wins_. Win rate is only a tie-breaker. (A pure win-rate sort would crown a 1-from-1 fluke over an 8-from-12 mainstay — not what's wanted here.)
- **No new data needed.** `wins` is already aggregated per game; this is purely presentational.
