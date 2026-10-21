CREATE INDEX "idx_error_logs_created_at" ON "error_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_created_at" ON "notifications" USING btree ("created_at");