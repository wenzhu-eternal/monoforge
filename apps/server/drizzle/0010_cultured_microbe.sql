ALTER TABLE "users" DROP CONSTRAINT "users_wechat_open_id_unique";--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "user_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "resource_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "error_logs" ALTER COLUMN "user_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "error_logs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_unique" ON "permissions" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_unique" ON "roles" USING btree ("name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_wechat_open_id_unique" ON "users" USING btree ("wechat_open_id") WHERE deleted_at IS NULL;