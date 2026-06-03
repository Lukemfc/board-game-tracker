# Meeple Ledger

A deployed, collaborative board-game-night tracker. A **backend REST API** owns the
data; a **Discord bot** is the first frontend (a web app can be added later without
touching the backend). See [PLAN.md](PLAN.md) for the full design.

```
Discord ──slash commands──▶ Bot ──HTTPS + service key──▶ Backend API ──Prisma──▶ Postgres
```

## Stack

TypeScript · pnpm workspaces · Fastify + Zod · Prisma + PostgreSQL · discord.js v14 · Vitest

| Package            | What it is                                                     |
| ------------------ | -------------------------------------------------------------- |
| `packages/shared`  | Zod schemas + inferred types shared by the bot and the backend |
| `packages/backend` | Fastify REST API, Prisma data layer, Excel importer            |
| `packages/bot`     | discord.js bot — slash commands that call the backend          |

## Prerequisites

- **Node 20+** and **pnpm** (`corepack enable`)
- **Docker** (for local Postgres) — or any Postgres you point `DATABASE_URL` at
- A **Discord application + bot token** (see [Discord setup](#discord-setup))

## Quick start (local)

```bash
# 1. Install
pnpm install

# 2. Start Postgres (docker compose maps host :5433 -> container :5432)
pnpm db:up

# 3. Configure env
cp .env.example packages/backend/.env
cp .env.example packages/bot/.env
#   then edit packages/bot/.env with your real DISCORD_* values
#   and set the SAME SERVICE_API_KEY in both files

# 4. Apply the schema + seed sample data
pnpm --filter @meeple/backend prisma:migrate     # creates/updates the DB
pnpm --filter @meeple/backend seed               # optional sample data

# 5. Register slash commands to your dev guild (instant) then run everything
pnpm --filter @meeple/bot deploy-commands
pnpm dev                                          # backend + bot in watch mode
```

`pnpm dev` builds `shared` then runs the backend and bot together. To run just one:
`pnpm dev:backend` / `pnpm dev:bot`.

## Root scripts

| Script                                | Does                                          |
| ------------------------------------- | --------------------------------------------- |
| `pnpm dev`                            | Run backend + bot in watch mode               |
| `pnpm build`                          | `tsc -b` every package                        |
| `pnpm typecheck`                      | Typecheck every package                       |
| `pnpm test`                           | Backend integration tests (needs Postgres up) |
| `pnpm lint`                           | ESLint                                        |
| `pnpm format`                         | Prettier (write) · `format:check` to verify   |
| `pnpm db:up` / `db:down` / `db:reset` | Manage the local Postgres container           |

## Environment variables

See [.env.example](.env.example). Summary:

| Variable                 | Used by      | Notes                                                                 |
| ------------------------ | ------------ | --------------------------------------------------------------------- |
| `DATABASE_URL`           | backend      | Postgres connection string                                            |
| `SERVICE_API_KEY`        | backend, bot | Shared secret authorising bot→API calls (must match)                  |
| `API_BASE_URL`           | bot          | Base URL of the backend                                               |
| `DISCORD_TOKEN`          | bot          | Bot token                                                             |
| `DISCORD_CLIENT_ID`      | bot          | Application (client) id                                               |
| `DISCORD_GUILD_ID`       | bot          | Set in dev for instant command registration; unset in prod for global |
| `PORT` / `HOST`          | backend      | HTTP bind (hosts usually inject `PORT`)                               |
| `NODE_ENV` / `LOG_LEVEL` | both         | `development`/`production`; pino level                                |

## Discord setup

1. Create an application at <https://discord.com/developers/applications>; add a **Bot**
   and copy the **token** and **application (client) id**.
2. OAuth2 → URL generator: scopes `bot` + `applications.commands`; invite to your server
   and note the **guild id**.
3. Put those values in `packages/bot/.env`, then run `pnpm --filter @meeple/bot deploy-commands`.

## Commands

`/logplay` · `/recent` · `/games` · `/addgame` · `/players` · `/linkme` · `/stats` · `/leaderboard`

## Importing the historical spreadsheet

1. Confirm the column headers in `packages/backend/src/scripts/import-xlsx.ts` (`COLUMNS`)
   match your sheet (see PLAN.md Appendix B), and the player-name separator.
2. Dry run, then import for real (idempotent — safe to re-run):

```bash
# Use an ABSOLUTE path; the `--` passes flags to the script (not pnpm).
pnpm --filter @meeple/backend run import:xlsx -- /abs/path/to/plays.xlsx --dry-run
pnpm --filter @meeple/backend run import:xlsx -- /abs/path/to/plays.xlsx
```

## Deployment (Railway shown; Render/Fly equivalent)

1. Add a **PostgreSQL** plugin → provides `DATABASE_URL`.
2. Create two services from this repo:
   - **backend** — build `pnpm install && pnpm --filter @meeple/backend build`;
     release `pnpm --filter @meeple/backend prisma:deploy`;
     start `node packages/backend/dist/server.js`. Health check → `GET /health`.
   - **bot** — build `pnpm install && pnpm --filter @meeple/bot build`;
     start `node packages/bot/dist/index.js`.
3. Set env vars per the table above on each service; generate a strong `SERVICE_API_KEY`
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. Point `API_BASE_URL` at the backend's URL; leave `DISCORD_GUILD_ID` unset for global commands.
5. After the first deploy, run `deploy-commands` once (global) to register commands.

## Testing

Integration tests run real Fastify routes against a throwaway `meeple_test` schema on the
local Postgres (override with `TEST_DATABASE_URL`). Just `pnpm db:up` then `pnpm test`.
CI (`.github/workflows/ci.yml`) runs typecheck → lint → format → tests on every PR.
