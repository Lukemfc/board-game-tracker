# Feature: What Should We Play Tonight?

**Status:** Planned  
**Priority:** Medium  
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)

---

## Goal

A `/suggest` Discord command that recommends games from the catalogue based on who's playing, what's due for a replay, variety — and, importantly, **what this group actually loves to play**. The whole point is to nudge the group toward a good night, not to mechanically rotate through the shelf.

Two complementary signals tell us what the group loves:

- **Revealed preference (affinity).** Nobody is forced to play anything, so a game that's been **freely chosen many times over the alternatives** is, by revealed preference, a favourite.
- **Stated preference (ratings).** The [Game Enjoyment Ratings](game-ratings.md) feature lets each player rate every game 1–5★. Ratings capture what play history can't: active **dislike** (a rarely-played game looks identical to a hated one by play count alone), **latent love** (a heavy game you adore but rarely get to the table), and the difference between **habit and enjoyment**.

The suggestion engine blends both into a single preference signal and leans into it rather than fighting it.

---

## The exploration ↔ exploitation tension

The naive version of this feature only rewarded neglect and novelty (play the thing we haven't touched in months, try the new box). Left unchecked, that actively buries the group's favourites — which is the opposite of a good recommendation. A favourite that's "due" for another outing should beat a mediocre game that happens to be equally neglected.

So the engine balances two pulls:

- **Exploitation** — surface beloved games when they're due, and suppress games the group dislikes. Driven by the **preference signal**: a blend of affinity (revealed) and [ratings](game-ratings.md) (stated).
- **Exploration** — keep variety alive: neglected games, new additions, fairness. Driven by recency, variety, and never-won signals.

The trick is to make "preference" interact with "due-ness" rather than override it: a favourite played _last night_ should still score low (we just played it), but a favourite we haven't played in three weeks should leap ahead of a so-so game we also haven't played in three weeks. And unlike affinity, ratings can pull the other way — a game the group has rated low gets actively pushed _down_, not just left unboosted.

---

## Discord command

```
/suggest [players:@alice @bob @charlie] [count:4] [after:<game>]
```

| Option    | Type           | Required | Description                                                                                           |
| --------- | -------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `players` | Mention string | No       | Who's playing tonight. If omitted, uses the full player roster.                                       |
| `count`   | Integer (1–6)  | No       | Number of suggestions to return. Default 3.                                                           |
| `after`   | String         | No       | A game you've just finished (autocomplete from the catalogue). Surfaces games that pair well with it. |

The command replies with a public embed listing the top suggestions, each with a one-line reason.

---

## New backend endpoint

```
GET /stats/suggest?playerCount=<n>&playerIds=<id1,id2,...>&afterGameId=<id>&limit=<n>
```

| Query param   | Required | Description                                                                                                    |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `playerCount` | No       | Filter by player count (uses `minPlayers`/`maxPlayers` on Game). Falls back to `playerIds` length if provided. |
| `playerIds`   | No       | Comma-separated Player IDs. Used for the preference signal (affinity + ratings), recency, and never-won checks (all group-scoped). |
| `afterGameId` | No       | A game just played. Adds a pairing bonus to games that historically follow it. Omit to skip pairing.           |
| `limit`       | No       | Number of results to return. Default 5.                                                                        |

**Response:**

```json
{
  "suggestions": [
    {
      "game": { "id": "...", "name": "Wingspan", "bggThumbnail": "..." },
      "score": 168,
      "reasons": ["Highly rated by the group (4.5★)", "Last played 24 days ago"]
    },
    {
      "game": { "id": "...", "name": "Cascadia" },
      "score": 142,
      "reasons": ["You often follow Wingspan with this", "Last played 31 days ago"]
    },
    {
      "game": { "id": "...", "name": "Azul" },
      "score": 118,
      "reasons": ["Only played twice ever", "Alice has never won this"]
    }
  ]
}
```

---

## Scoring algorithm

The endpoint computes a **suggestion score** for every game in the catalogue, then returns the top N.

### Step 1: Gather data

For each game, fetch (all "for the group" figures are scoped to `playerIds` when provided, otherwise the whole roster):

- `lastPlayedAt` — date of the most recent session for this game (or `null` if never played).
- `totalPlays` — total number of sessions ever.
- `groupPlays` — sessions involving (a subset of) the playing group. Drives the favourite signal.
- `affinity` — a **recency-weighted play count** for the group (see below). This is the revealed-preference measure.
- `groupRating` — the **mean enjoyment rating** (1–5★) over players in the group who have rated this game, or `null` if none have (see [game-ratings.md](game-ratings.md)). Batch-loaded for all catalogue games alongside the rest of the gather. This is the stated-preference measure.
- `recentWinners` — for each player in `playerIds`, whether they've won this game in the last 90 days.
- `pairCount[afterGameId → game]` — how often this game has historically followed `afterGameId` (see "Pairing signal").

### Step 2: Filter by player count

If `playerCount` is provided and the game has `minPlayers` or `maxPlayers` set, exclude games where `playerCount < minPlayers` or `playerCount > maxPlayers`. If those fields are not set on the game, do not exclude it.

### Step 3: Compute score

```
score = recencyScore * preferenceMultiplier
      + varietyBonus
      + neverWonBonus
      + pairingBonus
```

**Recency score** (0–100): How long since the game was last played. This is the "due-ness" base that the preference multiplier scales.

```
daysSinceLastPlayed = today - lastPlayedAt   (or 365 if never played)
recencyScore = min(daysSinceLastPlayed, 180) / 180 * 100
```

- A game played today scores 0. A game not played for 6+ months scores 100. Never-played games are treated as 365 days.

**Preference multiplier** (0.5–2.0): The blended preference signal — affinity (revealed) plus rating (stated). Games the group loves get their due-ness amplified; games they've rated low get it suppressed; games with neither signal are left at face value.

```
affinity     = Σ over the group's past sessions of this game  0.5 ^ (daysAgo / 180)
affinityNorm = affinity / (max affinity across the catalogue, for this group)    // 0–1, boost-only
ratingSignal = (groupRating - 3) / 2     // 1★ → -1, 3★ → 0, 5★ → +1; 0 if unrated (neutral)

preferenceMultiplier = clamp(
    1 + AFFINITY_WEIGHT * affinityNorm + RATING_WEIGHT * ratingSignal,
    0.5, 2.0
)                                         // AFFINITY_WEIGHT = 0.5, RATING_WEIGHT = 0.5
```

- **Affinity** — each past play contributes weight that **halves every ~180 days**, so a game the group has chosen a lot _recently_ counts as a stronger favourite than one they binged years ago and dropped. This keeps "favourite" meaning _currently beloved_, not _historically over-played_. Affinity is normalised to 0–1, so it can only **boost**.
- **Rating** — the group's mean enjoyment rating, **centred** on 3★ so it can boost _or_ suppress. A low rating drives the multiplier toward (and below) 1.0, actively pushing disliked games down — the one thing affinity alone can never do. A game **nobody in the group has rated** contributes 0 (neutral), so the multiplier gracefully degrades to pure affinity — no cold-start cliff.
- With both weights at 0.5 the natural range lands exactly on the [0.5, 2.0] bounds, so the clamp is a safety net:

| Scenario                                   | affinityNorm | ratingSignal | Multiplier | Effect                         |
| ------------------------------------------ | ------------ | ------------ | ---------- | ------------------------------ |
| Played a lot **and** loved (5★)            | 1.0          | +1.0         | 2.0        | strongly surfaced              |
| Rarely played but loved (5★) — latent love | ~0.1         | +1.0         | ~1.55      | boosted despite low play count |
| Played a lot out of **habit**, rated 2★    | 1.0          | −0.5         | 1.25       | habit boost **tempered**       |
| Unrated, middling play history             | 0.4          | 0 (neutral)  | 1.2        | pure affinity                  |
| Rarely played **and** disliked (1★)        | 0.0          | −1.0         | 0.5        | suppressed                     |

- Crucially the multiplier scales recency, so a beloved game played yesterday still scores near zero — we don't re-suggest what we just played.
- `AFFINITY_WEIGHT` (how much revealed habit matters) and `RATING_WEIGHT` (how much stated enjoyment matters) are the tunable knobs. Set `RATING_WEIGHT = 0` and this is exactly the affinity-only design — which is how it ships initially, per the phasing note in [game-ratings.md](game-ratings.md).

**Variety bonus** (+30): Applied if the game has been played fewer than 3 times ever. Encourages trying new additions to the catalogue. (This deliberately pulls the other way from the preference multiplier — that's the explore/exploit balance working as intended.)

**Never-played bonus** (+50): Applied if `totalPlays === 0`. Stacks with variety bonus.

**Never-won bonus** (+20 per player): For each player in `playerIds` who has never won this game (regardless of how many times they've played it), add 20 to the score. Capped at +60 total (3 players × 20). This surfaces fairness: "nobody's really dominated this one yet."

**Pairing bonus** (0–25): Only when `afterGameId` is provided. Rewards games that historically follow the just-finished game (see below).

```
pairProbability = pairCount[afterGameId → game] / (total sessions that followed afterGameId)
pairingBonus    = PAIRING_WEIGHT * pairProbability        // PAIRING_WEIGHT = 25
```

- Surfaces the group's natural sequences — e.g. a heavy euro followed by a quick filler, or "we always close the night with The Crew."
- Requires at least 3 observed transitions out of `afterGameId` before it fires, so one-off coincidences don't drive suggestions.

### Step 4: Build reasons

For each suggestion, build a human-readable reason list (max 2 reasons), chosen from whichever signals contributed most to the score, in this priority order:

1. Rating: `"Highly rated by the group (4.5★)"` (only if `groupRating ≥ 4`).
2. Favourite: `"One of your favourites — X plays"` (only if `affinityNorm` is high, e.g. top quartile).
3. Pairing: `"You often follow <AfterGame> with this"` (only if the pairing bonus fired).
4. Recency: `"Last played X days ago"` / `"Never played"` / `"Played once"` etc.
5. Variety / never-played: `"Only played twice ever"` / `"Never played"`.
6. Never-won: `"<Name> has never won this"` (only if `playerIds` were provided and the never-won bonus fired).

If both the rating and favourite reasons apply, prefer the rating reason — stated enjoyment is the more direct signal. Suppressed (low-rated) games simply don't reach the top N, so they need no reason.

Take the top 2 that apply. Every suggestion must end up with at least one reason (recency is the always-available fallback).

---

## Pairing signal — "what we play after what"

The session history is an ordered timeline (`Session.playedOn`), so we can learn the group's habits, not just their preferences.

**Where the data comes from:** two sessions are part of the same _ordering_ when one game was played and then another was played next — either later the same night (multiple sessions share a `playedOn` date = one game night) or on the next game night. For each game `A`, count how often each game `B` was the very next thing the group played. That yields a transition table `pairCount[A → B]`.

**How it's used today:** the `after` option lets a user say "we just finished Wingspan — what next?", and the engine boosts the games that usually follow it. This is the most reliable use because the group explicitly tells us the anchor game.

**Why it's its own opt-in signal:** without an anchor (`afterGameId`) there's nothing to transition _from_, so the pairing bonus is simply 0 and the rest of the algorithm behaves exactly as before. No anchor, no harm.

**Future extensions this unlocks** (not in scope now, but the transition table makes them cheap):

- **Auto-anchor:** if `/suggest` is run and the group has _already_ logged a session earlier tonight, use that game as the anchor automatically.
- **Opener vs. closer profiling:** games that frequently start a night vs. end one. Could tailor suggestions to the time of evening.
- **Companion sets:** clusters of games that tend to co-occur on the same night, surfaced as "you usually pair these."

---

## Bot implementation

### Parsing players from the command

The `players` option receives a space-separated string of Discord mentions (e.g. `@Alice @Bob`). Parse them identically to how `/logplay` parses its `players` option — resolve each mention to a Player via `discordUserId`, creating new players if needed.

If `players` is omitted, do not pass `playerIds` to the backend. The preference signal (affinity and ratings alike) then uses the whole roster's history, and the never-won bonus is skipped.

### The `after` option

`after` is a free-text game name with autocomplete sourced from the catalogue (same autocomplete used by `/logplay`). Resolve it to a Game id and pass it as `afterGameId`. If it doesn't resolve, ignore it silently (still return suggestions) rather than erroring.

### Embed format

```
🎲 Tonight's suggestions (4 players)

1. Wingspan
   → Highly rated by the group (4.5★) • Last played 24 days ago

2. Cascadia
   → You often follow Wingspan with this • Last played 31 days ago

3. Azul
   → Only played twice ever

React with 🎲 on the one you want to play!
```

- Show the BGG thumbnail of the top suggestion as the embed thumbnail if available.
- If `after` was supplied, mention it in the embed footer: `"Paired with what follows Wingspan."`
- If no games match the player count filter, reply: "No games in the catalogue fit X players. Add more games with `/addgame`."
- If the catalogue has fewer games than `count`, return all of them.

---

## Acceptance criteria

- [ ] `/suggest` returns 3 suggestions by default.
- [ ] `/suggest count:5` returns 5 suggestions.
- [ ] `/suggest players:@alice @bob` filters by player count (2) and applies the never-won bonus.
- [ ] Games with `minPlayers`/`maxPlayers` set are correctly filtered by player count.
- [ ] Games not in the catalogue do not appear.
- [ ] A frequently-chosen game that's due for a replay ranks above an equally-neglected game the group rarely picks (affinity term).
- [ ] A highly-rated game (group avg ≥ 4) that's due for a replay outranks an equally-due game with a low/no rating (rating term).
- [ ] A low-rated game (group avg ≤ 2) is pushed **down** relative to where recency + affinity alone would place it.
- [ ] A frequently-played game rated **low** has its affinity boost tempered (ranks below where affinity alone would put it).
- [ ] A game **no one in the group has rated** falls back to affinity-only behaviour (rating term contributes 0) — sensible results before any ratings exist.
- [ ] A favourite (or highly-rated game) played within the last few days does **not** get re-suggested to the top (multiplier scales recency, so it still scores low).
- [ ] Never-played games still rank highly, all else being equal (exploration is preserved).
- [ ] Affinity and ratings are both group-scoped: `/suggest players:@alice @bob` uses only Alice's and Bob's plays and ratings.
- [ ] Setting `RATING_WEIGHT = 0` reproduces the affinity-only suggestions.
- [ ] `/suggest after:Wingspan` boosts games that historically follow Wingspan; without `after`, the pairing bonus never fires.
- [ ] The pairing bonus does not fire on fewer than 3 observed transitions out of the anchor game.
- [ ] Each suggestion shows at least one reason.
- [ ] If fewer games exist than requested, returns all available.
- [ ] Friendly error if no games fit the player count.

---

## Notes & decisions

- **No ML/AI required.** The scoring is deterministic and transparent. Users can see _why_ a game was suggested, which builds trust in the feature.
- **Preference blends revealed and stated signals.** Affinity (the group voting with their game nights — auto-updating, no cold start) answers _"what do we keep reaching for?"_; ratings (from [game-ratings.md](game-ratings.md)) answer _"what do we actually enjoy, and what should we avoid?"_ They're complementary, so both are kept: affinity is boost-only, the rating term is centred so it can also suppress. The blend's most useful emergent behaviour: a game played often out of **habit** but rated low gets its affinity boost **tempered** — ratings can correct a lazy default that revealed preference alone would keep entrenching.
- **Recency-weighted, not raw, play counts.** A raw count would crown whatever was over-played years ago and conflate "favourite" with "stale default." The 180-day half-life keeps the affinity signal pointed at what the group loves _now_.
- **Preference is group-scoped.** When `playerIds` are given, affinity only counts sessions involving that group, and the rating average only counts those players' ratings — so the suggestions reflect what _these particular people_ enjoy together, which may differ from the household average.
- **Multiplier, not flat bonus, for preference.** A flat "+50 if loved" would re-suggest a beloved game the night after playing it. Scaling the recency (due-ness) base instead means loved games only surface when they're actually due. This is the heart of the explore/exploit balance.
- **Sub-1.0 range is the point.** Letting the rating term drive the multiplier below 1.0 is what lets a low rating _suppress_ a game — the capability affinity lacks and the main reason ratings feed `/suggest`.
- **Scores are not shown to users.** Only the reasons are shown; scores are internal.
- **The never-won bonus does not require all players in `playerIds` to have never won** — it fires per player. One player who's never won adds 20 points; three players add 60.
- **Three tunable knobs.** `AFFINITY_WEIGHT` (how much revealed habit matters), `RATING_WEIGHT` (how much stated enjoyment matters), and `PAIRING_WEIGHT` (how much sequencing matters). All can be tuned without touching the rest of the algorithm. Per the phasing plan in [game-ratings.md](game-ratings.md), ship with `RATING_WEIGHT = 0` (affinity-only), let ratings accumulate over a few game nights, then raise it to switch the blend on — no code change, just the knob.
- **Recency cap at 180 days:** avoids games that haven't been played in years dominating forever. The algorithm naturally surfaces neglected-but-not-forgotten games.
- **Future extension:** once score tracking is live, add a "close games" signal — games where the winning margin was small tend to be more exciting. Not in scope now.
