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
done < <(find apps/server/src -name "*.service.ts" -not -name "audit.service.ts" -type f)

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
    if ! sed -n "$((LINE_NUM)),$((LINE_NUM + 8))p" "$file" | grep -q 'extractErrorMessage'; then
      echo "$line"
    fi
  done || true)

  # 排除已知合理例外（login/setup/websocket 全局拦截器兜底）
  # L13：按文件名排除——原 grep 作用在"行号:代码内容"上，按内容匹配白名单永不命中
  if [ -n "$BAD_CATCH" ] && ! echo "$file" | grep -q -E '(login\.tsx|setup\.tsx|websocket)'; then
    CATCH_ISSUES="${CATCH_ISSUES}\n${file}:\n${BAD_CATCH}\n"
  fi
done < <(find apps/web/src -name "*.tsx" -type f)

if [ -z "$CATCH_ISSUES" ]; then
  check_pass "前端所有 catch 块都调用 extractErrorMessage"
else
  check_warn "以下 catch 块可能未调用 extractErrorMessage（需人工复核）："
  echo -e "$CATCH_ISSUES"
fi

section "5. 环境变量完整性"
echo "  → 从 env schema 读取必填键，对比 .env.example 与根 .env（Q19）..."

# 项目采用单一根 .env（apps/server/src/env-loader.ts 加载 ../../.env），不在 apps/server/ 下单独放 .env
if [ ! -f .env.example ]; then
  check_warn ".env.example 不存在（文档必需）"
else
  # Q19：必填键以 envSchema 为单一来源——原依赖 .env.example 的中文 [必填] 行内注释，
  # 注释被机器化重排版即静默掏空门。schema 中无 default 且非 optional 的键即必填
  REQUIRED_KEYS=$(pnpm --filter=@monoforge/server exec tsx -e \
    "import { envSchema } from './src/config/env.ts'; const shape=(envSchema as any).shape ?? (envSchema as any)._def?.schema?.shape; console.log(Object.entries(shape).filter(([,s]:[string,any])=>!(s.isOptional?.() ?? false) && s._def?.typeName!=='ZodDefault').map(([k])=>k).join('\n'))" \
    2>/dev/null | sed '/^$/d' | sort)
  if [ -z "$REQUIRED_KEYS" ]; then
    check_warn "无法从 env schema 读取必填键，回退 .env.example 的 [必填] 标记"
    REQUIRED_KEYS=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env.example | grep '\[必填\]' | cut -d= -f1 | sort)
  fi

  # 5a：schema 必填键必须全部在 .env.example 有文档（缺失即文档漂移，阻断）
  EXAMPLE_KEYS=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env.example | cut -d= -f1 | sort)
  EXAMPLE_DIFF=$(comm -23 <(echo "$REQUIRED_KEYS") <(echo "$EXAMPLE_KEYS") 2>/dev/null || true)
  if [ -z "$EXAMPLE_DIFF" ]; then
    check_pass ".env.example 已覆盖 env schema 的全部必填键"
  else
    check_fail ".env.example 缺少以下 env schema 必填键（文档漂移）："
    echo "$EXAMPLE_DIFF" | sed 's/^/    /'
  fi

  # 5b：根 .env 必须包含全部必填键（开发机缺失，服务启动会失败）
  if [ ! -f .env ]; then
    check_warn "根目录 .env 不存在（开发环境必需，可从 .env.example 复制）"
  else
    ENV_DIFF=$(comm -23 <(echo "$REQUIRED_KEYS") \
      <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | cut -d= -f1 | sort) \
      2>/dev/null || true)
    if [ -z "$ENV_DIFF" ]; then
      check_pass "根 .env 包含 env schema 全部必填变量"
    else
      check_fail ".env 缺少以下必填变量（服务将启动失败）："
      echo "$ENV_DIFF" | sed 's/^/    /'
    fi
  fi
fi

section "6. 依赖安全扫描"
echo "  → pnpm audit --json（官方 registry，结构化解级）..."
# M1-M3 教训：内网 registry 无 audit 端点时"无结论"不等于"无漏洞"，必须实跑官方源
AUDIT_NET_ERROR_RE='ERR_PNPM_AUDIT_(ENDPOINT_NOT_EXISTS|BAD_RESPONSE)|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|ERR_PNPM_META_FETCH_FAIL'

# L12：按 metadata.vulnerabilities 结构化取数——原文本 grep (high|critical) 会被
# advisory 标题/包名中的关键词假红，且 pnpm 输出格式变化即假绿
audit_count() {
  node -e '
    const fs = require("fs")
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      const v = j.metadata?.vulnerabilities ?? {}
      const keys = process.argv[2] === "high" ? ["high", "critical"] : ["low", "moderate", "info"]
      process.stdout.write(String(keys.reduce((n, k) => n + (v[k] ?? 0), 0)))
    } catch {
      process.stdout.write("parse_error")
    }
  ' "$1" "$2"
}

# set -e 下 audit 发现漏洞会以 1 退出——必须显式兜住，后续按 JSON 判级
pnpm audit --json --prod --registry=https://registry.npmjs.org > /tmp/audit-prod.json 2>/tmp/audit-prod.err || true
PROD_HIGH=$(audit_count /tmp/audit-prod.json high)
PROD_LOW=$(audit_count /tmp/audit-prod.json low)

if [ "$PROD_HIGH" = "parse_error" ]; then
  if grep -q -E "$AUDIT_NET_ERROR_RE" /tmp/audit-prod.err /tmp/audit-prod.json 2>/dev/null; then
    check_warn "依赖审计无结论（registry audit 端点不可用或网络故障，非漏洞；如需扫描请切换官方 registry）"
  else
    check_warn "依赖审计输出无法解析（无结论，见 /tmp/audit-prod.err）"
  fi
elif [ "$PROD_HIGH" -gt 0 ] 2>/dev/null; then
  check_fail "生产依赖树存在 ${PROD_HIGH} 个高危/严重漏洞（见 /tmp/audit-prod.json）"
else
  check_warn "生产依赖树有 ${PROD_LOW} 个低/中危漏洞（见 /tmp/audit-prod.json）"
fi

# 全量（含 devDependencies）覆盖：不进入门禁，仅提示 dev 树的高危残留
pnpm audit --json --registry=https://registry.npmjs.org > /tmp/audit-full.json 2>/tmp/audit-full.err || true
FULL_HIGH=$(audit_count /tmp/audit-full.json high)
if [ "$FULL_HIGH" != "parse_error" ] && [ "$PROD_HIGH" != "parse_error" ]; then
  DEV_HIGH=$((FULL_HIGH - PROD_HIGH))
  if [ "$DEV_HIGH" -gt 0 ]; then
    check_warn "devDependencies 依赖树另有 ${DEV_HIGH} 个高危/严重漏洞（不进生产门禁，见 /tmp/audit-full.json）"
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
  # L12：原正则只匹配裸 any/object/Record，真正要防的"未挂 Zod DTO 的伪 interface 类型"
  # 完全漏过（对新代码零防护力）。改为反查：@Body() 的类型参数必须以 Dto 结尾
  while IFS= read -r line; do
    TYPE=$(printf '%s' "$line" | sed -E 's/.*@Body\(\)[[:space:]]*[A-Za-z0-9_]+[[:space:]]*:[[:space:]]*([A-Za-z0-9_]+).*/\1/')
    if [[ "$TYPE" != *Dto ]]; then
      RAW_BODY_ISSUES="${RAW_BODY_ISSUES}\n${file}:\n  ${line}"
    fi
  done < <(
    grep -n -E '@Body\(\)[[:space:]]*[A-Za-z0-9_]+[[:space:]]*:[[:space:]]*[A-Za-z0-9_]+' "$file" || true
  )
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
