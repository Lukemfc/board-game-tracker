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
  bggId          Int?     // already exists
  // add:
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
6. Bot replies with a confirmation embed showing the game name, thumbnail, and player counts.

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
- For each game in the collection, upserts it into `Game` table using `bggId` as the unique key (not name — names can differ).
- Enriches any existing games that have a matching `bggId` but missing thumbnail/description.
- Returns `{ created: number, enriched: number, skipped: number }`.

### New bot commands

**`/linkbgg username:<text>`**

- Calls `POST /players/:id/bgg-link` for the invoking Discord user.
- Ephemeral confirmation: "Linked to BGG account `<username>`".
- Idempotent — calling again with a different username updates it.

**`/importcollection`**

- Requires the user to have linked a BGG username first (error if not).
- Calls `POST /players/:id/bgg-import`.
- Shows a progress message while waiting (BGG can be slow).
- Confirmation embed: "Imported 42 games (12 new, 30 enriched)".

---

## Acceptance criteria

- [ ] `/addgame name:Wingspan` shows a BGG search select menu.
- [ ] Selecting a game from the menu creates it with `bggId`, `minPlayers`, `maxPlayers`, `yearPublished`, `bggThumbnail`.
- [ ] "Add manually" fallback works as before.
- [ ] `/linkbgg username:myBggName` links and validates the BGG account.
- [ ] `/importcollection` imports the linked user's owned games into the catalogue.
- [ ] BGG API errors (unreachable, 202 timeout) surface as friendly Discord messages, not crashes.
- [ ] Re-running `/importcollection` is idempotent (doesn't duplicate games).

---

## Notes & decisions

- **upsert key for games:** use `bggId` when present, fall back to `name`. This avoids creating duplicates when a game was already added manually before BGG enrichment.
- **Rate limiting:** BGG throttles aggressively. Add a 1-second delay between bulk requests during collection import, and don't fire all requests in parallel.
- **Private collections:** BGG collections can be set to private. If the API returns a 403, surface a helpful error: "Your BGG collection is private. Make it public at boardgamegeek.com/…".
- **BGG username in `/stats`:** once linked, the stats embed can show a "View on BGG" link.
