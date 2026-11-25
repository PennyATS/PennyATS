CREATE TABLE "email_template_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "body_html" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "body_html" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "trigger_key" text;--> statement-breakpoint
ALTER TABLE "stage_scheduling_settings" ADD COLUMN "email_template_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_folders_name_idx" ON "email_template_folders" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_folder_id_email_template_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."email_template_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_scheduling_settings" ADD CONSTRAINT "stage_scheduling_settings_email_template_id_email_templates_id_fk" FOREIGN KEY ("email_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_templates_folder_idx" ON "email_templates" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "emails_candidate_idx" ON "emails" USING btree ("candidate_id");--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_trigger_key_unique" UNIQUE("trigger_key");