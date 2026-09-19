#!/usr/bin/env bash
# 安全 + 兼容性 + 规范检测脚本
# 用法：pnpm security
# 退出码：0 全部通过，非 0 表示有失败项

set -euo pipefail

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
WARN=0

section() {
  echo ""
  echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

check_pass() {
  echo -e "${GREEN}  ✅ $1${NC}"
  PASS=$((PASS + 1))
}

check_fail() {
  echo -e "${RED}  ❌ $1${NC}"
  FAIL=$((FAIL + 1))
}

check_warn() {
  echo -e "${YELLOW}  ⚠️  $1${NC}"
  WARN=$((WARN + 1))
}

section "1. TypeScript 类型检查"
echo "  → server tsc --noEmit..."
if pnpm --filter=server exec tsc --noEmit > /tmp/tsc-server.log 2>&1; then
  check_pass "server tsc 通过"
else
  check_fail "server tsc 失败（见 /tmp/tsc-server.log）"
  cat /tmp/tsc-server.log | head -20
fi

echo "  → web tsc --noEmit..."
if pnpm --filter=web exec tsc --noEmit > /tmp/tsc-web.log 2>&1; then
  check_pass "web tsc 通过"
else
  check_fail "web tsc 失败（见 /tmp/tsc-web.log）"
  cat /tmp/tsc-web.log | head -20
fi

section "2. Biome Lint + 格式化检查"
echo "  → biome check..."
if pnpm lint > /tmp/lint.log 2>&1; then
  check_pass "biome lint 通过"
else
  check_fail "biome lint 失败（见 /tmp/lint.log）"
  cat /tmp/lint.log | head -30
fi

section "3. 软删除过滤审计"
echo "  → 扫描所有 service.ts 中缺失软删除过滤的查询..."

SOFT_DELETE_ISSUES=""
# 函数级扫描：软删除过滤常在查询前若干行预先计算（如 const deletedFilter = maybeDeleted(...)），
# 故需向前回溯 25 行 + 向后 8 行，覆盖 notDeleted/maybeDeleted/includeDeleted/deletedFilter 四种写法。
# 白名单：restore()/*Raw() 方法与显式注明"故意不过滤"的查询需读取软删记录，属正确设计。
# 排除 audit.service（审计日志故意查全量）
while IFS= read -r file; do
  while IFS=: read -r line_num _; do
    START=$((line_num > 25 ? line_num - 25 : 1))
    WINDOW=$(sed -n "${START},$((line_num + 8))p" "$file")

    if echo "$WINDOW" | grep -qE 'async (restore|[a-zA-Z]*Raw)\(|故意不过滤|不带 deletedAt 过滤'; then
      continue
    fi

    if ! echo "$WINDOW" | grep -qE 'notDeleted|maybeDeleted|includeDeleted|deletedFilter'; then
      content=$(sed -n "${line_num}p" "$file")
      if ! echo "$content" | grep -qE '^\s*//'; then
        SOFT_DELETE_ISSUES="${SOFT_DELETE_ISSUES}${file}:${line_num}: ${content}\n"
      fi
    fi
  done < <(grep -n -E '(findFirst|findMany|count\(\))' "$file" || true)
done < <(find apps/server/src/modules -name "*.service.ts" -not -name "audit.service.ts" -type f)

if [ -z "$SOFT_DELETE_ISSUES" ]; then
  check_pass "所有 service 查询都有软删除过滤（或已标注故意不过滤）"
else
  check_warn "以下查询可能缺软删除过滤（需人工复核）："
  echo -e "$SOFT_DELETE_ISSUES"
fi

section "4. 前端 catch 块审计"
echo "  → 扫描前端 tsx 中不读 error 的 catch..."

CATCH_ISSUES=""
while IFS= read -r file; do
  # 查找 catch { 或 catch (xxx) 但没调用 extractErrorMessage
  BAD_CATCH=$(grep -n -E 'catch\s*(\(\s*\w*\s*\))?\s*\{' "$file" | while IFS= read -r line; do
    LINE_NUM=$(echo "$line" | cut -d: -f1)
    if ! sed -n "$((LINE_NUM)),$((LINE_NUM + 3))p" "$file" | grep -q 'extractErrorMessage'; then
      echo "$line"
    fi
  done || true)

  if [ -n "$BAD_CATCH" ]; then
    # 排除已知合理例外（login/setup/websocket 全局拦截器兜底）
    REAL_CATCH=$(echo "$BAD_CATCH" | grep -v -E '(login\.tsx|setup\.tsx|websocket)' || true)
    if [ -n "$REAL_CATCH" ]; then
      CATCH_ISSUES="${CATCH_ISSUES}\n${file}:\n${REAL_CATCH}\n"
    fi
  fi
done < <(find apps/web/src -name "*.tsx" -type f)

if [ -z "$CATCH_ISSUES" ]; then
  check_pass "前端所有 catch 块都调用 extractErrorMessage"
else
  check_warn "以下 catch 块可能未调用 extractErrorMessage（需人工复核）："
  echo -e "$CATCH_ISSUES"
fi

section "5. 环境变量完整性"
echo "  → 对比根 .env 与 .env.example 的 [必填] 变量..."

# 项目采用单一根 .env（apps/server/src/env-loader.ts 加载 ../../.env），不在 apps/server/ 下单独放 .env
if [ ! -f .env ]; then
  check_warn "根目录 .env 不存在（开发环境必需，可从 .env.example 复制）"
elif [ ! -f .env.example ]; then
  check_warn ".env.example 不存在（文档必需）"
else
  # 仅校验 [必填] 变量；[可选] 变量有默认值，缺失不影响启动
  ENV_DIFF=$(comm -23 \
    <(grep -E '^[A-Z_]+=' .env.example | grep '\[必填\]' | cut -d= -f1 | sort) \
    <(grep -E '^[A-Z_]+=' .env | cut -d= -f1 | sort) \
    2>/dev/null || true)

  if [ -z "$ENV_DIFF" ]; then
    check_pass "根 .env 包含 .env.example 所有 [必填] 变量"
  else
    check_fail ".env 缺少以下 [必填] 变量（服务将启动失败）："
    echo "$ENV_DIFF" | sed 's/^/    /'
  fi
fi

section "6. 依赖安全扫描"
echo "  → pnpm audit --prod..."
if pnpm audit --prod > /tmp/audit.log 2>&1; then
  check_pass "无已知高危依赖漏洞"
else
  # 国内镜像源（npmmirror 等）不实现 audit 端点，非真实漏洞，跳过以免噪音
  if grep -q 'ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS' /tmp/audit.log; then
    check_pass "当前 registry 不支持 audit 端点，已跳过（如需扫描请切换至官方 registry）"
  elif grep -q -E '(high|critical)' /tmp/audit.log; then
    check_fail "发现高危依赖漏洞（见 /tmp/audit.log）"
    grep -E '(high|critical)' /tmp/audit.log | head -10
  else
    check_warn "有低/中危依赖漏洞（见 /tmp/audit.log）"
  fi
fi

section "7. 文档内部链接有效性"
echo "  → 检查 markdown 内部链接..."

DOC_LINK_ISSUES=""
while IFS= read -r md_file; do
  # 提取 [text](./xxx.md) 或 [text](docs/xxx.md) 格式链接
  while IFS= read -r link; do
    LINK_PATH=$(echo "$link" | sed -E 's/.*\]\(([^)]+)\).*/\1/')
    if [[ "$LINK_PATH" =~ ^https?:// ]] || [[ "$LINK_PATH" =~ ^# ]]; then
      continue
    fi

    DIR=$(dirname "$md_file")
    TARGET="$DIR/$LINK_PATH"

    if [ ! -f "$TARGET" ]; then
      DOC_LINK_ISSUES="${DOC_LINK_ISSUES}\n${md_file}: 链接 ${LINK_PATH} 不存在\n"
    fi
  done < <(grep -oE '\]\([^)]+\)' "$md_file" || true)
done < <(find . -name "*.md" -not -path "./node_modules/*" -not -path "./.git/*" -type f)

if [ -z "$DOC_LINK_ISSUES" ]; then
  check_pass "所有文档内部链接有效"
else
  check_fail "发现无效文档链接："
  echo -e "$DOC_LINK_ISSUES"
fi

section "8. Zod DTO 桥接审计"
echo "  → 扫描 controller 是否有裸 @Body()..."

RAW_BODY_ISSUES=""
while IFS= read -r file; do
  # 查找 @Body() 后没接 DTO 类型的（裸 @Body() 或 @Body() data: any）
  RAW=$(grep -n -E '@Body\(\)\s+\w+:\s*(any|object|Record)' "$file" || true)
  if [ -n "$RAW" ]; then
    RAW_BODY_ISSUES="${RAW_BODY_ISSUES}\n${file}:\n${RAW}\n"
  fi
done < <(find apps/server/src/modules -name "*.controller.ts" -type f)

if [ -z "$RAW_BODY_ISSUES" ]; then
  check_pass "所有 controller @Body() 都用 DTO 桥接"
else
  check_fail "以下 controller 可能用了裸 @Body()（非 DTO 类型）："
  echo -e "$RAW_BODY_ISSUES"
fi

section "9. 废弃 API 调用扫描"
echo "  → 扫描源码中调用了 @deprecated 符号的位置（IDE 划删除线项）..."

if node scripts/check-deprecated.cjs > /tmp/deprecated.log 2>&1; then
  check_pass "未发现 @deprecated 调用"
else
  check_fail "发现 @deprecated 调用（见 /tmp/deprecated.log）"
  cat /tmp/deprecated.log | head -20
fi

# 汇总
section "汇总"
echo -e "  ${GREEN}通过：${PASS}${NC}  ${YELLOW}警告：${WARN}${NC}  ${RED}失败：${FAIL}${NC}"
echo ""

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}❌ 检测未通过，请修复上述失败项${NC}"
  exit 1
elif [ $WARN -gt 0 ]; then
  echo -e "${YELLOW}⚠️  检测通过，但有 ${WARN} 个警告需人工复核${NC}"
  exit 0
else
  echo -e "${GREEN}✅ 全部检测通过${NC}"
  exit 0
fi
