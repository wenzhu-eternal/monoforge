-- #42: users.roleId FK → ON DELETE SET NULL
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_id_roles_id_fk;
ALTER TABLE users ADD CONSTRAINT users_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL;

-- #43: error_whitelist indexes
CREATE INDEX IF NOT EXISTS idx_error_whitelist_is_active ON error_whitelist(is_active) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_error_whitelist_pattern_unique ON error_whitelist(match_type, pattern) WHERE deleted_at IS NULL;

-- #44: files indexes
CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_files_deleted_at_created_at ON files(deleted_at, created_at);

-- #45: permissions.routes json → jsonb
ALTER TABLE permissions ALTER COLUMN routes TYPE jsonb USING routes::jsonb;
