# Multi-Tenancy Plan — Meeple Ledger

**Goal:** Let any Discord server use Meeple Ledger by inviting one shared bot, with each
server's data fully isolated. Your existing friend group must be **completely unaffected** —
same data, same behaviour, no migration the users can perceive.

**Decisions (locked):**

- **Distribution:** one shared bot + backend + DB that you operate. Other groups just invite
  the bot. (Not self-host-per-group.)
- **Tenant boundary:** the Discord **guild** (server). `interaction.guildId` is the tenant key.
- **Player identity:** **scoped per group**. The same Discord user becomes an independent
  `Player` row in each group. Names, BGG links, ratings, and stats are isolated.

---

## 1. Current state (why this is non-trivial)

The app assumes a single global dataset end-to-end:

- **DB:** `Player`, `Game`, `Location`, `Session`, `SessionPlayer`, `Rating`. No tenant column.
  Globally-unique constraints: `Game.name`, `Game.bggId`, `Location.name`,
  `Player.discordUserId`, `Player.bggUsername`.
- **Auth:** a single shared `SERVICE_API_KEY` Bearer token between bot and backend. The bot
  forwards `x-discord-user-id`; there is no guild/tenant header.
- **Queries:** every service (`resolve.ts`, `sessions.ts`, `stats.ts`, `suggest.ts`,
  `ratings.ts`, players/games routes) reads/writes the whole table with no scope. Several do
  unbounded scans (e.g. `findGameByIdOrName` calls `game.findMany()`).
- **Bot:** one Discord application/token. `interaction.guildId` is available on every command
  but never used. Commands can register globally already.

The core risk in this migration is a **missed query scope = cross-tenant data leak**. The plan
treats `groupId` enforcement as the central concern, not an afterthought.

---

## 2. Target architecture

```
Discord guild A ─┐
Discord guild B ─┤→  one bot  ──(Bearer key + x-guild-id)──>  backend  ──>  Postgres
Discord guild C ─┘     (resolves guild → Group, scopes every query by groupId)
```

- One `Group` row per Discord guild, **lazily auto-provisioned** on first use.
- Every tenant-owned row carries `groupId`. Every query is scoped by it.
- The bot stays a single trusted client: it keeps the one `SERVICE_API_KEY` and additionally
  sends the acting `guildId` on every request. Tenants never get their own keys.

---

## 3. Data model changes

### 3.1 New `Group` model

```prisma
model Group {
  id           String   @id @default(cuid())
  guildId      String   @unique          // Discord guild id — the tenant key
  name         String?                    // guild name, cached for display/admin
  createdAt    DateTime @default(now())

  players      Player[]
  games        Game[]
  locations    Location[]
  sessions     Session[]
  ratings      Rating[]
}
```

### 3.2 Add `groupId` to every tenant-owned model

`Player`, `Game`, `Location`, `Session`, `Rating` each gain:

```prisma
  group   Group  @relation(fields: [groupId], references: [id], onDelete: Cascade)
  groupId String
```

`SessionPlayer` does **not** need `groupId` directly — it inherits the tenant through its
`Session` (and is already `onDelete: Cascade` from `Session`). We do still need to ensure its
`player` belongs to the same group; enforced at the service layer when building a session.

### 3.3 Convert global uniques to composite (per-group) uniques

| Model    | Was (global `@unique`)        | Becomes                                  |
| -------- | ----------------------------- | ---------------------------------------- |
| Game     | `name`, `bggId`               | `@@unique([groupId, name])`, `@@unique([groupId, bggId])` |
| Location | `name`                        | `@@unique([groupId, name])`              |
| Player   | `discordUserId`, `bggUsername`| `@@unique([groupId, discordUserId])`, `@@unique([groupId, bggUsername])` |

> Note on `bggId`/`bggUsername`: making them per-group means two groups can each have their own
> "Catan" row and the same Discord user can link the same BGG account in two groups. That is the
> correct consequence of per-group identity.

### 3.4 Indexes

Add `groupId` to existing indexes (Prisma composite indexes), e.g.:

```prisma
  @@index([groupId, gameId])      // Session
  @@index([groupId, playedOn])    // Session
  @@index([groupId, gameId])      // Rating
```

Leading-column scoping keeps the common "list everything for this group" queries fast.

---

## 4. Query-scoping strategy (the critical part)

Two layers, defence-in-depth:

### 4.1 Thread `groupId` explicitly through every service

All service functions take a `groupId` (or a resolved `Group`) as their first argument and add
`groupId` to every `where`, `create`, and uniqueness lookup. Files to change:

- `services/resolve.ts` — `findPlayerByIdOrDiscord`, `findGameByIdOrName` (the `findMany()`
  scan **must** become `findMany({ where: { groupId } })`).
- `services/sessions.ts` — create/list/get/update/delete all scoped; verify every referenced
  player/game/location belongs to the group before linking.
- `services/stats.ts`, `services/suggest.ts`, `services/ratings.ts`, `services/players.ts`,
  `services/bggReconcile.ts` — scope all reads/writes.
- All `routes/*` handlers — pull `groupId` from the request (see §5) and pass it down.

### 4.2 Backstop: Postgres Row-Level Security (RLS) — recommended

Explicit scoping is the primary mechanism, but a single missed `where` leaks data. Add RLS as a
hard backstop so the database itself refuses cross-tenant rows:

1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on each tenant table.
2. Policy: `USING (group_id = current_setting('app.current_group')::text)`.
3. At the start of each request's transaction, `SET LOCAL app.current_group = '<groupId>'`.

Wrap this in a Prisma `$transaction` helper (or a Prisma client extension) that every handler
uses. If a query forgets its `where groupId`, RLS still returns only the active group's rows.

> If RLS is deemed too heavy for v1, ship §4.1 + the tests in §8 first and add RLS in a
> follow-up. But it is the cheapest insurance against the highest-impact bug here.

### 4.3 A `groupId`-bound DB handle

Introduce a small helper so handlers can't accidentally use an unscoped client:

```ts
// withGroup(groupId, async (db) => { ... })
// opens a tx, SET LOCAL app.current_group, runs callback with the tx client
```

Services receive this `db` (`Tx`) handle, exactly as they already accept `Tx` today.

---

## 5. Auth & request flow

Keep the single `SERVICE_API_KEY` (the bot is the only trusted client). Add guild context:

1. **Bot** sends `x-discord-guild-id: <interaction.guildId>` on every request, alongside the
   existing `x-discord-user-id`. Add to `ApiClient` so it's set centrally, not per-call.
2. **`auth.ts`** captures `req.actingGuildId` (mirroring `actingDiscordUserId`).
3. **New `groupHook`** (after `authHook`): resolve `actingGuildId` → `Group`, auto-creating it
   if absent (lazy provisioning). Attach `req.group`/`req.groupId`. Reject requests with no
   guild id (e.g. DMs) with `400 guild_required`.
4. Handlers read `req.groupId` and open `withGroup(req.groupId, …)`.

`/health` stays unauthenticated and ungrouped.

### Bot-side changes

- **Reject DMs:** commands invoked outside a guild (`interaction.guildId == null`) reply with
  "Meeple Ledger only works inside a server." Add a shared guard in the interaction handler in
  `index.ts`.
- **Pass guild id everywhere:** the central `ApiClient` request method attaches
  `x-discord-guild-id`. Each command must supply the guild id (thread `interaction.guildId`
  into the calls, or set it on a per-interaction client instance).
- **Cache guild name** opportunistically: send `interaction.guild?.name` so the backend can
  store/refresh `Group.name` for admin/debugging.

---

## 6. Migrating your existing group (zero perceived change)

Your current data has no `groupId`. The migration must assign it all to your group's guild.

1. **Capture your guild id.** Put it in an env var for the migration, e.g.
   `LEGACY_GROUP_GUILD_ID=<your server id>`.
2. **Schema migration** (via the project's `migrate diff --from-url … --script` + `migrate
   deploy` flow — `migrate dev` is non-interactive-broken here):
   - Create `Group`.
   - Add `groupId` as **nullable** first (so existing rows are valid).
   - Insert one `Group` row for `LEGACY_GROUP_GUILD_ID`.
   - Backfill: `UPDATE <each table> SET group_id = '<legacy group id>'`.
   - Alter `groupId` to **NOT NULL**.
   - Drop old global unique constraints; add composite ones.
   - Add new indexes; enable RLS + policies (if doing §4.2 now).
3. **Verify** counts per table all carry the legacy `groupId` and that your existing slash
   commands return identical results.

Because the bot now sends your real guild id and the legacy Group is keyed to it, your group
resolves to the exact same data. No user-visible change.

> Do this against a **DB snapshot/backup first.** Run on local (port 5433) and the
> `meeple_test` schema before prod.

---

## 7. Onboarding new groups

- **Invite flow:** generate an OAuth2 invite URL with `applications.commands` + `bot` scopes
  and minimal permissions (send messages, embeds, read members for name resolution). Document
  it in the README.
- **Lazy provisioning:** first command in a new guild auto-creates its `Group`. No `/setup`
  required. (Optional later: a `/setup` command to set a friendly group name or seed
  locations.)
- **Global command registration:** commands already register globally; confirm
  `deploy-commands.ts` is run in global mode (no `DISCORD_GUILD_ID`) for prod. New guilds pick
  up commands automatically (global propagation can take up to ~1h).
- **Empty-state UX:** new groups start with no games/players. Make sure embeds and `/stats`,
  `/leaderboard`, `/suggest` render gracefully with zero rows.

---

## 8. Testing (the safety net for tenant isolation)

This is where missed scopes get caught. Add to the existing Vitest suite:

- **Isolation matrix:** for every read endpoint, seed two groups with overlapping names
  (both have a "Catan", both have player "Alice") and assert group A never sees group B's rows.
- **Write isolation:** creating a session in group A with a player id from group B is rejected.
- **Uniqueness:** two groups can each create a game named "Catan" / link the same BGG username.
- **Resolve scans:** `findGameByIdOrName` / `findPlayerByIdOrDiscord` only match within the
  group.
- **No-guild request:** returns `400 guild_required`.
- **(If RLS) negative test:** a deliberately unscoped query still returns only active-group
  rows.

Update `test/helpers.ts` and `test/global-setup.ts` to create a default group and a
`groupId`-aware seeding helper. Most existing tests can run under a single default group with
minimal churn.

---

## 9. Operational & compliance considerations

- **Discord verification:** a public bot in **100+ servers** must be verified by Discord
  (identity + a privacy policy). Below 100 it works unverified. Plan for a privacy policy and
  ToS page before wide sharing.
- **Privacy:** you'll be storing other people's Discord ids and names. Add a privacy policy, a
  data-deletion path (e.g. delete a `Group` cascade when the bot is removed — listen to the
  `guildDelete` gateway event, or offer `/forget-this-server`).
- **Rate limits / abuse:** one shared backend now serves many guilds. Add per-group rate
  limiting and basic request logging with `groupId` for debugging.
- **Cost/scale:** single Postgres is fine for many small groups; `groupId`-leading indexes keep
  it healthy. Revisit if it grows large.

---

## 10. Phased delivery

**Phase 1 — Schema & isolation core (highest risk, do first)**

1. Add `Group` model + nullable `groupId` everywhere; migration scaffolding.
2. Backfill legacy group; flip `groupId` to NOT NULL; swap uniques to composite.
3. `withGroup` tx helper; (optional now) RLS policies.

**Phase 2 — Backend scoping**

4. `groupHook` + `req.groupId`; reject no-guild requests.
5. Thread `groupId` through every service & route.
6. Isolation test suite (§8). **Gate:** all isolation tests green before Phase 3.

**Phase 3 — Bot**

7. `ApiClient` sends `x-discord-guild-id`; thread `interaction.guildId` through commands.
8. DM/no-guild guard; cache guild name.
9. Confirm global command registration.

**Phase 4 — Onboarding & ops**

10. Invite URL + README; lazy provisioning verified on a second test server.
11. `guildDelete` → group cleanup / `/forget-this-server`; privacy policy & ToS.
12. Per-group rate limiting + `groupId` in logs.

**Phase 5 — Rollout**

13. Backup prod DB. Run migration on a snapshot, verify your group is byte-for-byte intact.
14. Deploy backend, then bot. Smoke-test your group, then a fresh test server.

---

## 11. Open questions / future

- **Cross-group "global" BGG catalogue?** Currently each group re-imports games independently.
  A shared, read-only BGG game catalogue (deduped by `bggId`) with per-group overrides could
  cut import work later — but adds complexity; out of scope for v1.
- **Admin tooling:** a tiny internal endpoint to list groups / counts for support.
- **Self-host path:** not in scope per the chosen distribution model, but the `groupId` work
  doesn't preclude it later.

---

## 12. Key risks & mitigations

| Risk                                    | Mitigation                                              |
| --------------------------------------- | ------------------------------------------------------- |
| Missed query scope → cross-tenant leak  | Explicit `groupId` + RLS backstop + isolation test grid |
| Migration corrupts your group's data    | Backup + run on snapshot first; verify counts/results   |
| Discord 100-server verification gate    | Privacy policy + ToS ready before wide sharing          |
| Orphaned data when bot is removed       | `guildDelete` cascade / `/forget-this-server`           |
| Slow queries at scale                   | `groupId`-leading composite indexes                     |
```
