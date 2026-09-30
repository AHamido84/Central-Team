CREATE TABLE "integration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" char(3),
	"timezone" text,
	"client_id" uuid,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_accounts_kind_check" CHECK ("integration_accounts"."kind" in ('ad_account','page','whatsapp_number','analytics_property'))
);
--> statement-breakpoint
CREATE TABLE "integration_campaign_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"external_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"platform_status" text,
	"channel_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"mode" text DEFAULT 'live' NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"external_user_id" text,
	"external_name" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"token_expires_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_message" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_provider_check" CHECK ("integration_connections"."provider" in ('meta','whatsapp','tiktok','snapchat','google')),
	CONSTRAINT "integration_connections_mode_check" CHECK ("integration_connections"."mode" in ('live','sandbox')),
	CONSTRAINT "integration_connections_status_check" CHECK ("integration_connections"."status" in ('connected','expired','error','disconnected')),
	CONSTRAINT "integration_connections_name_check" CHECK (char_length("integration_connections"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "integration_secrets" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"secret_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"account_id" uuid,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"campaigns" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_sync_runs_trigger_check" CHECK ("integration_sync_runs"."trigger" in ('manual','scheduled','backfill','retry')),
	CONSTRAINT "integration_sync_runs_status_check" CHECK ("integration_sync_runs"."status" in ('queued','running','succeeded','failed')),
	CONSTRAINT "integration_sync_runs_range_check" CHECK ("integration_sync_runs"."date_to" >= "integration_sync_runs"."date_from" and "integration_sync_runs"."date_to" - "integration_sync_runs"."date_from" <= 90)
);
--> statement-breakpoint
CREATE TABLE "integration_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"provider" text NOT NULL,
	"connection_id" uuid,
	"account_id" uuid,
	"external_id" text,
	"topic" text DEFAULT 'other' NOT NULL,
	"signature_valid" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"payload" jsonb,
	"lead_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "integration_webhook_events_provider_check" CHECK ("integration_webhook_events"."provider" in ('meta','whatsapp','tiktok','snapchat','google')),
	CONSTRAINT "integration_webhook_events_topic_check" CHECK ("integration_webhook_events"."topic" in ('lead','message_status','message','verification','other')),
	CONSTRAINT "integration_webhook_events_status_check" CHECK ("integration_webhook_events"."status" in ('received','processed','ignored','failed','rejected'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"to_phone" text NOT NULL,
	"template_name" text NOT NULL,
	"language" text NOT NULL,
	"params" text[] DEFAULT '{}'::text[] NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"purpose" text NOT NULL,
	"lead_id" uuid,
	"deal_id" uuid,
	"recipient_user_id" uuid,
	"automation_run_id" uuid,
	"notification_type" text,
	"external_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_purpose_check" CHECK ("whatsapp_messages"."purpose" in ('notification','lead','automation')),
	CONSTRAINT "whatsapp_messages_status_check" CHECK ("whatsapp_messages"."status" in ('queued','sent','delivered','read','failed')),
	CONSTRAINT "whatsapp_messages_language_check" CHECK ("whatsapp_messages"."language" in ('ar','en'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_opt_ins" (
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"opted_in_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_opt_ins_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id"),
	CONSTRAINT "whatsapp_opt_ins_phone_check" CHECK ("whatsapp_opt_ins"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL,
	"category" text DEFAULT 'utility' NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"param_count" integer DEFAULT 0 NOT NULL,
	"is_notification" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_templates_language_check" CHECK ("whatsapp_templates"."language" in ('ar','en')),
	CONSTRAINT "whatsapp_templates_category_check" CHECK ("whatsapp_templates"."category" in ('utility','marketing','authentication')),
	CONSTRAINT "whatsapp_templates_status_check" CHECK ("whatsapp_templates"."status" in ('approved','pending','rejected','paused')),
	CONSTRAINT "whatsapp_templates_params_check" CHECK ("whatsapp_templates"."param_count" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"event_id" uuid,
	"event_type" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"skip_reason" text,
	"depth" smallint DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "automation_runs_status_check" CHECK ("automation_runs"."status" in ('running','succeeded','failed','skipped')),
	CONSTRAINT "automation_runs_skip_check" CHECK ("automation_runs"."skip_reason" is null or "automation_runs"."skip_reason" in ('conditions','loop_depth','loop_self','rate_limited'))
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"trigger_type" text NOT NULL,
	"match" text DEFAULT 'all' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_match_check" CHECK ("automations"."match" in ('all','any')),
	CONSTRAINT "automations_name_check" CHECK (char_length("automations"."name") between 1 and 120),
	CONSTRAINT "automations_description_check" CHECK (char_length("automations"."description") <= 1000),
	CONSTRAINT "automations_actions_check" CHECK (jsonb_typeof("automations"."actions") = 'array' and jsonb_array_length("automations"."actions") between 1 and 10),
	CONSTRAINT "automations_conditions_check" CHECK (jsonb_typeof("automations"."conditions") = 'array' and jsonb_array_length("automations"."conditions") <= 20)
);
--> statement-breakpoint
ALTER TABLE "domain_events" ADD COLUMN "automation_depth" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_events" ADD COLUMN "automation_chain" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_campaign_links" ADD CONSTRAINT "integration_campaign_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_campaign_links" ADD CONSTRAINT "integration_campaign_links_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_campaign_links" ADD CONSTRAINT "integration_campaign_links_channel_id_campaign_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."campaign_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_profiles_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_requested_by_profiles_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_webhook_events" ADD CONSTRAINT "integration_webhook_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_recipient_user_id_profiles_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sent_by_profiles_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_ins" ADD CONSTRAINT "whatsapp_opt_ins_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_opt_ins" ADD CONSTRAINT "whatsapp_opt_ins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."domain_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_requested_by_profiles_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_accounts_external_idx" ON "integration_accounts" USING btree ("connection_id","kind","external_id");--> statement-breakpoint
CREATE INDEX "integration_accounts_route_idx" ON "integration_accounts" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "integration_accounts_client_idx" ON "integration_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_campaign_links_external_idx" ON "integration_campaign_links" USING btree ("account_id","external_campaign_id");--> statement-breakpoint
CREATE INDEX "integration_campaign_links_channel_idx" ON "integration_campaign_links" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "integration_connections_org_idx" ON "integration_connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "integration_sync_runs_connection_idx" ON "integration_sync_runs" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_sync_runs_due_idx" ON "integration_sync_runs" USING btree ("next_attempt_at") WHERE "integration_sync_runs"."status" in ('queued','failed');--> statement-breakpoint
CREATE UNIQUE INDEX "integration_webhook_events_dedup_idx" ON "integration_webhook_events" USING btree ("provider","external_id") WHERE "integration_webhook_events"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "integration_webhook_events_org_idx" ON "integration_webhook_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX "integration_webhook_events_pending_idx" ON "integration_webhook_events" USING btree ("received_at") WHERE "integration_webhook_events"."status" in ('received','failed');--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_external_idx" ON "whatsapp_messages" USING btree ("external_id") WHERE "whatsapp_messages"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_lead_idx" ON "whatsapp_messages" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_deal_idx" ON "whatsapp_messages" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_org_idx" ON "whatsapp_messages" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_name_idx" ON "whatsapp_templates" USING btree ("connection_id","name","language");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_notification_idx" ON "whatsapp_templates" USING btree ("organization_id","language") WHERE "whatsapp_templates"."is_notification";--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_event_idx" ON "automation_runs" USING btree ("automation_id","event_id") WHERE not "automation_runs"."dry_run";--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id","started_at");--> statement-breakpoint
CREATE INDEX "automation_runs_org_idx" ON "automation_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX "automations_trigger_idx" ON "automations" USING btree ("organization_id","trigger_type") WHERE "automations"."is_active";