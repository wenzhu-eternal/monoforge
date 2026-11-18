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

# ---- R10：真实 DTO 检查器解析导入符号（type-only / 同名裸类 / 别名 / 复杂类型）----
mkdir -p "$WORK/src/dto" "$WORK/src/modules"

cat > "$WORK/src/dto/check.dto.ts" <<'EOF'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
export class CheckDto extends createZodDto(z.object({ name: z.string() })) {}
EOF

cat > "$WORK/src/dto/bare.dto.ts" <<'EOF'
export class FakeDto {}
EOF

cat > "$WORK/src/dto/alias.dto.ts" <<'EOF'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
export class RealDto extends createZodDto(z.object({ id: z.number() })) {}
EOF

cat > "$WORK/src/modules/typeonly.controller.ts" <<'EOF'
import type { CheckDto } from '../dto/check.dto'
export class C1 { run(@Body() dto: CheckDto) {} }
EOF

cat > "$WORK/src/modules/bare.controller.ts" <<'EOF'
import { FakeDto } from '../dto/bare.dto'
export class C2 { run(@Body() dto: FakeDto) {} }
EOF

cat > "$WORK/src/modules/alias.controller.ts" <<'EOF'
import { RealDto as MyDto } from '../dto/alias.dto'
export class C3 { run(@Body() dto: MyDto) {} }
EOF

cat > "$WORK/src/modules/complex.controller.ts" <<'EOF'
import { CheckDto } from '../dto/check.dto'
export class C4 { run(@Body() dto: CheckDto | undefined) {} }
EOF

if node scripts/check-zod-dto.cjs "$WORK/src" > "$WORK/out.log" 2>&1; then
  fail "type-only/裸类/复杂类型应被拒绝"
fi
grep -q "import type 导入" "$WORK/out.log" || fail "type-only 导入应被识别"
grep -q "未在.*经 createZodDto 桥接" "$WORK/out.log" || fail "同名裸类应被识别"
grep -q "非单一 DTO" "$WORK/out.log" || fail "复杂类型应被识别"
# 合法值导入别名不应被误报
if grep -q "MyDto" "$WORK/out.log"; then fail "合法值导入别名不应被误报"; fi

# 仅合法 DTO 的干净 fixture 应通过
rm -rf "$WORK/src/modules"
mkdir -p "$WORK/src/modules"
cat > "$WORK/src/modules/ok.controller.ts" <<'EOF'
import { CheckDto } from '../dto/check.dto'
export class COk { run(@Body() dto: CheckDto) {} }
EOF
node scripts/check-zod-dto.cjs "$WORK/src" > "$WORK/ok.log" 2>&1 || fail "合法值导入 DTO 应通过"

echo "PASS: security-check R10/R13 校验逻辑符合预期"
