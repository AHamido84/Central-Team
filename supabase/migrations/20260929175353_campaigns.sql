CREATE TABLE "campaign_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"budget_minor" bigint DEFAULT 0 NOT NULL,
	"external_ref" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_channels_platform_check" CHECK ("campaign_channels"."platform" in ('meta','instagram','facebook','tiktok','snapchat','google','youtube','x','linkedin','other')),
	CONSTRAINT "campaign_channels_budget_check" CHECK ("campaign_channels"."budget_minor" >= 0),
	CONSTRAINT "campaign_channels_name_check" CHECK (char_length("campaign_channels"."name") <= 120)
);
--> statement-breakpoint
CREATE TABLE "campaign_kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"channel_id" uuid,
	"metric" text NOT NULL,
	"target" numeric NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_kpis_metric_check" CHECK ("campaign_kpis"."metric" in ('impressions','reach','clicks','spend','conversions','leads','video_views','engagements','revenue','ctr','cpc','cpm','cpa','cpl','roas','frequency','engagement_rate')),
	CONSTRAINT "campaign_kpis_target_check" CHECK ("campaign_kpis"."target" > 0)
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"objective" text DEFAULT 'awareness' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"budget_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'SAR' NOT NULL,
	"owner_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'client' NOT NULL,
	"health" text DEFAULT 'no_data' NOT NULL,
	"health_notified" text,
	"metrics_through" date,
	"stale_notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_objective_check" CHECK ("campaigns"."objective" in ('awareness','traffic','engagement','leads','sales','app_installs','video_views')),
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('draft','planned','active','paused','completed','archived')),
	CONSTRAINT "campaigns_visibility_check" CHECK ("campaigns"."visibility" in ('internal','client')),
	CONSTRAINT "campaigns_health_check" CHECK ("campaigns"."health" in ('on_track','at_risk','off_track','no_data')),
	CONSTRAINT "campaigns_dates_check" CHECK ("campaigns"."end_date" >= "campaigns"."start_date"),
	CONSTRAINT "campaigns_budget_check" CHECK ("campaigns"."budget_minor" >= 0),
	CONSTRAINT "campaigns_name_check" CHECK (char_length("campaigns"."name") between 1 and 160),
	CONSTRAINT "campaigns_description_check" CHECK (char_length("campaigns"."description") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "metric_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"preset" text NOT NULL,
	"row_count" integer NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_imports_preset_check" CHECK ("metric_imports"."preset" in ('meta','tiktok','snapchat','google','custom')),
	CONSTRAINT "metric_imports_file_name_check" CHECK (char_length("metric_imports"."file_name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"conversions" bigint DEFAULT 0 NOT NULL,
	"leads" bigint DEFAULT 0 NOT NULL,
	"video_views" bigint DEFAULT 0 NOT NULL,
	"engagements" bigint DEFAULT 0 NOT NULL,
	"revenue_minor" bigint DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_id" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_daily_source_check" CHECK ("metrics_daily"."source" in ('manual','import','api')),
	CONSTRAINT "metrics_daily_non_negative_check" CHECK (least("metrics_daily"."impressions", "metrics_daily"."reach", "metrics_daily"."clicks", "metrics_daily"."spend_minor", "metrics_daily"."conversions", "metrics_daily"."leads", "metrics_daily"."video_views", "metrics_daily"."engagements", "metrics_daily"."revenue_minor") >= 0)
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid,
	"cadence" text DEFAULT 'monthly' NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"next_run_on" date NOT NULL,
	"last_run_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_cadence_check" CHECK ("report_schedules"."cadence" in ('weekly','monthly')),
	CONSTRAINT "report_schedules_locale_check" CHECK ("report_schedules"."locale" in ('ar','en'))
);
--> statement-breakpoint
CREATE TABLE "report_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_sections_kind_check" CHECK ("report_sections"."kind" in ('kpi_summary','trend','channel_breakdown','top_creatives','commentary','next_steps')),
	CONSTRAINT "report_sections_body_check" CHECK (char_length("report_sections"."body") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid,
	"schedule_id" uuid,
	"title" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_status_check" CHECK ("reports"."status" in ('draft','published')),
	CONSTRAINT "reports_locale_check" CHECK ("reports"."locale" in ('ar','en')),
	CONSTRAINT "reports_period_check" CHECK ("reports"."period_end" >= "reports"."period_start"),
	CONSTRAINT "reports_title_check" CHECK (char_length("reports"."title") between 1 and 200),
	CONSTRAINT "reports_published_check" CHECK (("reports"."status" = 'published') = ("reports"."snapshot" is not null and "reports"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_channels" ADD CONSTRAINT "campaign_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_channels" ADD CONSTRAINT "campaign_channels_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_channels" ADD CONSTRAINT "campaign_channels_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_kpis" ADD CONSTRAINT "campaign_kpis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_kpis" ADD CONSTRAINT "campaign_kpis_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_kpis" ADD CONSTRAINT "campaign_kpis_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_kpis" ADD CONSTRAINT "campaign_kpis_channel_id_campaign_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."campaign_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_imports" ADD CONSTRAINT "metric_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_imports" ADD CONSTRAINT "metric_imports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_imports" ADD CONSTRAINT "metric_imports_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_imports" ADD CONSTRAINT "metric_imports_channel_id_campaign_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."campaign_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_imports" ADD CONSTRAINT "metric_imports_imported_by_profiles_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_channel_id_campaign_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."campaign_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_import_id_metric_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."metric_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_published_by_profiles_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_channels_campaign_idx" ON "campaign_channels" USING btree ("campaign_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_kpis_metric_idx" ON "campaign_kpis" USING btree ("campaign_id",coalesce("channel_id", '00000000-0000-0000-0000-000000000000'::uuid),"metric");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_org_number_idx" ON "campaigns" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "campaigns_client_idx" ON "campaigns" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_owner_idx" ON "campaigns" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "metric_imports_campaign_idx" ON "metric_imports" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_daily_channel_date_idx" ON "metrics_daily" USING btree ("channel_id","date");--> statement-breakpoint
CREATE INDEX "metrics_daily_campaign_date_idx" ON "metrics_daily" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE INDEX "metrics_daily_client_date_idx" ON "metrics_daily" USING btree ("client_id","date");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("is_active","next_run_on");--> statement-breakpoint
CREATE INDEX "report_schedules_client_idx" ON "report_schedules" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "report_sections_report_idx" ON "report_sections" USING btree ("report_id","sort_order");--> statement-breakpoint
CREATE INDEX "reports_client_idx" ON "reports" USING btree ("client_id","status","period_end");--> statement-breakpoint
CREATE INDEX "reports_campaign_idx" ON "reports" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_campaign_idx" ON "requests" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "deliverables_campaign_idx" ON "deliverables" USING btree ("campaign_id");