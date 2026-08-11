-- F18: 添加 must_change_password 字段，首登强制改密
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
