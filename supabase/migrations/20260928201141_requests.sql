CREATE TABLE "request_attachments" (
	"request_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
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
	"visibility" text DEFAULT 'client' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_events_actor_side_check" CHECK ("request_events"."actor_side" in ('agency','client','system')),
	CONSTRAINT "request_events_type_check" CHECK ("request_events"."type" in ('submitted','status_changed','assigned','priority_changed')),
	CONSTRAINT "request_events_visibility_check" CHECK ("request_events"."visibility" in ('internal','client'))
);
--> statement-breakpoint
CREATE TABLE "request_form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"icon" text DEFAULT 'clipboard-list' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"default_priority" text DEFAULT 'normal' NOT NULL,
	"response_sla_hours" integer,
	"resolution_sla_hours" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_forms_status_check" CHECK ("request_forms"."status" in ('draft','published','archived')),
	CONSTRAINT "request_forms_category_check" CHECK ("request_forms"."category" in ('design','video','content','ads','social','other')),
	CONSTRAINT "request_forms_priority_check" CHECK ("request_forms"."default_priority" in ('low','normal','high','urgent')),
	CONSTRAINT "request_forms_sla_check" CHECK (("request_forms"."response_sla_hours" is null or "request_forms"."response_sla_hours" between 1 and 720) and ("request_forms"."resolution_sla_hours" is null or "request_forms"."resolution_sla_hours" between 1 and 2160))
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"submitted_by" uuid,
	"submitted_side" text DEFAULT 'client' NOT NULL,
	"desired_date" date,
	"response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_status_check" CHECK ("requests"."status" in ('submitted','in_review','in_progress','waiting_client','completed','declined','cancelled')),
	CONSTRAINT "requests_priority_check" CHECK ("requests"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "requests_submitted_side_check" CHECK ("requests"."submitted_side" in ('agency','client')),
	CONSTRAINT "requests_title_length_check" CHECK (char_length("requests"."title") between 1 and 140)
);
--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "domain_event_deliveries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_form_versions" ADD CONSTRAINT "request_form_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_form_versions" ADD CONSTRAINT "request_form_versions_form_id_request_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."request_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_form_versions" ADD CONSTRAINT "request_form_versions_published_by_profiles_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_form_versions" ADD CONSTRAINT "request_form_versions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_forms" ADD CONSTRAINT "request_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_forms" ADD CONSTRAINT "request_forms_current_version_id_request_form_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."request_form_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_forms" ADD CONSTRAINT "request_forms_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_form_id_request_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."request_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_form_version_id_request_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."request_form_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_profiles_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_submitted_by_profiles_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_attachments_file_idx" ON "request_attachments" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "request_events_request_idx" ON "request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "request_form_versions_form_version_idx" ON "request_form_versions" USING btree ("form_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "request_form_versions_one_draft_idx" ON "request_form_versions" USING btree ("form_id") WHERE "request_form_versions"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "request_forms_org_key_idx" ON "request_forms" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_org_number_idx" ON "requests" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "requests_client_status_idx" ON "requests" USING btree ("client_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "requests_org_status_idx" ON "requests" USING btree ("organization_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "requests_assignee_idx" ON "requests" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "requests_form_idx" ON "requests" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "domain_event_deliveries_pending_idx" ON "domain_event_deliveries" USING btree ("next_attempt_at") WHERE "domain_event_deliveries"."processed_at" is null;