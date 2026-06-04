# Feature: What Should We Play Tonight?

**Status:** Planned  
**Priority:** Medium  
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)

---

## Goal

A `/suggest` Discord command that recommends games from the catalogue based on who's playing, what hasn't been played in a while, and variety — so the group doesn't always default to the same three games.

---

## Discord command

```
/suggest [players:@alice @bob @charlie] [count:4]
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `players` | Mention string | No | Who's playing tonight. If omitted, uses the full player roster. |
| `count` | Integer (1–6) | No | Number of suggestions to return. Default 3. |

The command replies with a public embed listing the top suggestions, each with a one-line reason.

---

## New backend endpoint

```
GET /stats/suggest?playerCount=<n>&playerIds=<id1,id2,...>&limit=<n>
```

| Query param | Required | Description |
|-------------|----------|-------------|
| `playerCount` | No | Filter by player count (uses `minPlayers`/`maxPlayers` on Game). Falls back to `playerIds` length if provided. |
| `playerIds` | No | Comma-separated Player IDs. Used for recency and "who hasn't won" checks. |
| `limit` | No | Number of results to return. Default 5. |

**Response:**

```json
{
  "suggestions": [
    {
      "game": { "id": "...", "name": "Wingspan", "bggThumbnail": "..." },
      "score": 142,
      "reasons": ["Last played 38 days ago", "Alice has never won this"]
    },
    {
      "game": { "id": "...", "name": "Ticket to Ride" },
      "score": 118,
      "reasons": ["Only played twice ever", "Bob's most played but hasn't won recently"]
    }
  ]
}
```

---

## Scoring algorithm

The endpoint computes a **suggestion score** for every game in the catalogue, then returns the top N.

### Step 1: Gather data

For each game, fetch:
- `lastPlayedAt` — date of the most recent session for this game (or `null` if never played).
- `totalPlays` — total number of sessions ever.
- `recentWinners` — for each player in `playerIds`, whether they've won this game in the last 90 days.

### Step 2: Filter by player count

If `playerCount` is provided and the game has `minPlayers` or `maxPlayers` set, exclude games where `playerCount < minPlayers` or `playerCount > maxPlayers`. If those fields are not set on the game, do not exclude it.

### Step 3: Compute score

```
score = recencyScore + varietyBonus + neverWonBonus
```

**Recency score** (0–100): How long since the game was last played.
```
daysSinceLastPlayed = today - lastPlayedAt   (or 365 if never played)
recencyScore = min(daysSinceLastPlayed, 180) / 180 * 100
```
- A game played today scores 0. A game not played for 6+ months scores 100. Never-played games are treated as 365 days.

**Variety bonus** (+30): Applied if the game has been played fewer than 3 times ever. Encourages trying new additions to the catalogue.

**Never-played bonus** (+50): Applied if `totalPlays === 0`. Stacks with variety bonus.

**Never-won bonus** (+20 per player): For each player in `playerIds` who has never won this game (regardless of how many times they've played it), add 20 to the score. Capped at +60 total (3 players × 20). This surfaces fairness: "nobody's really dominated this one yet."

### Step 4: Build reasons

For each suggestion, build a human-readable reason list (max 2 reasons):
1. Recency: `"Last played X days ago"` / `"Never played"` / `"Played once"` etc.
2. Never-won: `"<Name> has never won this"` (only if `playerIds` were provided and the never-won bonus fired).

Reasons are sorted: recency first, then never-won.

---

## Bot implementation

### Parsing players from the command

The `players` option receives a space-separated string of Discord mentions (e.g. `@Alice @Bob`). Parse them identically to how `/logplay` parses its `players` option — resolve each mention to a Player via `discordUserId`, creating new players if needed.

If `players` is omitted, do not pass `playerIds` to the backend (the backend will not apply the never-won bonus, only recency and variety).

### Embed format

```
🎲 Tonight's suggestions (4 players)

1. Wingspan
   → Last played 38 days ago • Alice has never won this

2. Azul
   → Never played

3. Ticket to Ride
   → Only played once

React with 🎲 on the one you want to play!
```

- Show the BGG thumbnail as the embed thumbnail if available.
- If no games match the player count filter, reply: "No games in the catalogue fit X players. Add more games with `/addgame`."
- If the catalogue has fewer games than `count`, return all of them.

---

## Acceptance criteria

- [ ] `/suggest` returns 3 suggestions by default.
- [ ] `/suggest count:5` returns 5 suggestions.
- [ ] `/suggest players:@alice @bob` filters by player count (2) and applies never-won bonus.
- [ ] Games with `minPlayers`/`maxPlayers` set are correctly filtered by player count.
- [ ] Games not in the catalogue do not appear.
- [ ] Never-played games rank highest, all else being equal.
- [ ] Each suggestion shows at least one reason.
- [ ] If fewer games exist than requested, returns all available.
- [ ] Friendly error if no games fit the player count.

---

## Notes & decisions

- **No ML/AI required.** The scoring is deterministic and transparent. Users can see *why* a game was suggested, which builds trust in the feature.
- **Scores are not shown to users.** Only the reasons are shown; scores are internal.
- **The never-won bonus does not require all players in `playerIds` to have never won** — it fires per player. One player who's never won adds 20 points; three players add 60.
- **Future extension:** once score tracking is live, add a "close games" signal — games where the winning margin was small tend to be more exciting. Not in scope now.
- **Recency cap at 180 days:** avoids games that haven't been played in years dominating forever. The algorithm naturally surfaces neglected-but-not-forgotten games.
