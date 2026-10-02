CREATE TABLE "request_attachments" (
	"request_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"field_id" text,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_attachments_request_id_file_id_pk" PRIMARY KEY("request_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_side" text NOT NULL,
	"type" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_events_actor_side_check" CHECK ("request_events"."actor_side" in ('agency','client','system')),
	CONSTRAINT "request_events_type_check" CHECK ("request_events"."type" in ('assigned','priority_changed','due_date_changed','flags_changed','brief_updated')),
	CONSTRAINT "request_events_visibility_check" CHECK ("request_events"."visibility" in ('internal','client'))
);
--> statement-breakpoint
CREATE TABLE "request_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"actor_side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_status_history_actor_side_check" CHECK ("request_status_history"."actor_side" in ('agency','client','system')),
	CONSTRAINT "request_status_history_reason_length_check" CHECK ("request_status_history"."reason" is null or char_length("request_status_history"."reason") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "request_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" text DEFAULT 'clipboard-list' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"default_priority" text DEFAULT 'normal' NOT NULL,
	"sla_days" integer,
	"package_item_type" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"form_schema" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_types_category_check" CHECK ("request_types"."category" in ('design','video','content','ads','web','branding','other')),
	CONSTRAINT "request_types_priority_check" CHECK ("request_types"."default_priority" in ('low','normal','high','urgent')),
	CONSTRAINT "request_types_sla_check" CHECK ("request_types"."sla_days" is null or "request_types"."sla_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_type_id" uuid NOT NULL,
	"number" integer,
	"reference" text,
	"title" text DEFAULT '' NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"form_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"reference_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"created_by" uuid,
	"submitted_by" uuid,
	"desired_date" date,
	"due_date" date,
	"is_extra" boolean DEFAULT false NOT NULL,
	"is_billable" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_status_check" CHECK ("requests"."status" in ('draft','submitted','under_review','needs_info','accepted','in_progress','in_review','delivered','closed','rejected','cancelled')),
	CONSTRAINT "requests_priority_check" CHECK ("requests"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "requests_title_length_check" CHECK (char_length("requests"."title") <= 140 and ("requests"."status" = 'draft' or char_length("requests"."title") >= 3))
);
--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "request_prefix" text;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_profiles_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_submitted_by_profiles_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_attachments_file_idx" ON "request_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "request_events_request_idx" ON "request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "request_status_history_request_idx" ON "request_status_history" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "request_types_org_key_idx" ON "request_types" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_client_number_idx" ON "requests" USING btree ("client_id","number");--> statement-breakpoint
CREATE INDEX "requests_client_status_idx" ON "requests" USING btree ("client_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "requests_org_status_idx" ON "requests" USING btree ("organization_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "requests_assignee_idx" ON "requests" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "requests_type_idx" ON "requests" USING btree ("request_type_id");--> statement-breakpoint
CREATE INDEX "requests_created_by_idx" ON "requests" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "domain_event_deliveries_pending_idx" ON "domain_event_deliveries" USING btree ("next_attempt_at") WHERE "domain_event_deliveries"."processed_at" is null;