-- Invites are bound to the address they were sent to. A pending invite from before
-- this change cannot be bound retroactively, so it is removed and must be re-issued;
-- keeping it would leave a link redeemable by any address. Written idempotently so a
-- restore of an older dump applies cleanly.
ALTER TABLE "workspace_invites" ADD COLUMN IF NOT EXISTS "invited_email" text;
DELETE FROM "workspace_invites" WHERE "invited_email" IS NULL;
ALTER TABLE "workspace_invites" ALTER COLUMN "invited_email" SET NOT NULL;
