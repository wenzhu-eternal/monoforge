DROP INDEX "idx_notifications_user_created";--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "resource" SET DATA TYPE varchar(100);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_created" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_resource" ON "audit_logs" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "idx_error_logs_resolved_created" ON "error_logs" USING btree ("is_resolved","created_at");--> statement-breakpoint
CREATE INDEX "idx_error_logs_user_created" ON "error_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_error_logs_source_created" ON "error_logs" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_read_created" ON "notifications" USING btree ("user_id","read","created_at");