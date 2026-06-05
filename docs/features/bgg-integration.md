# Feature: BoardGameGeek Integration

**Status:** Planned  
**Priority:** High  
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)

---

## Goal

Let players use BoardGameGeek (BGG) as the source of truth for game data, so nobody has to type game names, player counts, or descriptions by hand. Two capabilities:

1. **BGG game search** — when adding a game via `/addgame`, search BGG and pick from results instead of typing manually.
2. **BGG collection import** — link your BGG username to your player profile and import your owned games in bulk.

---

## Background: BGG XML API v2

BGG provides a free, no-auth-required XML API.

| Purpose         | Endpoint                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------ |
| Search games    | `https://boardgamegeek.com/xmlapi2/search?query=<name>&type=boardgame`                     |
| Game details    | `https://boardgamegeek.com/xmlapi2/thing?id=<bggId>&stats=1`                               |
| User collection | `https://boardgamegeek.com/xmlapi2/collection?username=<username>&own=1&subtype=boardgame` |

**Important quirk:** The collection endpoint sometimes returns HTTP `202 Accepted` (request queued). The client must poll until it gets `200`. Implement a retry loop with a 2-second delay, up to ~5 attempts.

Use a lightweight XML parser (e.g. `fast-xml-parser` or `xml2js`) in the backend. Do **not** call BGG from the bot directly — all external HTTP goes through the backend API.

---

## Schema changes

```prisma
model Game {
  // existing fields...
  name           String   // the group's simple, human-friendly name — NEVER overwritten by BGG
  bggId          Int?     // already exists
  // add:
  bggName        String?  // BGG's canonical (often verbose) name, kept for reference/search only
  bggThumbnail   String?  // URL to BGG thumbnail image
  description    String?  // BGG short description
  yearPublished  Int?     // year the game was published
}

model Player {
  // existing fields...
  // add:
  bggUsername    String?  @unique  // BGG username, for collection import
}
```

Migration: `pnpm prisma migrate dev --name add-bgg-fields`

> **Naming rule (applies everywhere below):** `Game.name` is the name your group chose and always wins. BGG data only ever _fills in_ `bggName`, `bggId`, `bggThumbnail`, `description`, and `yearPublished` — it must never touch `name`. If a game has no local name yet (created straight from BGG), we seed `name` from the BGG name once; after that it's owned by you.

---

## Fuzzy matching — reconciling BGG games with existing entries

The whole point: BGG games must **link to** the games we already have, not create parallel duplicates with verbose BGG names. Before creating any game from BGG data, we run a match against the existing catalogue.

### Match order (first hit wins)

1. **Exact `bggId` match** — already linked, just enrich. Most reliable.
2. **Fuzzy name match** — normalise both sides and compare similarity. Used when a game was added manually before any BGG link existed (the common case for this group).
3. **No match** — create a new game, seeding `name` from the BGG name (the only time BGG sets `name`).

### Normalisation (before comparing)

- lowercase
- strip a trailing `(YYYY)` year suffix, e.g. `Catan (1995)` → `catan`
- strip edition/expansion noise: `:`, `–`, `the`, `edition`, leading/trailing whitespace, collapse repeated spaces
- drop punctuation

### Similarity

- Use a small, well-tested library — `string-similarity` (Dice coefficient) or Levenshtein distance via `fastest-levenshtein`. No need for anything heavier.
- Compare the **local `name`** _and_ the existing `bggName` (if any) against the incoming BGG name; take the best score.
- **Threshold:** `>= 0.8` → confident auto-link. `0.6–0.8` → ambiguous, do **not** auto-link silently (see below). `< 0.6` → treat as no match.

### Handling ambiguous matches

- **In `/addgame` (interactive):** if a fuzzy match lands in the 0.6–0.8 band, surface it to the user — "This looks like your existing **Catan**. Link to it, or add as a new game?" — and let them decide. Never silently merge on a weak score.
- **In `/importcollection` (bulk):** ambiguous matches are **not** auto-linked. Count them as `skipped` and include them in a "needs review" list in the result so a human can reconcile later. We'd rather skip than wrongly merge two different games.

Put the matching logic in one shared helper (e.g. `packages/shared/src/bggMatch.ts`) so both search and import use identical rules, and unit-test it against real examples (`Catan` vs `CATAN`, `Ticket to Ride` vs `Ticket to Ride: Europe`, etc.).

---

## Phase 1 — BGG search in `/addgame`

### New backend route

```
GET /games/bgg-search?query=<name>
```

- Calls BGG search API, returns top 10 results.
- For each result: `{ bggId, name, yearPublished, thumbnail }`.
- Cache responses in-memory (5-minute TTL) to avoid hammering BGG.
- If BGG is unreachable, return a 503 with a clear message.

```
GET /games/bgg/:bggId
```

- Fetches full game details from BGG for a given `bggId`.
- Returns: `{ bggId, name, minPlayers, maxPlayers, yearPublished, thumbnail, description }`.
- Used to enrich an existing game or pre-fill a new one.

### Updated `POST /games`

Accept the new optional fields (`bggThumbnail`, `description`, `yearPublished`) in the create/upsert payload. Update the shared Zod schema in `packages/shared` accordingly.

### Updated bot `/addgame` command

Replace the current single text-input flow with:

1. User types `/addgame name:Wingspan`
2. Bot calls `GET /games/bgg-search?query=Wingspan`
3. Bot shows an **ephemeral select menu** (up to 10 results), each option showing `Name (Year)` e.g. `Wingspan (2019)`.
4. User picks one.
5. Bot calls `GET /games/bgg/:bggId` to fetch full details, then `POST /games` with all fields populated.
6. **Before creating**, the backend runs the fuzzy match (see above). If it finds a confident match to an existing game, it **enriches that game** (sets `bggId`, `bggName`, thumbnail, etc.) and keeps the existing `name` — it does not create a duplicate. If the match is ambiguous, the bot asks the user to confirm linking vs. adding new.
7. Bot replies with a confirmation embed showing the game name (the group's name, never the verbose BGG one), thumbnail, and player counts. If an existing game was enriched rather than created, say so: "Linked **Catan** to BGG and added artwork."

**Fallback (can't find on BGG):** include a "Add manually" option at the bottom of the select menu that falls back to the original behaviour (name only, no enrichment).

**Autocomplete:** the existing autocomplete on `/logplay game:` should now also check BGG if no local match is found, and offer to create-from-BGG on the fly.

---

## Phase 2 — BGG collection import

### New backend routes

```
POST /players/:id/bgg-link
Body: { bggUsername: string }
```

- Validates the BGG username exists (call `GET /collection?username=<x>&own=1` — a 200 response means valid).
- Saves `bggUsername` to the Player record.
- Returns the updated player.

```
POST /players/:id/bgg-import
```

- Fetches the player's BGG collection (`own=1`).
- For each game in the collection, run the match order from the **Fuzzy matching** section:
  - **`bggId` match** → enrich (fill missing `bggName`/thumbnail/description/year). Never touch `name`.
  - **Confident fuzzy match (≥ 0.8)** → link `bggId` + `bggName` to the existing local game and enrich. **Keep the local `name`.**
  - **Ambiguous (0.6–0.8)** → skip and record for review; do not auto-merge.
  - **No match** → create a new game, seeding `name` from the BGG name (the one allowed case).
- **Never overwrites `name` on an existing game.** BGG only ever populates the `bgg*`/`description`/`yearPublished` fields. The verbose BGG name lives in `bggName`; the group's chosen name in `name` is untouchable.
- **Naming of brand-new imports:** games the group has never logged before are created with BGG's name as their `name` (there's nothing local to keep). They're immediately usable — no manual step is required to log plays — but the name may be BGG's verbose one (e.g. `Ticket to Ride: Europe`). Use **`/renamegame`** afterwards to switch any of these to the group's simpler name. The import summary calls out how many new games were created so they're easy to find.
- Returns `{ created: number, enriched: number, linked: number, skipped: number, needsReview: Array<{ bggName, candidateName, score }> }`.

### New bot commands

**`/linkbgg username:<text>`**

- Calls `POST /players/:id/bgg-link` for the invoking Discord user.
- Ephemeral confirmation: "Linked to BGG account `<username>`".
- Idempotent — calling again with a different username updates it.

**`/importcollection`**

- Requires the user to have linked a BGG username first (error if not).
- Calls `POST /players/:id/bgg-import`.
- Shows a progress message while waiting (BGG can be slow).
- Confirmation embed: "Imported 42 games (12 new, 18 linked to existing, 12 enriched)". When new games are created, the embed reminds the user they carry BGG's name and can be fixed with `/renamegame`. If any games need review, add a line: "3 games looked similar to ones you already have — left untouched: _Catan, …_. Use `/addgame` to link them manually." Existing names are never changed by the import.

**`/renamegame game:<autocomplete> newname:<text>`**

- Renames a catalogue game to the group's preferred name. `game` autocompletes from the local catalogue; `newname` is the new simple name.
- Calls `PATCH /games/:id` (the `:id` segment accepts a game id or current name).
- Only changes `name` — `bggId`/`bggName` and other enrichment are left intact, so the BGG link survives the rename.
- Rejects a rename that collides with another game's name (409 → friendly message).

---

## Acceptance criteria

- [ ] `/addgame name:Wingspan` shows a BGG search select menu.
- [ ] Selecting a game from the menu creates it with `bggId`, `minPlayers`, `maxPlayers`, `yearPublished`, `bggThumbnail`.
- [ ] "Add manually" fallback works as before.
- [ ] `/linkbgg username:myBggName` links and validates the BGG account.
- [ ] `/importcollection` imports the linked user's owned games into the catalogue.
- [ ] BGG API errors (unreachable, 202 timeout) surface as friendly Discord messages, not crashes.
- [ ] Re-running `/importcollection` is idempotent (doesn't duplicate games).
- [ ] A game added manually as `Catan` is **linked**, not duplicated, when its BGG entry (`CATAN`) is imported — and its `name` stays `Catan`.
- [ ] No BGG operation (search-create, enrich, or import) ever changes an existing game's `name`.
- [ ] Ambiguous fuzzy matches (0.6–0.8) are surfaced for confirmation in `/addgame` and reported as needs-review (not auto-merged) in `/importcollection`.
- [ ] The fuzzy-match helper has unit tests covering case, year suffixes, and edition/expansion variants.
- [ ] Brand-new games from a bulk import are immediately loggable (their `name` is populated from BGG, not blank).
- [ ] `/renamegame` changes a game's `name` without dropping its BGG link, and rejects name collisions.

---

## Notes & decisions

- **upsert key for games:** match in this order — `bggId`, then a fuzzy name match (≥ 0.8 confident), then create new. This avoids creating duplicates when a game was already added manually before BGG enrichment. See the **Fuzzy matching** section for the full rules.
- **names are sacred:** `Game.name` is owned by the group and BGG never overwrites it. BGG's verbose name is stored separately in `bggName` (used for matching/reference). The only time BGG sets `name` is when creating a brand-new game that matched nothing locally.
- **Rate limiting:** BGG throttles aggressively. Add a 1-second delay between bulk requests during collection import, and don't fire all requests in parallel.
- **Private collections:** BGG collections can be set to private. If the API returns a 403, surface a helpful error: "Your BGG collection is private. Make it public at boardgamegeek.com/…".
- **BGG username in `/stats`:** once linked, the stats embed can show a "View on BGG" link.
