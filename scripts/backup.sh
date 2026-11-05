#!/bin/bash
# 数据库备份脚本
# 用法:
#   pnpm db:backup                    # 通过 docker exec 调容器内 pg_dump，写入 $BACKUP_DIR
#
# 注意: 备份文件为 psql 原生格式（含 \restrict / COPY FROM stdin），恢复用 pnpm db:restore。
# 定时备份由后端 ScheduleService（@Cron + ENABLE_BACKUP）负责，本脚本供迁移/升级前手动快照。
# BACKUP_DIR 优先级：环境变量 > 根目录 .env > apps/server/backups；相对路径按后端 cwd 解析。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/db-env.sh"

CONTAINER="${POSTGRES_CONTAINER:-$(env_value POSTGRES_CONTAINER)}"
DB_USER="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"
DB_NAME="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"
: "${CONTAINER:=mf-postgres}"
: "${DB_USER:=monoforge_user}"
: "${DB_NAME:=monoforge_database}"

# L20：与 restore.sh 同口径校验库名——原备份侧无校验，怪值库名会静默导错库
if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]*$ ]]; then
  echo "❌ 非法数据库名: $DB_NAME（仅允许字母/数字/下划线/连字符，且不得以连字符开头）"
  exit 1
fi

echo "目标: 容器=$CONTAINER 用户=$DB_USER 数据库=$DB_NAME"

BACKUP_DIR="$(resolve_backup_dir)"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).sql"
TMP_FILE="$BACKUP_FILE.tmp"
MIN_BYTES="${BACKUP_MIN_BYTES:-$(env_value BACKUP_MIN_BYTES)}"
: "${MIN_BYTES:=1024}"
echo "备份目录: $BACKUP_DIR"

# M5：与后端 cron 同口径——先写 .tmp，校验大小后再 rename 定稿。
# 原实现直接 `> "$BACKUP_FILE"`，pg_dump 失败时 set -e 中止但 0 字节 .sql 已落盘，
# 反而成为 mtime 最新文件，restore 默认拾取后"恢复成功"的是空库
trap 'rm -f "$TMP_FILE"' EXIT

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" > "$TMP_FILE"

SIZE=$(wc -c < "$TMP_FILE" | tr -d ' ')
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "❌ 备份产物过小（$SIZE B < 下限 $MIN_BYTES B），疑似截断或空产物"
  exit 1
fi

mv "$TMP_FILE" "$BACKUP_FILE"
trap - EXIT
echo "备份完成: $BACKUP_FILE ($SIZE B)"
