CREATE TABLE "diagram_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"diagram_id" text NOT NULL,
	"version" integer NOT NULL,
	"elements" jsonb NOT NULL,
	"app_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" varchar(20) DEFAULT 'auto' NOT NULL,
	"label" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "diagrams" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_diagram_id" text,
	"parent_portal_id" text,
	"title" varchar(255) DEFAULT 'Untitled Diagram' NOT NULL,
	"elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"view_background_color" varchar(20) DEFAULT '#ffffff' NOT NULL,
	"grid_enabled" boolean DEFAULT true NOT NULL,
	"grid_size" integer DEFAULT 20 NOT NULL,
	"render_mode" varchar(20) DEFAULT 'sketchy' NOT NULL,
	"layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"github_user_id" text NOT NULL,
	"github_username" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"scope" text,
	"enterprise_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text,
	"email" varchar(255),
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"share_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"owner_id" text NOT NULL,
	"root_diagram_id" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"password_hash" text,
	"avatar_url" text,
	"oauth_provider" varchar(50),
	"oauth_provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "diagram_snapshots" ADD CONSTRAINT "diagram_snapshots_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_snapshots" ADD CONSTRAINT "diagram_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagram_snapshots_diagram_id_idx" ON "diagram_snapshots" USING btree ("diagram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagram_snapshots_diagram_version_idx" ON "diagram_snapshots" USING btree ("diagram_id","version");--> statement-breakpoint
CREATE INDEX "diagrams_project_id_idx" ON "diagrams" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "diagrams_parent_diagram_id_idx" ON "diagrams" USING btree ("parent_diagram_id");--> statement-breakpoint
CREATE INDEX "github_connections_user_id_idx" ON "github_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_connections_user_github_idx" ON "github_connections" USING btree ("user_id","github_user_id");--> statement-breakpoint
CREATE INDEX "project_permissions_project_id_idx" ON "project_permissions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_permissions_user_id_idx" ON "project_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_permissions_share_token_idx" ON "project_permissions" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "projects_owner_id_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");