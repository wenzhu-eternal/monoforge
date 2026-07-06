ALTER TABLE "error_logs" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "error_whitelist" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;