# Board Game Tracker — Implementation Plan

> Turn the local board-game-night spreadsheet into a deployed, collaborative
> application. A backend API owns the data; multiple frontends talk to it. The
> **first frontend is a Discord bot**; a web app can be added later without
> touching the backend.
>
> Suggested product name: **Meeple Ledger** (rename freely).

## How to use this document

Build in **milestone order** (see §12). Each phase in §6 has a **Goal**,
concrete **Steps**, and an **Acceptance** check — treat acceptance as the
"done" definition before moving on. Tick boxes as you go.

---

## 1. Overview & Goals

**Problem.** Plays are tracked in a local Excel file: `date`, `game`,
`location`, `players`, `winner(s)`, `notes`. It can't be shared, edited
concurrently, or queried for stats, and only lives on one machine.

**Goal (v1).** A deployed service where the friend group can log plays and view
stats from Discord, backed by a real database, with historical data migrated in.

**Success criteria.**

- Anyone in the group can log a play from Discord in < 30 seconds.
- All historical spreadsheet rows are imported and queryable.
- Data persists in managed Postgres and survives restarts/redeploys.
- Stats available: per-player win rate, per-game play counts, recent activity, leaderboard.
- Architecture is frontend-agnostic so a web UI can be added later.

**Non-goals (v1).** Web/mobile UI, BoardGameGeek sync, ELO/ranking, auth beyond
a service token + Discord identity. All deferred to §13.

---

## 2. Chosen stack (decisions locked)

| Concern         | Choice                                                               | Notes                                                     |
| --------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Language        | **TypeScript** (Node 20+)                                            | One language across bot, API, and a future web frontend   |
| Discord bot     | **discord.js v14**                                                   | Most mature Discord library; slash commands + components  |
| Backend         | **Fastify** + **Zod**                                                | Fast, typed routes, schema validation shared with the bot |
| ORM / DB access | **Prisma**                                                           | Great TS DX, migrations, type-safe queries                |
| Database        | **PostgreSQL**                                                       | Relational — natural fit for "many players per session"   |
| Monorepo        | **pnpm workspaces**                                                  | `bot`, `backend`, `shared` packages in one repo           |
| Hosting         | **Managed platform** (Railway recommended; Render/Fly.io equivalent) | Push-to-deploy + managed Postgres                         |
| Tests           | **Vitest**                                                           | Unit + Fastify `inject` integration tests                 |
| CI              | **GitHub Actions**                                                   | typecheck, lint, test on PRs                              |

API style is **REST/JSON** (not tRPC) specifically to keep non-TypeScript
frontends possible later, per the "multiple frontends" requirement.

---

## 3. Architecture

```
                  ┌──────────────────────┐
                  │   Discord (friends)  │
                  └───────────┬──────────┘
                              │ slash commands / interactions
                  ┌───────────▼──────────┐
                  │   Discord Bot        │   packages/bot  (discord.js)
                  │   command handlers   │
                  └───────────┬──────────┘
                              │ HTTPS REST + service API key
                              │ (forwards the acting Discord user id)
                  ┌───────────▼──────────┐
                  │   Backend API        │   packages/backend (Fastify + Zod)
                  │   validation + logic │
                  └───────────┬──────────┘
                              │ Prisma
                  ┌───────────▼──────────┐
                  │   PostgreSQL         │   managed (Railway/Render/Fly)
                  └──────────────────────┘

  Shared Zod schemas + TS types live in packages/shared and are imported by
  BOTH the bot and the backend, so request/response shapes can never drift.

  Future web/mobile frontends call the same Backend API.
```

**Why this shape.** The bot holds _no_ business logic or DB access — it only
renders Discord UI and calls the API. That keeps the rules in one place and
makes the second frontend cheap to add.

---

## 4. Data model

Entities and relationships:

- **Player** — a person. May or may not have a linked Discord account
  (`discordUserId` is nullable, so you can record "ghost" friends who aren't on
  Discord or pre-date their join).
- **Game** — an entry in the game catalogue.
- **Location** — where a session was played (own table → stats by location).
- **Session** — one play of one game on one date (the spreadsheet "row").
- **SessionPlayer** — join row: which players were in a session, who won, and an
  optional score. Supports **multiple winners** (teams / ties).

Prisma schema sketch (`packages/backend/prisma/schema.prisma`):

```prisma
model Player {
  id              String          @id @default(cuid())
  displayName     String
  discordUserId   String?         @unique
  createdAt       DateTime        @default(now())
  participations  SessionPlayer[]
  createdSessions Session[]       @relation("CreatedBy")
}

model Game {
  id         String    @id @default(cuid())
  name       String    @unique
  bggId      Int?      // BoardGameGeek id, for future enrichment
  minPlayers Int?
  maxPlayers Int?
  createdAt  DateTime  @default(now())
  sessions   Session[]
}

model Location {
  id       String    @id @default(cuid())
  name     String    @unique
  sessions Session[]
}

model Session {
  id          String          @id @default(cuid())
  playedOn    DateTime        // the date the game was played
  game        Game            @relation(fields: [gameId], references: [id])
  gameId      String
  location    Location?       @relation(fields: [locationId], references: [id])
  locationId  String?
  notes       String?
  createdBy   Player?         @relation("CreatedBy", fields: [createdById], references: [id])
  createdById String?
  createdAt   DateTime        @default(now())
  players     SessionPlayer[]

  @@index([gameId])
  @@index([playedOn])
}

model SessionPlayer {
  session   Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sessionId String
  player    Player  @relation(fields: [playerId], references: [id])
  playerId  String
  isWinner  Boolean @default(false)
  score     Int?

  @@id([sessionId, playerId])
  @@index([playerId])
}
```

> Cooperative games: for v1, either mark all players `isWinner = true` on a win,
> or none on a loss. If co-op becomes common, see the `outcome` enum idea in §14.

---

## 5. Repository layout

```
board-game-tracker/
├─ PLAN.md                      ← this file
├─ package.json                 ← workspace root (scripts, devDeps)
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .eslintrc.cjs / .prettierrc
├─ .env.example
├─ docker-compose.yml           ← local Postgres for dev
├─ .github/workflows/ci.yml
└─ packages/
   ├─ shared/                   ← Zod schemas + shared TS types
   │  └─ src/index.ts
   ├─ backend/                  ← Fastify API + Prisma
   │  ├─ prisma/schema.prisma
   │  ├─ prisma/seed.ts
   │  └─ src/
   │     ├─ server.ts
   │     ├─ config.ts
   │     ├─ prisma.ts
   │     ├─ auth.ts             ← service-token + Discord-user resolution
   │     ├─ routes/{players,games,locations,sessions,stats}.ts
   │     └─ scripts/import-xlsx.ts   ← Excel migration (Phase 5)
   └─ bot/                      ← discord.js
      └─ src/
         ├─ index.ts
         ├─ apiClient.ts        ← thin wrapper over the backend
         ├─ deploy-commands.ts
         └─ commands/{logplay,recent,games,addgame,players,linkme,stats,leaderboard}.ts
```

---

## 6. Step-by-step build plan

### Phase 0 — Prerequisites & accounts

**Goal.** Tools installed and external accounts ready.

1. Install: Node 20+ (use `nvm`), `pnpm` (`corepack enable`), Docker Desktop (local Postgres), Git.
2. Create a **Discord application + bot** at https://discord.com/developers/applications:
   - Copy the **bot token** and **application (client) id**.
   - Under OAuth2 → URL generator, select scopes `bot` + `applications.commands`, invite the bot to your server, and note the **server (guild) id**.

3. Create a **GitHub repo** and a host account (**Railway** recommended).

**Acceptance.** `node -v` ≥ 20, `pnpm -v` works, Docker runs, bot token in hand, empty repo pushed.

---

### Phase 1 — Repo & tooling

**Goal.** A clean, typechecking monorepo skeleton.

1. `pnpm init` at root; add `pnpm-workspace.yaml` listing `packages/*`.
2. Add `tsconfig.base.json` (strict mode), ESLint + Prettier, `.gitignore`, `.env.example`.
3. Scaffold the three packages (`shared`, `backend`, `bot`) each with their own `package.json` + `tsconfig.json` using project references.
4. Root scripts: `dev`, `build`, `lint`, `typecheck`, `test` (run recursively with `pnpm -r`).
5. First commit.

**Acceptance.** `pnpm -r typecheck` and `pnpm -r build` succeed on empty scaffolds.

---

### Phase 2 — Data model & database

**Goal.** Postgres running locally with the schema applied.

1. Add `docker-compose.yml` with a `postgres:16` service; document `DATABASE_URL`.
2. Add Prisma to `backend`; paste the schema from §4.
3. `pnpm prisma migrate dev --name init` → creates the DB + initial migration.
4. Write `prisma/seed.ts` (a few players, games, one sample session) and wire `prisma db seed`.
5. Verify with `pnpm prisma studio`.

**Acceptance.** Migration applies cleanly; Studio shows all tables; seed populates sample rows.

---

### Phase 3 — Backend API

**Goal.** A validated REST API over the data, locked behind a service token.

1. `shared`: define Zod schemas for create/update/read of each entity (e.g. `CreateSessionInput`) and export inferred TS types.
2. `backend`: Fastify server + `config.ts` (validate env with Zod), Prisma client singleton, `pino` logging.
3. Use `fastify-type-provider-zod` so routes validate input/output against the shared schemas.
4. Implement routes (see §7): players, games, locations, sessions (CRUD), stats.
5. `auth.ts`: require `Authorization: Bearer <SERVICE_API_KEY>`; read `x-discord-user-id` header and resolve/auto-create the acting **Player**, set as `createdBy`.
6. Sensible behaviour: creating a session **upserts** game/location/players by name/Discord-id so the bot can pass human-friendly values.
7. Integration tests with Fastify `inject` against a disposable test database.

**Acceptance.** `curl` (with the service key) can create and list a session; `pnpm test` is green; invalid payloads return 400 with clear messages.

---

### Phase 4 — Discord bot (MVP)

**Goal.** Log and view plays from Discord.

1. `bot`: discord.js v14 client + a small command-handler that loads `commands/*`.
2. `deploy-commands.ts`: register slash commands **guild-scoped** in dev (updates instantly).
3. `apiClient.ts`: wrapper that calls the backend with the service key and forwards the invoking user's Discord id.
4. MVP commands (simple option-based first):
   - `/logplay game:<text> players:<@a @b @c> winner:<@a> [date] [location] [notes]` — parse mentions, POST a session.
   - `/recent [count]` — list latest sessions as an embed.
   - `/games`, `/addgame name:<text>`, `/players`, `/linkme name:<text>` (link your Discord account to a Player), `/stats [player]`, `/leaderboard`.

**Acceptance.** In your server, `/logplay` creates a row visible via `/recent` and in Prisma Studio; `/linkme` ties your Discord id to a Player.

#### Phase 4b — Bot UX polish (after MVP works)

- Replace `/logplay` options with a guided flow: **user-select menus** for players & winners + a **modal** (text inputs) for date/location/notes + a Submit button.
- **Autocomplete** on `game` and `location` options (driven by API lookups).
- Rich embeds, ephemeral confirmations, friendly error messages.

---

### Phase 5 — Migrate the Excel data

**Goal.** Historical plays imported once, accurately.

1. `scripts/import-xlsx.ts` using **SheetJS (`xlsx`)** to read the spreadsheet.
2. Map columns → upsert Games/Players/Locations, create Sessions + SessionPlayers, parse the winner column (handle ties / multiple names).
3. Support a `--dry-run` that prints what it _would_ create; make upserts idempotent so re-runs are safe.
4. Fill in the column-mapping template (Appendix B), then run against the **production** DB once.

**Acceptance.** Imported session count matches the spreadsheet row count; spot-check 5 sessions for correct players/winner/date; re-running changes nothing.

---

### Phase 6 — Deployment

**Goal.** Bot online 24/7, backend reachable, data in managed Postgres.

1. On the host: provision **managed Postgres** + two services from the repo — `backend` (web service) and `bot` (worker).
2. Set env/secrets per §9 in each service.
3. Run `prisma migrate deploy` as a release/predeploy step on the backend.
4. Switch `deploy-commands` to **global** registration for production.
5. Add a `GET /health` endpoint and point the platform's health check at it.

**Acceptance.** Redeploy the stack; bot shows online; `/logplay` from Discord persists to prod Postgres and survives a restart.

---

### Phase 7 — Stats & polish

**Goal.** The features that make it more useful than the spreadsheet.

1. Stats endpoints + commands: leaderboard (win count & win rate), per-player profile, per-game play counts & top winner, recent activity.
2. Pagination/filters on lists (by game, player, date range).
3. Polished Discord embeds; confirmations; guard rails (e.g. winner must be among the players).

**Acceptance.** `/leaderboard` and `/stats <player>` return correct numbers verified against the DB.

---

### Phase 8 — Future frontends & integrations

See §13 backlog. The API and data model are designed so none of these require backend rewrites.

---

## 7. API surface (reference)

All routes require `Authorization: Bearer <SERVICE_API_KEY>`. The acting user is
taken from the `x-discord-user-id` header where relevant.

| Method   | Path                 | Purpose                                                  |
| -------- | -------------------- | -------------------------------------------------------- |
| GET      | `/health`            | Liveness check                                           |
| GET/POST | `/players`           | List / create players                                    |
| GET      | `/players/:id`       | Player detail                                            |
| POST     | `/players/link`      | Link a Discord id to a player (`/linkme`)                |
| GET/POST | `/games`             | List / create games                                      |
| GET      | `/games/:id`         | Game detail                                              |
| GET/POST | `/locations`         | List / create locations                                  |
| GET      | `/sessions`          | List/filter sessions (game, player, date range, limit)   |
| POST     | `/sessions`          | Create a session (upserts game/location/players by name) |
| GET      | `/sessions/:id`      | Session detail                                           |
| PATCH    | `/sessions/:id`      | Edit a session                                           |
| DELETE   | `/sessions/:id`      | Delete a session                                         |
| GET      | `/stats/leaderboard` | Win counts / win rates                                   |
| GET      | `/stats/players/:id` | Per-player stats                                         |
| GET      | `/stats/games/:id`   | Per-game stats                                           |

---

## 8. Discord bot commands (reference)

| Command           | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `/logplay`        | Record a play (MVP: options; 4b: guided menus + modal) |
| `/recent [count]` | Show the most recent sessions                          |
| `/games`          | List games in the catalogue                            |
| `/addgame name:`  | Add a game                                             |
| `/players`        | List players                                           |
| `/linkme name:`   | Link your Discord account to a player profile          |
| `/stats [player]` | Show stats for you or a named player                   |
| `/leaderboard`    | Win leaderboard for the group                          |

---

## 9. Environment & secrets

| Variable            | Used by      | Description                                             |
| ------------------- | ------------ | ------------------------------------------------------- |
| `DATABASE_URL`      | backend      | Postgres connection string                              |
| `SERVICE_API_KEY`   | backend, bot | Shared secret authorising bot→API calls                 |
| `API_BASE_URL`      | bot          | Base URL of the backend                                 |
| `DISCORD_TOKEN`     | bot          | Bot token                                               |
| `DISCORD_CLIENT_ID` | bot          | Application (client) id                                 |
| `DISCORD_GUILD_ID`  | bot (dev)    | Server id for instant guild-scoped command registration |
| `PORT`              | backend      | HTTP port (host usually injects this)                   |
| `NODE_ENV`          | both         | `development` / `production`                            |
| `LOG_LEVEL`         | both         | pino log level                                          |

Keep real values out of git: commit `.env.example` only; set real secrets in the host's dashboard.

---

## 10. Deployment notes (Railway default)

1. Create a project; add a **PostgreSQL** plugin → it provides `DATABASE_URL`.
2. Add two services from the GitHub repo:
   - **backend** — build `pnpm install && pnpm --filter backend build`; release `pnpm --filter backend prisma migrate deploy`; start `node packages/backend/dist/server.js`.
   - **bot** — build the bot; start `node packages/bot/dist/index.js`.

3. Set env vars from §9 on each service; generate a strong `SERVICE_API_KEY`.
4. Point `API_BASE_URL` at the backend's internal/public URL.
5. Run `deploy-commands` (global) once after first deploy.

Render/Fly.io: same shape — managed Postgres + a web service (backend) + a worker (bot).

---

## 11. Testing & CI

- **Unit/integration:** Vitest. Test routes via Fastify `inject` against a throwaway Postgres (Docker service in CI or Testcontainers).
- **CI (`.github/workflows/ci.yml`):** on PR run install → `typecheck` → `lint` → `prisma validate` → `test`.
- Optional: auto-deploy on merge to `main` via the host's GitHub integration.

---

## 12. Milestones (suggested order)

1. **M1 – Walking skeleton:** Phases 0–2 (repo + DB + schema).
2. **M2 – API:** Phase 3 (can create/list sessions via curl + tests).
3. **M3 – MVP bot:** Phase 4 (log & view plays from Discord locally).
4. **M4 – Live + historical data:** Phases 6 then 5 (deploy, then import the spreadsheet).
5. **M5 – Useful:** Phases 7 + 4b (stats + nicer bot UX).
6. **M6+:** Phase 8 backlog.

> Tip: it's fine to flip M4's order — deploy first with an empty DB, sanity-check the live bot, then import.

---

## 13. Future enhancements / backlog

- **Web frontend:** React/Next app on the same API; **"Log in with Discord" (OAuth2)** for user identity.
- **BoardGameGeek integration:** autofill game metadata, player counts, thumbnails by `bggId`.
- **Edit/delete from Discord** with confirmation + undo.
- **Reminders/recaps:** scheduled "game night?" nudge; monthly recap embed.
- **Rankings:** ELO / head-to-head records / achievements.
- **Exports:** CSV/Excel export; optional read-only **Google Sheets mirror** if you still want the spreadsheet view.
- **Scores & game variants**, per-game scoring fields.

---

## 14. Open questions (decide before/while building)

1. **Co-op & team games** — represent a co-op win as all-players-`isWinner`, or add an `outcome` enum (`COMPETITIVE` / `COOP_WIN` / `COOP_LOSS`) on `Session`? (Cheap to add later.)
2. **Scores** — do you record points per player, or just winners? (`score` field exists but is optional.)
3. **Ghost players** — confirm friends without Discord should be loggable by name (the plan assumes yes via nullable `discordUserId`).
4. **Edit permissions** — can anyone edit/delete any session, or only the creator? (v1 assumes anyone in the group.)
5. **Dates & time zones** — store `playedOn` as a date (no time) in UTC; confirm that's fine.

---

## Appendix A — Prerequisite checklist

- [x] Node 20+, pnpm, Docker, Git installed
- [x] Discord application created; bot token + client id saved
- [x] Bot invited to the server; guild id saved
- [x] GitHub repo created
- [x] Host account created (Railway/Render/Fly)

## Appendix B — Spreadsheet → schema mapping (fill this in)

| Spreadsheet column | Maps to                  | Notes           |
| ------------------ | ------------------------ | --------------- |
| Date               | `Session.playedOn`       | DD/MM/YYYY      |
| Game               | `Game.name`              |                 |
| Where              | `Location.name`          |                 |
| Who played         | `SessionPlayer` rows     | Comma Seperated |
| Who won            | `SessionPlayer.isWinner` | Only one winner |
| Notes              | `Session.notes`          | Plain text      |

> Capture the exact header names, the player-name separator, and how ties are
> written — the import script in Phase 5 depends on these.
