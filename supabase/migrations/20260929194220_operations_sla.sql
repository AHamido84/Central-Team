CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_breaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"policy_id" uuid,
	"kind" text NOT NULL,
	"level" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"note" text,
	CONSTRAINT "sla_breaches_kind_check" CHECK ("sla_breaches"."kind" in ('response','resolution')),
	CONSTRAINT "sla_breaches_level_check" CHECK ("sla_breaches"."level" in ('at_risk','breached')),
	CONSTRAINT "sla_breaches_note_length_check" CHECK ("sla_breaches"."note" is null or char_length("sla_breaches"."note") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"client_id" uuid,
	"request_type_id" uuid,
	"priority" text,
	"response_hours" integer DEFAULT 8 NOT NULL,
	"resolution_days" integer,
	"pause_on_client" boolean DEFAULT true NOT NULL,
	"at_risk_percent" integer DEFAULT 75 NOT NULL,
	"escalate_to" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_policies_priority_check" CHECK ("sla_policies"."priority" is null or "sla_policies"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "sla_policies_response_check" CHECK ("sla_policies"."response_hours" between 1 and 240),
	CONSTRAINT "sla_policies_resolution_check" CHECK ("sla_policies"."resolution_days" is null or "sla_policies"."resolution_days" between 1 and 90),
	CONSTRAINT "sla_policies_at_risk_check" CHECK ("sla_policies"."at_risk_percent" between 50 and 95)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "business_hours_start" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "business_hours_end" integer DEFAULT 1020 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "sla_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "response_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "sla_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "sla_paused_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_policy_id_sla_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."sla_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_acknowledged_by_profiles_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_escalate_to_profiles_id_fk" FOREIGN KEY ("escalate_to") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_org_date_idx" ON "holidays" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_breaches_request_kind_level_idx" ON "sla_breaches" USING btree ("request_id","kind","level");--> statement-breakpoint
CREATE INDEX "sla_breaches_org_detected_idx" ON "sla_breaches" USING btree ("organization_id","detected_at");--> statement-breakpoint
CREATE INDEX "sla_breaches_client_idx" ON "sla_breaches" USING btree ("client_id","detected_at");--> statement-breakpoint
CREATE INDEX "sla_policies_org_idx" ON "sla_policies" USING btree ("organization_id","is_active");