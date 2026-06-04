# Meeple Ledger — Feature Tracker

A living index of feature ideas. Each entry links to a detailed spec in `docs/features/`.  
**Statuses:** `idea` → `planned` → `in-progress` → `done`

---

## Active (planned, ready to build)

| Feature                             | Priority | Spec                                                        | Notes                                                                |
| ----------------------------------- | -------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| BGG Integration                     | High     | [bgg-integration.md](features/bgg-integration.md)           | Search BGG when adding games; link BGG username to import collection |
| Edit / Delete Sessions from Discord | High     | [edit-delete-sessions.md](features/edit-delete-sessions.md) | Backend routes already exist; bot commands needed                    |
| What Should We Play Tonight?        | Medium   | [what-to-play-tonight.md](features/what-to-play-tonight.md) | `/suggest` command — recency, player count, variety scoring          |

---

## Backlog (ideas, no spec yet)

| Feature                           | Priority | Notes                                                              |
| --------------------------------- | -------- | ------------------------------------------------------------------ |
| Head-to-head rivalry stats        | Medium   | `/rivalry @player` — win/loss record across all games              |
| Achievements & milestone callouts | Medium   | Auto-post to Discord on first win, winning streaks, etc.           |
| Score tracking                    | Medium   | `score` field exists but is unused; per-game high scores, averages |
| ELO / skill ratings               | Low      | More nuanced than win count; accounts for opponent strength        |
| Monthly recap                     | Low      | Auto-posted embed: games played, MVP, most played game             |
| Streak & momentum tracker         | Low      | "Who's on a hot streak?" — show in `/leaderboard`                  |
| Web frontend                      | Low      | React/Next.js on the same API with Discord OAuth2 login            |
| Exports (CSV / Google Sheets)     | Low      | For people who still want the spreadsheet view                     |
| Game night scheduling             | Low      | Discord poll: "Who's in for Friday?"                               |

---

## Done

| Feature                        | Completed | Notes                              |
| ------------------------------ | --------- | ---------------------------------- |
| Core API (CRUD + stats)        | M2        | All endpoints live                 |
| Discord bot MVP                | M3        | 8 slash commands                   |
| Historical data import         | M4        | Excel → Postgres via import script |
| Leaderboard & per-player stats | M5        | `/leaderboard`, `/stats` commands  |
