CREATE TABLE "model_components" (
	"project_id" text NOT NULL,
	"id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" varchar(20),
	"description" text,
	"technology" varchar(255),
	"owner" varchar(255),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_components_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
CREATE TABLE "model_relationships" (
	"project_id" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"description" text,
	"technology" varchar(255),
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_relationships_project_id_source_id_target_id_pk" PRIMARY KEY("project_id","source_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "model_components" ADD CONSTRAINT "model_components_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_components" ADD CONSTRAINT "model_components_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_relationships" ADD CONSTRAINT "model_relationships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_relationships" ADD CONSTRAINT "model_relationships_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;