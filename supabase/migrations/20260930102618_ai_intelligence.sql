-- pgvector for ai_chunks.embedding (Supabase keeps extensions in the `extensions` schema, which is on the search path).
create extension if not exists vector with schema extensions;
--> statement-breakpoint
CREATE TABLE "ai_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedding_model" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_chunks_source_type_check" CHECK ("ai_chunks"."source_type" in ('client','campaign','request','task','report','lead','deal','insight')),
	CONSTRAINT "ai_chunks_content_check" CHECK (char_length("ai_chunks"."content") <= 8000)
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_conversations_title_check" CHECK (char_length("ai_conversations"."title") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"channel_id" uuid,
	"kind" text NOT NULL,
	"metric" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dedupe_key" text NOT NULL,
	"detected_on" date NOT NULL,
	"facts" jsonb NOT NULL,
	"explanation" text,
	"explanation_locale" text,
	"explained_at" timestamp with time zone,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"dismiss_reason" text,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_insights_kind_check" CHECK ("ai_insights"."kind" in ('spike','drop','kpi_off_track','kpi_at_risk','budget_overspent','budget_overpace','budget_underpace','delivery_stopped')),
	CONSTRAINT "ai_insights_severity_check" CHECK ("ai_insights"."severity" in ('info','warning','critical')),
	CONSTRAINT "ai_insights_status_check" CHECK ("ai_insights"."status" in ('open','acknowledged','dismissed','resolved')),
	CONSTRAINT "ai_insights_explanation_locale_check" CHECK ("ai_insights"."explanation_locale" is null or "ai_insights"."explanation_locale" in ('ar','en')),
	CONSTRAINT "ai_insights_dismiss_reason_check" CHECK ("ai_insights"."dismiss_reason" is null or char_length("ai_insights"."dismiss_reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_role_check" CHECK ("ai_messages"."role" in ('user','assistant')),
	CONSTRAINT "ai_messages_status_check" CHECK ("ai_messages"."status" in ('ok','failed','refused','budget','disabled','no_sources')),
	CONSTRAINT "ai_messages_content_check" CHECK (char_length("ai_messages"."content") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "ai_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"insight_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"task_id" uuid,
	"dismiss_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_recommendations_kind_check" CHECK ("ai_recommendations"."kind" in ('shift_budget','reduce_budget','increase_budget','refresh_creative','review_targeting','check_tracking','resume_delivery')),
	CONSTRAINT "ai_recommendations_status_check" CHECK ("ai_recommendations"."status" in ('proposed','accepted','dismissed')),
	CONSTRAINT "ai_recommendations_dismiss_reason_check" CHECK ("ai_recommendations"."dismiss_reason" is null or char_length("ai_recommendations"."dismiss_reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"auto_draft_reports" boolean DEFAULT false NOT NULL,
	"monthly_token_budget" integer DEFAULT 2000000 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_sensitivity_check" CHECK ("ai_settings"."sensitivity" in ('low','normal','high')),
	CONSTRAINT "ai_settings_budget_check" CHECK ("ai_settings"."monthly_token_budget" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_purpose_check" CHECK ("ai_usage"."purpose" in ('assistant','report_draft','insight_explain','embedding')),
	CONSTRAINT "ai_usage_provider_check" CHECK ("ai_usage"."provider" in ('anthropic','voyage','mock'))
);
--> statement-breakpoint
ALTER TABLE "ai_chunks" ADD CONSTRAINT "ai_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chunks" ADD CONSTRAINT "ai_chunks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_channel_id_campaign_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."campaign_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_acted_by_profiles_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_insight_id_ai_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."ai_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_chunks_source_idx" ON "ai_chunks" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "ai_chunks_org_idx" ON "ai_chunks" USING btree ("organization_id","embedding_model");--> statement-breakpoint
CREATE INDEX "ai_chunks_embedding_idx" ON "ai_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "ai_conversations_user_idx" ON "ai_conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_insights_dedupe_idx" ON "ai_insights" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "ai_insights_campaign_idx" ON "ai_insights" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "ai_insights_org_idx" ON "ai_insights" USING btree ("organization_id","status","last_detected_at");--> statement-breakpoint
CREATE INDEX "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_recommendations_insight_kind_idx" ON "ai_recommendations" USING btree ("insight_id","kind");--> statement-breakpoint
CREATE INDEX "ai_recommendations_campaign_idx" ON "ai_recommendations" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "ai_usage_org_idx" ON "ai_usage" USING btree ("organization_id","created_at");