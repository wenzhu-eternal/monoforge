#!/bin/bash
# 数据库脚本共享配置：连接信息与备份目录必须与后端 env 同源，避免出现第二套目录

DB_ENV_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DB_ENV_LIB_DIR/../.." && pwd)"
SERVER_DIR="$ROOT_DIR/apps/server"
ENV_FILE="$ROOT_DIR/.env"

env_value() {
  if [ -f "$ENV_FILE" ]; then
    grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"' | tr -d "'"
  fi
  return 0
}

# 优先级：环境变量 > 根目录 .env > 后端默认 apps/server/backups。
# 相对路径按后端进程 cwd（apps/server）解析，与 getEnv().BACKUP_DIR 默认口径一致。
resolve_backup_dir() {
  local configured="${BACKUP_DIR:-$(env_value BACKUP_DIR)}"
  case "$configured" in
    '') printf '%s\n' "$SERVER_DIR/backups" ;;
    /*) printf '%s\n' "$configured" ;;
    *) printf '%s\n' "$SERVER_DIR/$configured" ;;
  esac
}
