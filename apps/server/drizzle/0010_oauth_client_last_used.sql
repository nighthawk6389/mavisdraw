ALTER TABLE "oauth_clients" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
-- Agents signed in before this column existed count as used, so cleanup keeps them
UPDATE "oauth_clients" SET "last_used_at" = now() WHERE "id" IN (SELECT "client_id" FROM "api_tokens" WHERE "client_id" IS NOT NULL);
