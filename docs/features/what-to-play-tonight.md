# Feature: What Should We Play Tonight?

**Status:** Planned  
**Priority:** Medium  
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)

---

## Goal

A `/suggest` Discord command that recommends games from the catalogue based on who's playing, what's due for a replay, variety — and, importantly, **what this group actually loves to play**. The whole point is to nudge the group toward a good night, not to mechanically rotate through the shelf.

The data already tells us which games are favourites: nobody is forced to play anything, so a game that's been **freely chosen many times over the alternatives** is, by revealed preference, a favourite. The suggestion engine should lean into that signal rather than fight it.

---

## The exploration ↔ exploitation tension

The naive version of this feature only rewarded neglect and novelty (play the thing we haven't touched in months, try the new box). Left unchecked, that actively buries the group's favourites — which is the opposite of a good recommendation. A favourite that's "due" for another outing should beat a mediocre game that happens to be equally neglected.

So the engine balances two pulls:

- **Exploitation** — surface beloved games when they're due. Driven by the new **favourite (affinity) signal**.
- **Exploration** — keep variety alive: neglected games, new additions, fairness. Driven by recency, variety, and never-won signals.

The trick is to make "favourite" interact with "due-ness" rather than override it: a favourite played _last night_ should still score low (we just played it), but a favourite we haven't played in three weeks should leap ahead of a so-so game we also haven't played in three weeks.

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
| `playerIds`   | No       | Comma-separated Player IDs. Used for the favourite signal, recency, and never-won checks (all group-scoped).   |
| `afterGameId` | No       | A game just played. Adds a pairing bonus to games that historically follow it. Omit to skip pairing.           |
| `limit`       | No       | Number of results to return. Default 5.                                                                        |

**Response:**

```json
{
  "suggestions": [
    {
      "game": { "id": "...", "name": "Wingspan", "bggThumbnail": "..." },
      "score": 168,
      "reasons": ["One of your favourites — 21 plays", "Last played 24 days ago"]
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
- `affinity` — a **recency-weighted play count** for the group (see below). This is the "favourite" measure.
- `recentWinners` — for each player in `playerIds`, whether they've won this game in the last 90 days.
- `pairCount[afterGameId → game]` — how often this game has historically followed `afterGameId` (see "Pairing signal").

### Step 2: Filter by player count

If `playerCount` is provided and the game has `minPlayers` or `maxPlayers` set, exclude games where `playerCount < minPlayers` or `playerCount > maxPlayers`. If those fields are not set on the game, do not exclude it.

### Step 3: Compute score

```
score = recencyScore * favouriteMultiplier
      + varietyBonus
      + neverWonBonus
      + pairingBonus
```

**Recency score** (0–100): How long since the game was last played. This is the "due-ness" base that the favourite multiplier scales.

```
daysSinceLastPlayed = today - lastPlayedAt   (or 365 if never played)
recencyScore = min(daysSinceLastPlayed, 180) / 180 * 100
```

- A game played today scores 0. A game not played for 6+ months scores 100. Never-played games are treated as 365 days.

> **Amended:** the [Game Enjoyment Ratings](game-ratings.md) feature **blends** a stated-preference rating signal into this multiplier, producing a combined `preferenceMultiplier` (0.5–2.0). Affinity (described below) is kept as-is and remains boost-only; the rating term is added on top and, being centred, can also push a game _below_ 1.0 to suppress disliked games. The mechanic (a multiplier that scales recency) is unchanged.

**Favourite multiplier** (1.0–2.0): The revealed-preference signal. Games the group freely returns to get their due-ness amplified; games they rarely choose are left at face value.

```
affinity     = Σ over the group's past sessions of this game  0.5 ^ (daysAgo / 180)
affinityNorm = affinity / (max affinity across the catalogue, for this group)   // 0–1
favouriteMultiplier = 1 + FAVOURITE_WEIGHT * affinityNorm                        // FAVOURITE_WEIGHT = 1.0
```

- Each past play contributes weight that **halves every ~180 days**, so a game the group has chosen a lot _recently_ counts as a stronger favourite than one they binged years ago and dropped. This keeps "favourite" meaning _currently beloved_, not _historically over-played_.
- The top favourite gets up to a **2× boost** to its due-ness; a never-chosen game gets 1× (no boost). Crucially the multiplier scales recency, so a favourite played yesterday still scores near zero — we don't re-suggest what we just played.
- `FAVOURITE_WEIGHT` is a single tunable knob for how hard the engine leans on favourites vs. exploration.

**Variety bonus** (+30): Applied if the game has been played fewer than 3 times ever. Encourages trying new additions to the catalogue. (This deliberately pulls the other way from the favourite multiplier — that's the explore/exploit balance working as intended.)

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

1. Favourite: `"One of your favourites — X plays"` (only if `affinityNorm` is high, e.g. top quartile).
2. Pairing: `"You often follow <AfterGame> with this"` (only if the pairing bonus fired).
3. Recency: `"Last played X days ago"` / `"Never played"` / `"Played once"` etc.
4. Variety / never-played: `"Only played twice ever"` / `"Never played"`.
5. Never-won: `"<Name> has never won this"` (only if `playerIds` were provided and the never-won bonus fired).

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

If `players` is omitted, do not pass `playerIds` to the backend. The favourite signal then uses the whole roster's history, and the never-won bonus is skipped.

### The `after` option

`after` is a free-text game name with autocomplete sourced from the catalogue (same autocomplete used by `/logplay`). Resolve it to a Game id and pass it as `afterGameId`. If it doesn't resolve, ignore it silently (still return suggestions) rather than erroring.

### Embed format

```
🎲 Tonight's suggestions (4 players)

1. Wingspan
   → One of your favourites (21 plays) • Last played 24 days ago

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
- [ ] A frequently-chosen game that's due for a replay ranks above an equally-neglected game the group rarely picks (favourite multiplier).
- [ ] A favourite played within the last few days does **not** get re-suggested to the top (multiplier scales recency, so it still scores low).
- [ ] Never-played games still rank highly, all else being equal (exploration is preserved).
- [ ] `/suggest after:Wingspan` boosts games that historically follow Wingspan; without `after`, the pairing bonus never fires.
- [ ] The pairing bonus does not fire on fewer than 3 observed transitions out of the anchor game.
- [ ] Each suggestion shows at least one reason.
- [ ] If fewer games exist than requested, returns all available.
- [ ] Friendly error if no games fit the player count.

---

## Notes & decisions

- **No ML/AI required.** The scoring is deterministic and transparent. Users can see _why_ a game was suggested, which builds trust in the feature.
- **Favourites come from revealed preference, not a setting.** We never ask "what are your favourites?" — the group voting with their game nights is a far better signal than a manual flag, and it stays current automatically.
- **Recency-weighted, not raw, play counts.** A raw count would crown whatever was over-played years ago and conflate "favourite" with "stale default." The 180-day half-life keeps the favourite signal pointed at what the group loves _now_.
- **Favourite is group-scoped.** When `playerIds` are given, affinity only counts sessions involving that group — so the suggestions reflect what _these particular people_ enjoy together, which may differ from the household average.
- **Multiplier, not flat bonus, for favourites.** A flat "+50 if favourite" would re-suggest a beloved game the night after playing it. Scaling the recency (due-ness) base instead means favourites only surface when they're actually due. This is the heart of the explore/exploit balance.
- **Scores are not shown to users.** Only the reasons are shown; scores are internal.
- **The never-won bonus does not require all players in `playerIds` to have never won** — it fires per player. One player who's never won adds 20 points; three players add 60.
- **Two tunable knobs.** `FAVOURITE_WEIGHT` (how hard to lean on favourites) and `PAIRING_WEIGHT` (how much sequencing matters). Both can be tuned without touching the rest of the algorithm.
- **Recency cap at 180 days:** avoids games that haven't been played in years dominating forever. The algorithm naturally surfaces neglected-but-not-forgotten games.
- **Future extension:** once score tracking is live, add a "close games" signal — games where the winning margin was small tend to be more exciting. Not in scope now.
