CREATE TABLE "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"deal_id" uuid,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"owner_id" uuid,
	"reminded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_activities_type_check" CHECK ("crm_activities"."type" in ('call','meeting','email','whatsapp','note','task')),
	CONSTRAINT "crm_activities_parent_check" CHECK ("crm_activities"."lead_id" is not null or "crm_activities"."deal_id" is not null),
	CONSTRAINT "crm_activities_subject_check" CHECK (char_length("crm_activities"."subject") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "crm_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"stale_days" integer DEFAULT 7 NOT NULL,
	"onboarding_request_type_id" uuid,
	"onboarding_template_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_settings_stale_check" CHECK ("crm_settings"."stale_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "crm_webhook_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"job_title" text,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_contacts_name_check" CHECK (char_length("deal_contacts"."full_name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "deal_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"lead_id" uuid,
	"company" text,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"value_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"probability" integer DEFAULT 10 NOT NULL,
	"expected_close_date" date,
	"owner_id" uuid,
	"package_id" uuid,
	"source" text,
	"lost_reason" text,
	"lost_note" text,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"client_id" uuid,
	"converted_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale_notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_status_check" CHECK ("deals"."status" in ('open','won','lost')),
	CONSTRAINT "deals_value_check" CHECK ("deals"."value_minor" >= 0),
	CONSTRAINT "deals_probability_check" CHECK ("deals"."probability" between 0 and 100),
	CONSTRAINT "deals_title_check" CHECK (char_length("deals"."title") between 1 and 160),
	CONSTRAINT "deals_lost_reason_check" CHECK ("deals"."lost_reason" is null or "deals"."lost_reason" in ('price','timing','competitor','no_response','not_fit','other'))
);
--> statement-breakpoint
CREATE TABLE "lead_assignment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"match_services" text[] DEFAULT '{}'::text[] NOT NULL,
	"match_cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"match_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"thank_you" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submissions" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_forms_name_check" CHECK (char_length("lead_forms"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"full_name" text NOT NULL,
	"company" text,
	"phone" text,
	"email" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_detail" text,
	"external_ref" text,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"budget_range" text DEFAULT 'unknown' NOT NULL,
	"city" text,
	"owner_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"form_id" uuid,
	"merged_into_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_source_check" CHECK ("leads"."source" in ('website_form','whatsapp','instagram','referral','event','lead_ad','manual','other')),
	CONSTRAINT "leads_status_check" CHECK ("leads"."status" in ('new','contacted','qualified','unqualified','converted','merged')),
	CONSTRAINT "leads_budget_check" CHECK ("leads"."budget_range" in ('under_5k','5k_15k','15k_50k','50k_plus','unknown')),
	CONSTRAINT "leads_score_check" CHECK ("leads"."score" between 0 and 100),
	CONSTRAINT "leads_name_check" CHECK (char_length("leads"."full_name") between 1 and 120),
	CONSTRAINT "leads_contact_check" CHECK ("leads"."phone" is not null or "leads"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"kind" text DEFAULT 'open' NOT NULL,
	"probability" integer DEFAULT 10 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_kind_check" CHECK ("pipeline_stages"."kind" in ('open','won','lost')),
	CONSTRAINT "pipeline_stages_probability_check" CHECK ("pipeline_stages"."probability" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"package_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric DEFAULT 1 NOT NULL,
	"unit_price_minor" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quote_items_quantity_check" CHECK ("quote_items"."quantity" > 0),
	CONSTRAINT "quote_items_price_check" CHECK ("quote_items"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" date,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" in ('draft','sent','accepted','declined')),
	CONSTRAINT "quotes_locale_check" CHECK ("quotes"."locale" in ('ar','en')),
	CONSTRAINT "quotes_discount_check" CHECK ("quotes"."discount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid,
	"month" date NOT NULL,
	"amount_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_targets_amount_check" CHECK ("sales_targets"."amount_minor" >= 0),
	CONSTRAINT "sales_targets_month_check" CHECK (extract(day from "sales_targets"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "member_capacity" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hours_per_week" numeric DEFAULT 40 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_capacity_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "member_capacity_hours_check" CHECK ("member_capacity"."hours_per_week" between 0 and 80)
);
--> statement-breakpoint
CREATE TABLE "service_efforts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"department_id" uuid NOT NULL,
	"hours" numeric NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_efforts_hours_check" CHECK ("service_efforts"."hours" >= 0 and "service_efforts"."hours" <= 200)
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"kind" text DEFAULT 'annual' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_kind_check" CHECK ("time_off"."kind" in ('annual','sick','other')),
	CONSTRAINT "time_off_range_check" CHECK ("time_off"."end_date" >= "time_off"."start_date")
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_files" ADD CONSTRAINT "crm_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_files" ADD CONSTRAINT "crm_files_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_files" ADD CONSTRAINT "crm_files_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_onboarding_request_type_id_request_types_id_fk" FOREIGN KEY ("onboarding_request_type_id") REFERENCES "public"."request_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_onboarding_template_id_workflow_templates_id_fk" FOREIGN KEY ("onboarding_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_tokens" ADD CONSTRAINT "crm_webhook_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_webhook_tokens" ADD CONSTRAINT "crm_webhook_tokens_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_from_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_to_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignment_rules" ADD CONSTRAINT "lead_assignment_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_forms" ADD CONSTRAINT "lead_forms_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_form_id_lead_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."lead_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_id_leads_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capacity" ADD CONSTRAINT "member_capacity_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capacity" ADD CONSTRAINT "member_capacity_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_efforts" ADD CONSTRAINT "service_efforts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_efforts" ADD CONSTRAINT "service_efforts_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activities_lead_idx" ON "crm_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activities_deal_idx" ON "crm_activities" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activities_due_idx" ON "crm_activities" USING btree ("organization_id","owner_id","due_at") WHERE "crm_activities"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "crm_files_deal_idx" ON "crm_files" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_files_path_idx" ON "crm_files" USING btree ("storage_path");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_webhook_tokens_hash_idx" ON "crm_webhook_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "deal_contacts_deal_idx" ON "deal_contacts" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_contacts_one_primary_idx" ON "deal_contacts" USING btree ("deal_id") WHERE "deal_contacts"."is_primary";--> statement-breakpoint
CREATE INDEX "deal_stage_history_deal_idx" ON "deal_stage_history" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_org_number_idx" ON "deals" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "deals_org_status_idx" ON "deals" USING btree ("organization_id","status","expected_close_date");--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "deals_owner_idx" ON "deals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deals_lead_idx" ON "deals" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_assignment_rules_org_idx" ON "lead_assignment_rules" USING btree ("organization_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_forms_token_idx" ON "lead_forms" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_number_idx" ON "leads" USING btree ("organization_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_external_ref_idx" ON "leads" USING btree ("organization_id","source","external_ref");--> statement-breakpoint
CREATE INDEX "leads_org_status_idx" ON "leads" USING btree ("organization_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("organization_id","phone");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("organization_id",lower("email"));--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_idx" ON "pipeline_stages" USING btree ("pipeline_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_one_default_idx" ON "pipelines" USING btree ("organization_id") WHERE "pipelines"."is_default";--> statement-breakpoint
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("quote_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_org_number_idx" ON "quotes" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "quotes_deal_idx" ON "quotes" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_org_owner_month_idx" ON "sales_targets" USING btree ("organization_id",coalesce("owner_id", '00000000-0000-0000-0000-000000000000'::uuid),"month");--> statement-breakpoint
CREATE UNIQUE INDEX "service_efforts_org_item_dept_idx" ON "service_efforts" USING btree ("organization_id","item_type","department_id");--> statement-breakpoint
CREATE INDEX "time_off_user_idx" ON "time_off" USING btree ("user_id","start_date");