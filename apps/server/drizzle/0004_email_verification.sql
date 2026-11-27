ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Accounts from before verification existed keep working as before: they
-- are treated as verified (new sign-ups confirm their address)
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
