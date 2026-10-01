-- L20：存量 username/email 归一小写（新写入已由 zod schema 统一小写化，历史数据须对齐，
-- 否则唯一索引仍区分大小写）。仅更新含大写的行，软删行一并归一保证恢复路径一致。
-- 若存在仅大小写不同的活跃账号（如 'Admin' 与 'admin'），UPDATE 会触发唯一索引冲突使迁移失败——
-- 属预期防护：先人工合并/改名后重跑即可
UPDATE "users" SET "username" = LOWER("username"), "email" = LOWER("email") WHERE "username" <> LOWER("username") OR "email" <> LOWER("email");--> statement-breakpoint
