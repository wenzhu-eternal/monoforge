// DTO 桥接检查器（R10）：解析 controller 真实 import 符号，确认 @Body() 参数类型确实经 createZodDto 桥接。
// 用法：node scripts/check-zod-dto.cjs [baseDir]（baseDir 默认 apps/server/src，含 modules/ 子目录）
// 退出码 0=通过；1=存在未真正接入 Zod 的 @Body() 参数（issues 打印到 stdout）。
const fs = require('node:fs')
const path = require('node:path')

const baseDir = process.argv[2] || 'apps/server/src'

function walk(dir, match) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full, match)
    return match(full) ? [full] : []
  })
}

// 按「文件 → 桥接类名集合」建索引，避免按类名全局查找导致跨文件同名裸类误判通过
const bridgedByFile = new Map()
for (const file of walk(baseDir, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
  const source = fs.readFileSync(file, 'utf8')
  for (const m of source.matchAll(/class\s+([A-Za-z0-9_]+)\s+extends\s+createZodDto\s*\(/g)) {
    if (!bridgedByFile.has(file)) bridgedByFile.set(file, new Set())
    bridgedByFile.get(file).add(m[1])
  }
}

// 解析 import / import type 语句（含别名），返回本地名 → { imported, module, isTypeOnly }
function parseImports(source) {
  const imports = []
  const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g
  for (const m of source.matchAll(re)) {
    const isTypeOnly = Boolean(m[1])
    for (const raw of m[2].split(',')) {
      const spec = raw.trim()
      if (!spec) continue
      const as = spec.match(/^([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)$/)
      const imported = as ? as[1] : spec
      const local = as ? as[2] : spec
      imports.push({ local, imported, module: m[3], isTypeOnly })
    }
  }
  return imports
}

// 相对导入解析到 .ts 文件（createZodDto DTO 均走 ./dto/ 相对导入）
function resolveModule(baseDir, module) {
  if (!module.startsWith('.')) return null
  const joined = path.join(baseDir, module)
  if (fs.existsSync(`${joined}.ts`)) return `${joined}.ts`
  if (fs.existsSync(joined)) return joined
  return null
}

const issues = []
const controllersDir = path.join(baseDir, 'modules')
for (const file of walk(controllersDir, (f) => f.endsWith('.controller.ts'))) {
  const source = fs.readFileSync(file, 'utf8')
  const importByLocal = new Map(parseImports(source).map((i) => [i.local, i]))
  const base = path.dirname(file)

  for (const m of source.matchAll(/@Body\(\s*\)/g)) {
    const line = source.slice(0, m.index).split('\n').length
    // 跨行取参数声明：先剥掉夹在 @Body() 与参数之间的其它参数装饰器
    const tail = source.slice(m.index + m[0].length, m.index + m[0].length + 300)
    const cleaned = tail.replace(/@[A-Za-z0-9_.]+\([^)]*\)/g, ' ').replace(/\s+/g, ' ')
    const param = cleaned.match(/^\s*([A-Za-z0-9_]+)\s*\??\s*:\s*([^,)]+)/)
    if (!param) {
      issues.push(`${file}:${line}: @Body() 缺少带类型标注的参数`)
      continue
    }
    const type = param[2].trim()
    if (!/^[A-Za-z0-9_]+$/.test(type)) {
      issues.push(`${file}:${line}: @Body() 参数类型 "${type}" 非单一 DTO（复杂类型运行时丢失元数据）`)
      continue
    }
    if (!type.endsWith('Dto')) {
      issues.push(`${file}:${line}: @Body() 参数类型 ${type} 不是 DTO（须以 Dto 结尾）`)
      continue
    }
    const imp = importByLocal.get(type)
    if (!imp) {
      issues.push(`${file}:${line}: ${type} 未显式导入，无法确认 createZodDto 桥接来源`)
      continue
    }
    if (imp.isTypeOnly) {
      issues.push(`${file}:${line}: ${type} 经 import type 导入（运行时元数据退化为 Object，未接入 Zod）`)
      continue
    }
    const resolved = resolveModule(base, imp.module)
    if (!resolved) {
      issues.push(`${file}:${line}: ${type} 来源模块 "${imp.module}" 无法解析（非相对导入或文件缺失）`)
      continue
    }
    const bridged = bridgedByFile.get(resolved)
    if (!bridged || !bridged.has(imp.imported)) {
      issues.push(`${file}:${line}: ${type}（${imp.imported}）未在 ${resolved} 中经 createZodDto 桥接`)
      continue
    }
  }
}

if (issues.length > 0) {
  console.log(issues.join('\n'))
  process.exit(1)
}
