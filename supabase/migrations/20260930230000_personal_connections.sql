ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_provider_check";--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "expiry_notified_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_connections_owner_idx" ON "integration_connections" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_provider_check" CHECK ("integration_connections"."provider" in ('meta','whatsapp','tiktok','snapchat','google','x','linkedin'));