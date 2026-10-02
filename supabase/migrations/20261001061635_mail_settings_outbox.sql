CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"kind" text NOT NULL,
	"to_email" text NOT NULL,
	"user_id" uuid,
	"locale" text DEFAULT 'ar' NOT NULL,
	"subject" text NOT NULL,
	"html" text,
	"text" text,
	"reply_to" text,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"provider" text,
	"sender" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"resent_from" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_status_check" CHECK ("email_outbox"."status" in ('queued','sending','sent','failed')),
	CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('magic_link','recovery','email_change','invitation','notification','security_notice','report','test','other')),
	CONSTRAINT "email_outbox_sender_check" CHECK ("email_outbox"."sender" is null or "email_outbox"."sender" in ('configured','environment','fallback','dev'))
);
--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"host" text,
	"port" integer,
	"security" text DEFAULT 'starttls' NOT NULL,
	"username" text,
	"from_name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"daily_limit" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"secret_id" uuid,
	"secret_hint" text DEFAULT '' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"last_success_at" timestamp with time zone,
	"fallback_since" timestamp with time zone,
	"limit_warned_on" date,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_settings_preset_check" CHECK ("mail_settings"."preset" in ('gmail','google_workspace','microsoft365','zoho','resend','smtp')),
	CONSTRAINT "mail_settings_security_check" CHECK ("mail_settings"."security" in ('starttls','ssl','none')),
	CONSTRAINT "mail_settings_port_check" CHECK ("mail_settings"."port" is null or "mail_settings"."port" between 1 and 65535),
	CONSTRAINT "mail_settings_limit_check" CHECK ("mail_settings"."daily_limit" is null or "mail_settings"."daily_limit" between 1 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("next_attempt_at") WHERE "email_outbox"."status" in ('queued','failed');--> statement-breakpoint
CREATE INDEX "email_outbox_org_idx" ON "email_outbox" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_settings_org_idx" ON "mail_settings" USING btree ("organization_id");