#!/bin/bash
# R04 回归测试：backup.sh 同秒并发不得互相改写产物
# 用法: bash scripts/backup.test.sh
#
# 通过伪造 date（固定同秒）与 docker（输出可区分内容），验证：
# 1. 两个同秒并发备份各自产出独立、完整的 .sql，且无 .tmp 残留
# 2. 失败路径只清理自身临时文件，不删除他人已有产物
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SH="$SCRIPT_DIR/backup.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

fail() { echo "FAIL: $1" >&2; exit 1; }

# 伪造 date：固定同秒，触发并发隔离（否则秒级时间戳必然碰撞）
cat > "$WORK/bin/date" <<'EOF'
#!/bin/bash
if [ "$*" = "+%Y%m%d-%H%M%S" ]; then
  echo "20261116-120000"
  exit 0
fi
/bin/date "$@"
EOF
chmod +x "$WORK/bin/date"

# 伪造 docker：以自身 PID 标记输出，使两次并发备份内容可区分（等长错配也可被检出）
cat > "$WORK/bin/docker" <<'EOF'
#!/bin/bash
echo "DUMP_CONTENT_$$"
EOF
chmod +x "$WORK/bin/docker"

export PATH="$WORK/bin:$PATH"
export BACKUP_DIR="$WORK/backups"
export POSTGRES_CONTAINER="mf-postgres"
export POSTGRES_USER="monoforge_user"
export POSTGRES_DB="monoforge_database"
export BACKUP_MIN_BYTES=1

# ---- 场景 1：两个同秒并发备份均成功 ----
bash "$BACKUP_SH" >"$WORK/a.log" 2>&1 &
P1=$!
bash "$BACKUP_SH" >"$WORK/b.log" 2>&1 &
P2=$!
wait "$P1" || fail "备份 A 失败: $(cat "$WORK/a.log")"
wait "$P2" || fail "备份 B 失败: $(cat "$WORK/b.log")"

COUNT=$(find "$WORK/backups" -name '*.sql' | wc -l | tr -d ' ')
[ "$COUNT" -eq 2 ] || fail "期望 2 个 .sql 产物，实际 $COUNT"

for f in "$WORK"/backups/*.sql; do
  CONTENT=$(cat "$f")
  [[ "$CONTENT" =~ ^DUMP_CONTENT_[0-9]+$ ]] || fail "产物内容异常（非完整单次执行）: $f"
done

TMP_COUNT=$(find "$WORK/backups" -name '*.tmp' | wc -l | tr -d ' ')
[ "$TMP_COUNT" -eq 0 ] || fail "成功后残留 .tmp 文件 $TMP_COUNT 个"

# ---- 场景 2：失败路径只清理自身临时文件，不删除他人产物 ----
rm -rf "$WORK/backups"
mkdir -p "$WORK/backups"
echo "PREEXISTING" > "$WORK/backups/backup-20260101-000000-1-1234.sql"

cat > "$WORK/bin/docker" <<'EOF'
#!/bin/bash
# 输出 0 字节，触发 MIN_BYTES=1 失败
:
EOF
chmod +x "$WORK/bin/docker"

if bash "$BACKUP_SH" >"$WORK/fail.log" 2>&1; then
  fail "期望过小产物备份失败，但实际成功"
fi
[ -f "$WORK/backups/backup-20260101-000000-1-1234.sql" ] || fail "失败清理误删了他人产物"
TMP_COUNT=$(find "$WORK/backups" -name '*.tmp' | wc -l | tr -d ' ')
[ "$TMP_COUNT" -eq 0 ] || fail "失败后残留 .tmp 文件 $TMP_COUNT 个"

echo "PASS: backup.sh 并发隔离与失败清理均符合预期"
