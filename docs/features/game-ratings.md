# Feature: Game Enjoyment Ratings

**Status:** In progress — `/rate` + `/gameratings` and the ratings API shipped; the `/suggest` blend lands with [what-to-play-tonight.md](what-to-play-tonight.md) (not yet built).  
**Priority:** Medium  
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)  
**Amends:** [what-to-play-tonight.md](what-to-play-tonight.md) — blends a rating signal into the affinity-based favourite multiplier. (That spec now describes the blended `preferenceMultiplier` natively.)

---

## Goal

Let each player give every game a personal **enjoyment rating** (1–5 stars) — how much _they_ like playing it, independent of how often it hits the table or whether they win. We surface the **group average** by default, with a **per-player breakdown** on demand, and we feed the rating into the `/suggest` engine so it leans toward games the group enjoys and **away from games they don't**.

Ratings capture something the play history alone cannot:

- **Dislike.** Play history has no negative — a game that's rarely played looks identical to a game everyone hates. A rating can actively say "we don't enjoy this," which is exactly the signal needed to _stop_ suggesting it.
- **Latent preference.** A long, heavy, or high-player-count game you love but rarely get to the table looks "unloved" by play count. A rating rescues it.
- **Habit vs. enjoyment.** The default game gets reached for because it's _easy_, not because it's _loved_. Ratings separate the two.

---

## Relationship to "What Should We Play Tonight?"

The `what-to-play-tonight` spec scores games partly via a **favourite multiplier** derived from a recency-weighted play count (_affinity_ — revealed preference). **This feature blends a rating signal (stated preference) into that multiplier**, producing a single `preferenceMultiplier` (0.5–2.0) that replaces the old `favouriteMultiplier` (1.0–2.0).

- The `affinity` calculation is **kept** — it's the zero-effort, auto-updating "what's hot lately" signal, and it has no cold-start problem.
- The rating signal is **added** on top, contributing what affinity can't: it can push a game **below 1.0** to actively suppress games the group dislikes, and it captures latent love for games that rarely hit the table.
- Everything else in that spec — recency base, variety bonus, never-won bonus, pairing signal — is unchanged. Reasons gain one new option (see below).
- **Graceful degradation:** the rating term is _centred_, so a game **nobody in the group has rated** contributes a neutral rating signal of **0** — the multiplier falls back to pure affinity, i.e. exactly the original behaviour. No cold-start cliff, and the engine is useful from day one.

> Why blend rather than pick one: affinity answers _"what do we keep reaching for?"_ and rating answers _"what do we actually enjoy, and what should we avoid?"_ They're complementary. The blend's most useful emergent behaviour: a game played often out of **habit** but rated low gets its affinity boost **tempered** by the low rating — so ratings can correct a lazy default that revealed preference alone would keep entrenching.

---

## Data model

A new `Rating` join model — one row per (player, game), upserted:

```prisma
model Rating {
  player    Player   @relation(fields: [playerId], references: [id])
  playerId  String
  game      Game     @relation(fields: [gameId], references: [id])
  gameId    String
  value     Int      // 1–5
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@id([playerId, gameId])
  @@index([gameId])
}
```

Add the back-relations: `ratings Rating[]` on both `Player` and `Game`.

**Migration:** follow the documented flow (`migrate dev` is non-interactive here) — `prisma migrate diff --from-url … --script` to generate the SQL, then `migrate deploy`.

`value` is constrained to 1–5 at the API layer (Zod), not in the DB, to match the rest of the schema's validation style.

---

## The blended preference multiplier

Affinity and rating combine into one `preferenceMultiplier` that scales the recency (due-ness) base in `/suggest`. **Affinity can only boost** (its normalised form is 0–1); **rating is centred so it can boost _or_ suppress** (−1…+1):

```
affinityNorm = affinity / (max affinity across the catalogue, for this group)   // 0–1, revealed
groupRating  = mean(value) over players in the group who have rated this game    // 1–5, or null
ratingSignal = (groupRating - 3) / 2     // 1★ → -1, 3★ → 0, 5★ → +1; 0 if unrated (neutral)

preferenceMultiplier = clamp(
    1 + AFFINITY_WEIGHT * affinityNorm + RATING_WEIGHT * ratingSignal,
    0.5, 2.0
)                                         // AFFINITY_WEIGHT = 0.5, RATING_WEIGHT = 0.5
```

With both weights at 0.5 the natural range lands exactly on the [0.5, 2.0] bounds, so the clamp is just a safety net:

| Scenario                                   | affinityNorm | ratingSignal | Multiplier | Effect                         |
| ------------------------------------------ | ------------ | ------------ | ---------- | ------------------------------ |
| Played a lot **and** loved (5★)            | 1.0          | +1.0         | 2.0        | strongly surfaced              |
| Rarely played but loved (5★) — latent love | ~0.1         | +1.0         | ~1.55      | boosted despite low play count |
| Played a lot out of **habit**, rated 2★    | 1.0          | −0.5         | 1.25       | habit boost **tempered**       |
| Unrated, middling play history             | 0.4          | 0 (neutral)  | 1.2        | pure affinity (old behaviour)  |
| Rarely played **and** disliked (1★)        | 0.0          | −1.0         | 0.5        | suppressed                     |

- Because the multiplier scales **recency**, a beloved game played _last night_ still scores near zero — we don't re-suggest what we just played. (Same mechanic the affinity multiplier always used.)
- A low rating drives `ratingSignal` negative, pulling the multiplier toward (and below) 1.0 — actively pushing disliked games down, the core of the "lean away from what we don't like" goal, and the one thing affinity alone could never do.
- **Two tunable knobs:** `AFFINITY_WEIGHT` (how much revealed habit matters) and `RATING_WEIGHT` (how much stated enjoyment matters). Set `RATING_WEIGHT = 0` and the engine is exactly the original affinity-only design.

**Group scoping** (mirrors the rest of `/suggest`): if `playerIds` are supplied, both affinity and the rating average use only those players; if omitted, both use the whole roster.

> **Rating aggregation = simple mean** (decision). A polarizing game (e.g. 5/5/1) can therefore out-rank a uniformly-liked one (3/3/3) on a high average, even though one player dislikes it. If that proves annoying, switch the aggregate to an outlier-penalizing form (`mean − k·(mean − min)`) — isolated behind the `groupRating` calc, no wider change.

### Reasons in `/suggest`

The `what-to-play-tonight` reason list keeps its favourite reason and gains a rating reason. Pick whichever signal contributed more:

- `"One of your favourites — X plays"` — fires when `affinityNorm` is high (top quartile), as before.
- `"Highly rated by the group (4.5★)"` — fires when `groupRating ≥ 4`.
- If both apply, prefer the rating reason (stated enjoyment is the more direct signal).
- Suppressed (low-rated) games simply don't reach the top N, so they need no reason.

---

## Discord commands

### `/rate` — set or update your rating

```
/rate game:<name> stars:<1-5>
```

| Option  | Type                  | Required | Description                                                |
| ------- | --------------------- | -------- | ---------------------------------------------------------- |
| `game`  | String (autocomplete) | Yes      | Game from the catalogue (same autocomplete as `/logplay`). |
| `stars` | Integer (1–5)         | Yes      | How much _you_ enjoy it.                                   |

- Resolves the Discord user to a `Player` via `discordUserId` (create if needed, same as `/logplay`).
- Upserts the rating (`@@id([playerId, gameId])`), so re-rating overwrites.
- Replies ephemerally: `You rated Wingspan ★★★★☆ (4). Group average is now 4.3★.`

### `/gameratings` — see the breakdown

```
/gameratings game:<name>
```

Public embed showing the aggregate and the per-player breakdown (the "both" visibility decision):

```
⭐ Wingspan — 4.3★ avg (3 ratings)

  Alice   ★★★★★  (5)
  Bob     ★★★★☆  (4)
  Carol   ★★★☆☆  (3)

Not yet rated: Dave
```

- Sort the breakdown by rating descending.
- If no one has rated it: `No ratings yet for Wingspan. Be the first with /rate.`

### Optional surfacing (nice-to-have, not required)

- Show the group average on the existing game info embed (wherever a single game is displayed).
- Nudge after `/logplay`: if the logging player has no rating for the game just played, a quiet ephemeral hint to `/rate` it.

---

## Backend

### Endpoints

```
PUT  /games/:id/ratings        body: { playerId, value }     → upsert, returns the rating + new group average
GET  /games/:id/ratings        → { average, count, perPlayer: [{ player, value }] }
```

- `PUT` validates `value ∈ [1,5]` (Zod) and 404s on unknown game/player.
- `GET` returns `average: null` and `perPlayer: []` when unrated.

### `/suggest` integration

> **Status:** `/suggest` (the [what-to-play-tonight](what-to-play-tonight.md) feature) is built and the blend below is wired up. Per the phasing note it shipped with `RATING_WEIGHT = 0` (affinity-only); once the group had accumulated ratings the weight was raised to `0.5`, switching the blend on (June 2026).

In the suggest service, keep the existing `affinity` / `affinityNorm` computation and fold the rating signal into it to form the `preferenceMultiplier` above:

- Batch-load ratings for all catalogue games (group-scoped) alongside the existing data gather (Step 1).
- Compute `groupRating` and `ratingSignal` per game (unrated → 0).
- Combine with the existing `affinityNorm` into `preferenceMultiplier`; substitute it for `favouriteMultiplier` in the score formula.

```
score = recencyScore * preferenceMultiplier
      + varietyBonus
      + neverWonBonus
      + pairingBonus
```

### Shared types

Add to `packages/shared/src/index.ts`:

```ts
export const rating = z.object({ player: playerDto, value: z.number().int().min(1).max(5) });
export const gameRatings = z.object({
  average: z.number().nullable(),
  count: z.number().int(),
  perPlayer: z.array(rating),
});
```

---

## Acceptance criteria

- [ ] `/rate game:Wingspan stars:4` records the caller's rating and confirms the new group average.
- [ ] Re-running `/rate` for the same game overwrites the previous value (no duplicate rows).
- [ ] `stars` outside 1–5 is rejected with a friendly message.
- [ ] `/gameratings game:Wingspan` shows the group average and a per-player breakdown, sorted high→low.
- [ ] `/gameratings` on an unrated game shows the "no ratings yet" message.
- [ ] In `/suggest`, a highly-rated game (group avg ≥ 4) that's due for a replay outranks an equally-due game with a low/no rating.
- [ ] In `/suggest`, a **low-rated** game (group avg ≤ 2) is pushed _down_ relative to where recency + affinity alone would place it.
- [ ] A frequently-played game rated **low** has its affinity boost tempered (ranks below where affinity alone would put it).
- [ ] A game **no one in the group has rated** falls back to the affinity-only behaviour (rating term contributes 0) — `/suggest` still returns sensible results before any ratings exist.
- [ ] A highly-rated game played yesterday is **not** re-suggested to the top (multiplier scales recency).
- [ ] Ratings and affinity are both group-scoped: `/suggest players:@alice @bob` uses only Alice's and Bob's plays and ratings.
- [ ] Setting `RATING_WEIGHT = 0` reproduces the original affinity-only suggestions.

---

## Notes & decisions

- **Affinity and rating are blended, not swapped.** Affinity (revealed, auto-updating, no cold start) and rating (stated, can suppress, captures latent love) answer different questions, so both are kept. The blend is additive into one `preferenceMultiplier`, with affinity boost-only and rating centred so it can suppress.
- **Why a multiplier, not a flat bonus.** A flat "+50 if loved" would re-suggest a beloved game the night after playing it. Scaling recency means a loved game only surfaces when it's _due_ — preserving the explore/exploit balance the `what-to-play-tonight` spec is built around.
- **Sub-1.0 range is the point.** Letting the rating term drive the multiplier below 1.0 is what lets a low rating _suppress_ a game — the capability affinity lacked and the main reason ratings feed `/suggest`.
- **Ratings temper habit.** Because rating is additive and centred, a high-affinity game that's rated low gets pulled back toward neutral — so the engine can unlearn a lazy default that revealed preference alone would keep entrenching.
- **Group aggregate = simple mean** (decision). Known trade-off: polarizing games can win on average. Isolated behind `groupRating` so it can become outlier-penalizing later without touching the rest.
- **Both visibilities** — group average by default, per-player on demand via `/gameratings`. The per-player breakdown is also fun social signal.
- **1–5 star scale.** Granular enough to be meaningful, coarse enough that people will actually fill it in. (A 1–10 scale invites decision paralysis; thumbs up/down loses the "meh vs. love" distinction that drives the multiplier.)
- **Phasing de-risks adoption.** The blend pays off as ratings accumulate, but it isn't _blocked_ on them — unrated games fall back to affinity-only. Still, the cheapest path is to ship `/rate` + `/gameratings` first (with `RATING_WEIGHT = 0`), watch ratings accumulate over a few game nights, then raise `RATING_WEIGHT` to switch the blend on. No code change to flip it on — just the knob.
