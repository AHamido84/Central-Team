CREATE TABLE "annotation_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"annotation_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"author_side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotation_replies_author_side_check" CHECK ("annotation_replies"."author_side" in ('agency','client')),
	CONSTRAINT "annotation_replies_body_check" CHECK (char_length("annotation_replies"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"file_id" uuid,
	"kind" text NOT NULL,
	"x" numeric,
	"y" numeric,
	"time_seconds" numeric,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'client' NOT NULL,
	"author_id" uuid,
	"author_side" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotations_kind_check" CHECK ("annotations"."kind" in ('point','timestamp','general')),
	CONSTRAINT "annotations_visibility_check" CHECK ("annotations"."visibility" in ('internal','client')),
	CONSTRAINT "annotations_author_side_check" CHECK ("annotations"."author_side" in ('agency','client')),
	CONSTRAINT "annotations_body_check" CHECK (char_length("annotations"."body") between 1 and 5000),
	CONSTRAINT "annotations_position_check" CHECK (("annotations"."kind" <> 'point' or ("annotations"."x" between 0 and 1 and "annotations"."y" between 0 and 1 and "annotations"."file_id" is not null))
        and ("annotations"."kind" <> 'timestamp' or ("annotations"."time_seconds" >= 0 and "annotations"."file_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"decision" text NOT NULL,
	"reviewer_id" uuid,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_stage_check" CHECK ("approvals"."stage" in ('internal','client')),
	CONSTRAINT "approvals_decision_check" CHECK ("approvals"."decision" in ('approved','changes_requested')),
	CONSTRAINT "approvals_comment_check" CHECK (char_length("approvals"."comment") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "deliverable_version_files" (
	"version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "deliverable_version_files_version_id_file_id_pk" PRIMARY KEY("version_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "deliverable_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"number" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"uploaded_by" uuid,
	"submitted_at" timestamp with time zone,
	"sent_to_client_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverable_versions_status_check" CHECK ("deliverable_versions"."status" in ('draft','internal_review','internal_changes','client_review','client_changes','approved','superseded')),
	CONSTRAINT "deliverable_versions_notes_check" CHECK (char_length("deliverable_versions"."notes") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_id" uuid,
	"task_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"requires_internal_review" boolean DEFAULT true NOT NULL,
	"requires_client_approval" boolean DEFAULT true NOT NULL,
	"current_version_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"revision_rounds" integer DEFAULT 0 NOT NULL,
	"scheduled_for" date,
	"approved_at" timestamp with time zone,
	"client_visible_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliverables_type_check" CHECK ("deliverables"."type" in ('design','video','copy','document','other')),
	CONSTRAINT "deliverables_status_check" CHECK ("deliverables"."status" in ('in_progress','internal_review','internal_changes','client_review','client_changes','approved')),
	CONSTRAINT "deliverables_title_check" CHECK (char_length("deliverables"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"layout" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_layout_check" CHECK ("saved_views"."layout" in ('board','list','table','calendar')),
	CONSTRAINT "saved_views_name_check" CHECK (char_length("saved_views"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"task_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_attachments_task_id_file_id_pk" PRIMARY KEY("task_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_checklist_items_body_check" CHECK (char_length("task_checklist_items"."body") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_id_pk" PRIMARY KEY("task_id","depends_on_id"),
	CONSTRAINT "task_dependencies_self_check" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "task_members" (
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_members_task_id_user_id_role_pk" PRIMARY KEY("task_id","user_id","role"),
	CONSTRAINT "task_members_role_check" CHECK ("task_members"."role" in ('assignee','watcher'))
);
--> statement-breakpoint
CREATE TABLE "task_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" jsonb NOT NULL,
	"category" text NOT NULL,
	"color" text DEFAULT 'neutral' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_statuses_category_check" CHECK ("task_statuses"."category" in ('todo','active','review','changes','done','blocked')),
	CONSTRAINT "task_statuses_color_check" CHECK ("task_statuses"."color" in ('neutral','info','primary','accent','warning','danger','success'))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"request_id" uuid,
	"parent_id" uuid,
	"workflow_template_id" uuid,
	"workflow_step_id" uuid,
	"number" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"department_id" uuid,
	"status_id" uuid NOT NULL,
	"status_category" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"start_date" date,
	"due_date" date,
	"estimate_minutes" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"reviewer_id" uuid,
	"position" numeric DEFAULT 0 NOT NULL,
	"step_order" integer,
	"requires_internal_review" boolean DEFAULT false NOT NULL,
	"requires_client_approval" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_soon_notified_for" date,
	"overdue_notified_for" date,
	CONSTRAINT "tasks_title_check" CHECK (char_length("tasks"."title") between 1 and 200),
	CONSTRAINT "tasks_description_check" CHECK (char_length("tasks"."description") <= 20000),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "tasks_status_category_check" CHECK ("tasks"."status_category" in ('todo','active','review','changes','done','blocked')),
	CONSTRAINT "tasks_estimate_check" CHECK ("tasks"."estimate_minutes" is null or "tasks"."estimate_minutes" between 0 and 100000),
	CONSTRAINT "tasks_dates_check" CHECK ("tasks"."start_date" is null or "tasks"."due_date" is null or "tasks"."start_date" <= "tasks"."due_date"),
	CONSTRAINT "tasks_parent_check" CHECK ("tasks"."parent_id" is distinct from "tasks"."id")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'timer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_source_check" CHECK ("time_entries"."source" in ('timer','manual')),
	CONSTRAINT "time_entries_minutes_check" CHECK ("time_entries"."minutes" between 0 and 1440),
	CONSTRAINT "time_entries_note_check" CHECK (char_length("time_entries"."note") <= 500),
	CONSTRAINT "time_entries_range_check" CHECK ("time_entries"."ended_at" is null or "time_entries"."ended_at" >= "time_entries"."started_at")
);
--> statement-breakpoint
CREATE TABLE "workflow_template_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"department_id" uuid,
	"assignee_mode" text DEFAULT 'none' NOT NULL,
	"assignee_role_id" uuid,
	"assignee_user_id" uuid,
	"sla_days" integer DEFAULT 1 NOT NULL,
	"depends_on" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"requires_internal_review" boolean DEFAULT false NOT NULL,
	"requires_client_approval" boolean DEFAULT false NOT NULL,
	"deliverable_type" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_template_steps_assignee_mode_check" CHECK ("workflow_template_steps"."assignee_mode" in ('account_manager','role','user','none')),
	CONSTRAINT "workflow_template_steps_sla_check" CHECK ("workflow_template_steps"."sla_days" between 0 and 60),
	CONSTRAINT "workflow_template_steps_deliverable_type_check" CHECK ("workflow_template_steps"."deliverable_type" is null or "workflow_template_steps"."deliverable_type" in ('design','video','copy','document','other')),
	CONSTRAINT "workflow_template_steps_approval_check" CHECK (not "workflow_template_steps"."requires_client_approval" or "workflow_template_steps"."deliverable_type" is not null),
	CONSTRAINT "workflow_template_steps_review_check" CHECK (not "workflow_template_steps"."requires_internal_review" or "workflow_template_steps"."deliverable_type" is not null)
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_type_id" uuid,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_source_check";--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT "threads_subject_type_check";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "thumbnail_path" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "duration_seconds" numeric;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "approval_reminder_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "annotation_replies" ADD CONSTRAINT "annotation_replies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_replies" ADD CONSTRAINT "annotation_replies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_replies" ADD CONSTRAINT "annotation_replies_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_replies" ADD CONSTRAINT "annotation_replies_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_version_id_deliverable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."deliverable_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_resolved_by_profiles_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_version_id_deliverable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."deliverable_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewer_id_profiles_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_version_files" ADD CONSTRAINT "deliverable_version_files_version_id_deliverable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."deliverable_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_version_files" ADD CONSTRAINT "deliverable_version_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_version_files" ADD CONSTRAINT "deliverable_version_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_version_files" ADD CONSTRAINT "deliverable_version_files_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_current_version_id_deliverable_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."deliverable_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_done_by_profiles_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_members" ADD CONSTRAINT "task_members_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_members" ADD CONSTRAINT "task_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_members" ADD CONSTRAINT "task_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_members" ADD CONSTRAINT "task_members_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_template_id_workflow_templates_id_fk" FOREIGN KEY ("workflow_template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_step_id_workflow_template_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_template_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_task_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."task_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_id_profiles_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_steps" ADD CONSTRAINT "workflow_template_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_steps" ADD CONSTRAINT "workflow_template_steps_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_steps" ADD CONSTRAINT "workflow_template_steps_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_steps" ADD CONSTRAINT "workflow_template_steps_assignee_role_id_roles_id_fk" FOREIGN KEY ("assignee_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_template_steps" ADD CONSTRAINT "workflow_template_steps_assignee_user_id_profiles_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotation_replies_annotation_idx" ON "annotation_replies" USING btree ("annotation_id","created_at");--> statement-breakpoint
CREATE INDEX "annotations_version_idx" ON "annotations" USING btree ("version_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_version_idx" ON "approvals" USING btree ("version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_version_stage_idx" ON "approvals" USING btree ("version_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_version_files_file_idx" ON "deliverable_version_files" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_versions_number_idx" ON "deliverable_versions" USING btree ("deliverable_id","number");--> statement-breakpoint
CREATE INDEX "deliverables_client_idx" ON "deliverables" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "deliverables_request_idx" ON "deliverables" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "deliverables_task_idx" ON "deliverables" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "saved_views_owner_idx" ON "saved_views" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "task_checklist_items_task_idx" ON "task_checklist_items" USING btree ("task_id","sort_order");--> statement-breakpoint
CREATE INDEX "task_dependencies_depends_idx" ON "task_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX "task_members_user_idx" ON "task_members" USING btree ("user_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "task_statuses_org_key_idx" ON "task_statuses" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "task_statuses_default_idx" ON "task_statuses" USING btree ("organization_id") WHERE "task_statuses"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_org_number_idx" ON "tasks" USING btree ("organization_id","number");--> statement-breakpoint
CREATE INDEX "tasks_client_idx" ON "tasks" USING btree ("client_id","status_category");--> statement-breakpoint
CREATE INDEX "tasks_request_idx" ON "tasks" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE INDEX "time_entries_task_idx" ON "time_entries" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "time_entries" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_running_idx" ON "time_entries" USING btree ("user_id") WHERE "time_entries"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_template_steps_template_idx" ON "workflow_template_steps" USING btree ("template_id","sort_order");--> statement-breakpoint
CREATE INDEX "workflow_templates_org_idx" ON "workflow_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_default_idx" ON "workflow_templates" USING btree ("request_type_id") WHERE "workflow_templates"."is_default" and "workflow_templates"."request_type_id" is not null;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_source_check" CHECK ("files"."source" in ('library','attachment','deliverable'));--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_subject_type_check" CHECK ("threads"."subject_type" in ('client','request','deliverable','task'));