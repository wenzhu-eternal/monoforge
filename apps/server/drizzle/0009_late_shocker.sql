ALTER TABLE "permissions" DROP CONSTRAINT "permissions_code_unique";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_name_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_active_uniq" ON "roles" ("name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_active_uniq" ON "permissions" ("code") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_active_uniq" ON "users" ("username") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_active_uniq" ON "users" ("email") WHERE "deleted_at" IS NULL;
