-- FR3.2 / ADR-089: a failed assistant reply stores why (an ai_* failure code) so the thread shows a specific reason.
ALTER TABLE "ai_messages" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_reason_check" CHECK ("ai_messages"."reason" is null or "ai_messages"."reason" ~ '^ai_[a-z_]{1,40}$');
