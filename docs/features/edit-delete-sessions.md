# Feature: Edit & Delete Sessions from Discord

**Status:** Planned  
**Priority:** High  
**Tracker:** [FEATURE-TRACKER.md](../FEATURE-TRACKER.md)

---

## Goal

Allow players to correct mistakes in logged sessions or remove accidental duplicates directly from Discord. The `PATCH /sessions/:id` and `DELETE /sessions/:id` backend routes **already exist** — this feature is entirely new bot commands.

No permission restrictions are needed: this is a private server and the group trusts each other.

---

## New bot commands

### `/editsession`

Edit any field of a previously logged session.

### `/deletesession`

Delete a session, with a confirmation step to prevent accidents.

---

## `/editsession` — flow

### Step 1: Session picker

When the user runs `/editsession`, the bot fetches the 20 most recent sessions (`GET /sessions?limit=20`) and presents them as a **select menu** in an ephemeral message.

Each option label: `Game Name — DD MMM YYYY — Players: Alice, Bob, Charlie`  
Each option value: the session `id`.

### Step 2: Edit modal

When the user picks a session, the bot opens a **Discord modal** with the following text inputs, pre-filled with the current values:

| Field | Input type | Pre-filled with |
|-------|------------|-----------------|
| Game name | Short text | `session.game.name` |
| Winner(s) | Short text | Comma-separated display names, e.g. `Alice, Bob` |
| Players | Short text | Comma-separated display names |
| Date (YYYY-MM-DD) | Short text | `session.playedOn` formatted |
| Location | Short text | `session.location.name` or blank |
| Notes | Paragraph | `session.notes` or blank |

### Step 3: Submit

On modal submit:

1. Parse the new values (same logic as `/logplay`: split comma-separated player names, look up or upsert by display name).
2. Call `PATCH /sessions/:id` with the changed fields.
3. Reply with an ephemeral confirmation embed showing the updated session.

**Validation:**
- All winner names must appear in the players list. If not, reject with a clear error: "Winner 'Dave' is not in the players list."
- Date must parse as a valid date. If not, reject: "Invalid date. Use YYYY-MM-DD format."

---

## `/deletesession` — flow

### Step 1: Session picker

Same as `/editsession` — show the 20 most recent sessions in an ephemeral select menu.

### Step 2: Confirmation

After the user picks a session, the bot replies (ephemerally) with a confirmation embed:

```
⚠️ Delete this session?

Game: Wingspan
Date: 14 May 2025
Players: Alice, Bob, Charlie
Winner: Alice

[Confirm Delete]  [Cancel]
```

Buttons use a custom ID encoding the session ID so the interaction handler knows which session to delete.

### Step 3: Execute

- **Confirm Delete:** calls `DELETE /sessions/:id`, replies "Session deleted."
- **Cancel:** replies "Cancelled." No changes made.

The confirmation embed (and its buttons) should be **disabled or removed** after either button is pressed to prevent double-clicks.

---

## Implementation notes

### Interaction handling

Both commands use Discord's component interaction system (select menus, modals, buttons). The interaction flow needs:

1. A command handler that sends the initial select menu.
2. A `selectMenuHandler` (or similar) that receives the `interactionCreate` event for the select menu custom ID and either opens the modal or sends the confirmation.
3. A `modalSubmitHandler` for the edit modal.
4. A `buttonHandler` for the delete confirmation buttons.

Use a consistent custom ID naming convention:
- Select menu: `editsession_select`, `deletesession_select`
- Modal: `editsession_modal_<sessionId>`
- Buttons: `deletesession_confirm_<sessionId>`, `deletesession_cancel_<sessionId>`

All intermediate messages (select menus, confirmations) should be **ephemeral** so they don't clutter the channel.

### Reuse from `/logplay`

The player-name parsing and winner-validation logic in `/logplay` should be extracted into a shared helper (e.g. `packages/bot/src/utils/parsePlayers.ts`) and reused by `/editsession`. Do not duplicate it.

---

## API changes required

None. The `PATCH /sessions/:id` and `DELETE /sessions/:id` routes already exist in `packages/backend/src/routes/sessions.ts`. Verify they accept the required fields (game name, player names, winner names as strings that get resolved server-side) — if the PATCH currently only accepts IDs, update it to accept names the same way POST does.

---

## Acceptance criteria

- [ ] `/editsession` shows a select menu of the 20 most recent sessions.
- [ ] Selecting a session opens a modal with all fields pre-filled.
- [ ] Submitting the modal updates the session; a confirmation embed is shown.
- [ ] Winner-not-in-players validation rejects the edit with a clear message.
- [ ] Invalid date rejects with a clear message.
- [ ] `/deletesession` shows the same session picker.
- [ ] Selecting a session shows a confirmation embed with Confirm/Cancel buttons.
- [ ] Confirming deletes the session and acknowledges.
- [ ] Cancelling does nothing.
- [ ] All intermediate messages are ephemeral.
- [ ] Buttons are disabled after use (no double-action).
