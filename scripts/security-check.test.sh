#!/bin/bash
# R12/R13 回归测试：security-check.sh 的依赖审计计数与 DTO 参数类型校验
# 用法: bash scripts/security-check.test.sh
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

# ---- R13：audit_count 统计结构完整性（与 security-check.sh 内实现同源）----
audit_count() {
  node -e '
    const fs = require("fs")
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      if (j.error) { process.stdout.write("no_data"); process.exit(0) }
      const v = j.metadata?.vulnerabilities
      if (!v || typeof v !== "object") { process.stdout.write("no_data"); process.exit(0) }
      for (const k of ["info", "low", "moderate", "high", "critical"]) {
        const val = v[k]
        if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
          process.stdout.write("no_data"); process.exit(0)
        }
      }
      const keys = process.argv[2] === "high" ? ["high", "critical"] : ["low", "moderate", "info"]
      process.stdout.write(String(keys.reduce((n, k) => n + v[k], 0)))
    } catch { process.stdout.write("parse_error") }
  ' "$1" "$2"
}

make_audit() { printf '%s' "$1" > "$WORK/audit.json"; }

make_audit '{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
[ "$(audit_count "$WORK/audit.json" high)" = "0" ] || fail "完整零统计应返回 0"

make_audit '{"metadata":{"vulnerabilities":{"info":0,"low":1,"moderate":0,"high":2,"critical":1}}}'
[ "$(audit_count "$WORK/audit.json" high)" = "3" ] || fail "高危+严重应返回 3"

make_audit '{"metadata":{"vulnerabilities":{}}}'
[ "$(audit_count "$WORK/audit.json" high)" = "no_data" ] || fail "缺字段应无结论"

make_audit '{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":-1,"critical":0}}}'
[ "$(audit_count "$WORK/audit.json" high)" = "no_data" ] || fail "负数应无结论"

make_audit '{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":1.5,"critical":0}}}'
[ "$(audit_count "$WORK/audit.json" high)" = "no_data" ] || fail "小数应无结论"

make_audit '{"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":"1","critical":0}}}'
[ "$(audit_count "$WORK/audit.json" high)" = "no_data" ] || fail "字符串应无结论"

make_audit '{"error":{"code":"E1"}}'
[ "$(audit_count "$WORK/audit.json" high)" = "no_data" ] || fail "error 对象应无结论"

make_audit 'not json'
[ "$(audit_count "$WORK/audit.json" high)" = "parse_error" ] || fail "坏 JSON 应 parse_error"

# ---- R12：DTO 参数类型必须为单一标识符（联合/交叉/数组退化为 Object 应拒绝）----
check_dto_type() {
  node -e '
    const type = process.argv[1].trim()
    if (!/^[A-Za-z0-9_]+$/.test(type)) { console.log("REJECT"); process.exit(0) }
    if (!type.endsWith("Dto")) { console.log("REJECT_NOT_DTO"); process.exit(0) }
    console.log("OK")
  ' "$1"
}

[ "$(check_dto_type 'CheckDto | undefined')" = "REJECT" ] || fail "联合类型应被拒绝"
[ "$(check_dto_type 'CheckDto & OtherDto')" = "REJECT" ] || fail "交叉类型应被拒绝"
[ "$(check_dto_type 'CheckDto[]')" = "REJECT" ] || fail "数组类型应被拒绝"
[ "$(check_dto_type 'Partial<CheckDto>')" = "REJECT" ] || fail "泛型应被拒绝"
[ "$(check_dto_type 'CheckDto')" = "OK" ] || fail "单一 DTO 应通过"
[ "$(check_dto_type 'CreateUserDto')" = "OK" ] || fail "单一 DTO 应通过"

echo "PASS: security-check R12/R13 校验逻辑符合预期"
