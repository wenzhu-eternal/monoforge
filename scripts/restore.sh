#!/bin/bash
# 数据库备份恢复脚本
# 用法:
#   pnpm db:restore                  # 恢复最新备份
#   pnpm db:restore apps/server/backups/backup-20260711.sql  # 恢复指定文件
#
# 注意: 恢复会 DROP 并重建数据库，请确认备份文件正确后再执行。
# 备份文件是 pg_dump 的 psql 原生格式（含 \restrict / COPY FROM stdin），
# 必须用 psql 恢复，不能用 Navicat 执行 SQL。

set -e

# L15：连接信息优先级 环境变量 > 根目录 .env（与 docker-compose 同源）> 默认值。
# 原先全部硬编码，改过 .env 的人跑恢复会连到错误的老库（恢复错库=数据事故）
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

if [ -n "$1" ]; then
  BACKUP_FILE="$1"
else
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/*.sql 2>/dev/null | head -1)
fi

if [ -z "$BACKUP_FILE" ]; then
  echo "❌ 未找到备份文件: $BACKUP_DIR/*.sql"
  echo "   用法: pnpm db:restore [备份文件路径]"
  # M10：备份产物在 app 容器内（/app/backups），宿主机看不到时先导出：
  #   docker cp mf-app:/app/backups/. ./backups/
  echo "   容器内备份导出: docker cp mf-app:/app/backups/. ./backups/"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ 备份文件不存在: $BACKUP_FILE"
  exit 1
fi

FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "📂 即将恢复备份: $BACKUP_FILE ($FILE_SIZE)"
echo "⚠️  此操作会 DROP 并重建数据库 $DB_NAME"
read -p "确认继续? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "已取消"
  exit 0
fi

echo ""
echo "🔄 重置数据库..."
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid <> pg_backend_pid();" 2>/dev/null || true
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;"

echo "📥 导入备份（psql 原生格式）..."
cat "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" 2>&1 | grep -E "(ERROR|FATAL|invalid)" && echo "❌ 恢复过程中出现错误" && exit 1 || true

echo ""
echo "✅ 恢复完成: $BACKUP_FILE"
echo "   验证: docker exec $CONTAINER psql -U $DB_USER -d $DB_NAME -c '\\dt'"
