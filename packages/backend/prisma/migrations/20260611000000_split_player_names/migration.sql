-- Split Player.displayName into realName (the person's actual name, preferred
-- for display) and discordName (last-seen Discord nickname, auto-synced).
-- Existing names are kept as realName so nothing changes visually; rows that
-- held a Discord-derived name can be fixed by re-running /linkme or manually.
ALTER TABLE "Player" ADD COLUMN "realName" TEXT;
ALTER TABLE "Player" ADD COLUMN "discordName" TEXT;

UPDATE "Player" SET "realName" = "displayName";

ALTER TABLE "Player" DROP COLUMN "displayName";
