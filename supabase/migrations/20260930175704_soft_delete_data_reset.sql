CREATE TABLE "data_reset_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"step" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"files_removed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_reset_jobs_mode_check" CHECK ("data_reset_jobs"."mode" in ('demo','operational','factory')),
	CONSTRAINT "data_reset_jobs_status_check" CHECK ("data_reset_jobs"."status" in ('queued','running','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "trash_items" (
	"batch" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trash_items_type_check" CHECK ("trash_items"."entity_type" in ('client','client_user','member','package','request_type','workflow_template','request','task','folder','file','deliverable','deliverable_version','comment'))
);
--> statement-breakpoint
ALTER TABLE "client_users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_users" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "client_users" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "file_folders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "file_folders" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "file_folders" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "data_reset_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "request_types" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_types" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "request_types" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "request_types" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_webhook_tokens" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_assignment_rules" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "data_reset_jobs" ADD CONSTRAINT "data_reset_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_reset_jobs_org_idx" ON "data_reset_jobs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "trash_items_org_idx" ON "trash_items" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "trash_items_entity_idx" ON "trash_items" USING btree ("entity_type","entity_id");