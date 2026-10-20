#!/bin/bash
# 数据库备份脚本
# 用法:
#   pnpm db:backup                    # 通过 docker exec 调容器内 pg_dump，写入 apps/server/backups/
#
# 注意: 备份文件为 psql 原生格式（含 \restrict / COPY FROM stdin），恢复用 pnpm db:restore。
# 定时备份由后端 ScheduleService（@Cron + ENABLE_BACKUP）负责，本脚本供迁移/升级前手动快照。

set -e

# 连接信息优先级 环境变量 > 根目录 .env（与 restore.sh 同源）> 默认值
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

env_value() {
  if [ -f "$ENV_FILE" ]; then
    grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | tr -d '"' | tr -d "'"
  fi
  return 0
}

CONTAINER="${POSTGRES_CONTAINER:-$(env_value POSTGRES_CONTAINER)}"
DB_USER="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"
DB_NAME="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"
: "${CONTAINER:=mf-postgres}"
: "${DB_USER:=monoforge_user}"
: "${DB_NAME:=monoforge_database}"
echo "目标: 容器=$CONTAINER 用户=$DB_USER 数据库=$DB_NAME"

BACKUP_DIR="apps/server/backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).sql"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_FILE"
echo "备份完成: $BACKUP_FILE"
