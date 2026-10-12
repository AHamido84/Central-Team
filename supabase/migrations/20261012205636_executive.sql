CREATE TABLE "executive_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_id" uuid,
	"kpi" text NOT NULL,
	"context" jsonb NOT NULL,
	"body" text NOT NULL,
	"owner_id" uuid,
	"task_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executive_notes_body_check" CHECK (char_length("executive_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "executive_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"cadence" text DEFAULT 'monthly' NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"recipients" text[] NOT NULL,
	"next_run_on" date NOT NULL,
	"last_run_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executive_schedules_cadence_check" CHECK ("executive_schedules"."cadence" in ('weekly','monthly')),
	CONSTRAINT "executive_schedules_locale_check" CHECK ("executive_schedules"."locale" in ('ar','en')),
	CONSTRAINT "executive_schedules_recipients_check" CHECK (cardinality("executive_schedules"."recipients") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "executive_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executive_views_name_check" CHECK (char_length("executive_views"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"organization_id" uuid NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"value" double precision,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_snapshots_organization_id_day_metric_pk" PRIMARY KEY("organization_id","day","metric")
);
--> statement-breakpoint
CREATE TABLE "kpi_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"year" integer NOT NULL,
	"quarter" smallint,
	"value" double precision NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_targets_quarter_check" CHECK ("kpi_targets"."quarter" is null or "kpi_targets"."quarter" between 1 and 4),
	CONSTRAINT "kpi_targets_year_check" CHECK ("kpi_targets"."year" between 2000 and 2100)
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "executive_notes" ADD CONSTRAINT "executive_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_notes" ADD CONSTRAINT "executive_notes_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_notes" ADD CONSTRAINT "executive_notes_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_schedules" ADD CONSTRAINT "executive_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_schedules" ADD CONSTRAINT "executive_schedules_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_views" ADD CONSTRAINT "executive_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executive_views" ADD CONSTRAINT "executive_views_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executive_notes_kpi_idx" ON "executive_notes" USING btree ("organization_id","kpi","created_at");--> statement-breakpoint
CREATE INDEX "executive_schedules_due_idx" ON "executive_schedules" USING btree ("is_active","next_run_on");--> statement-breakpoint
CREATE INDEX "executive_views_user_idx" ON "executive_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_metric_idx" ON "kpi_snapshots" USING btree ("organization_id","metric","day");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_targets_unique_idx" ON "kpi_targets" USING btree ("organization_id","metric","year",coalesce("quarter", 0));