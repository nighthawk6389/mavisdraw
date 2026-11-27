CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"state" text,
	"requested_access" varchar(16) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_id" text,
	"granted_access" varchar(16),
	"granted_project_ids" jsonb,
	"code_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "kind" varchar(16) DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "access" varchar(16) DEFAULT 'propose' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "project_ids" jsonb;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "refresh_hash" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "refresh_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_requests" ADD CONSTRAINT "oauth_requests_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_requests" ADD CONSTRAINT "oauth_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_requests_code_hash_idx" ON "oauth_requests" USING btree ("code_hash");--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_refresh_hash_idx" ON "api_tokens" USING btree ("refresh_hash");