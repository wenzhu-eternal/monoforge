ALTER TABLE "notifications" RENAME COLUMN "read" TO "is_read";--> statement-breakpoint
DROP INDEX "idx_notifications_user_read_created";--> statement-breakpoint
CREATE INDEX "idx_notifications_user_read_created" ON "notifications" USING btree ("user_id","is_read","created_at");
