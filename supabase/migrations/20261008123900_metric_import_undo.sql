ALTER TABLE "metric_imports" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "metric_imports" ADD COLUMN "undone_by" uuid;--> statement-breakpoint
ALTER TABLE "metric_imports" ADD CONSTRAINT "metric_imports_undone_by_profiles_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;