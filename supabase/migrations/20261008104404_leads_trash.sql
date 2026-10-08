ALTER TABLE "trash_items" DROP CONSTRAINT "trash_items_type_check";--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "delete_batch" uuid;--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_type_check" CHECK ("trash_items"."entity_type" in ('client','client_user','member','package','request_type','workflow_template','request','task','folder','file','deliverable','deliverable_version','comment','lead'));