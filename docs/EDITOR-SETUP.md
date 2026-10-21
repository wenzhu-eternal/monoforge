# 编辑器配置规范

## VSCode 配置（本地示例，未入库）

仓库未跟踪 `.vscode/`（被 `.gitignore` 忽略）；以下为本地配置示例，团队成员需自行复制/创建，clone 后不会自动生效。

### `.vscode/extensions.json`

推荐扩展：
- `biomejs.biome` — Biome：lint + format（替代 ESLint + Prettier）
- `bradlc.vscode-tailwindcss` — Tailwind v4 智能提示
- `tanstack-query.tanstack-query-vscode` — TanStack Query Devtools
- `streetsidesoftware.code-spell-checker` / `-chinese` — 拼写检查
- `mikestead.dotenv` — .env 语法高亮
- `redhat.vscode-yaml` — YAML 语法

禁用扩展：
- `dbaeumer.vscode-eslint`（已被 Biome 替代）
- `esbenp.prettier-vscode`（已被 Biome 替代）

### `.vscode/settings.json`

关键设置：
- `editor.formatOnSave: true` + `editor.defaultFormatter: "biomejs.biome"` — 保存时自动格式化
- `editor.codeActionsOnSave` — 保存时自动 quickfix + organizeImports
- `typescript.tsdk: "node_modules/typescript/lib"` — **强制使用 workspace TS 6.0**（解决 `ignoreDeprecations: "6.0"` 在 IDE 中爆红的问题，IDE 内置 TS 5.x 不识别该值）
- `editor.rulers: [100]` — 100 字符行宽标尺
- `files.eol: "\n"` — 统一 LF 换行
- `search.exclude` / `files.watcherExclude` — 排除 node_modules/dist/.turbo

> **复制配置后首次打开项目时**：VSCode 会弹窗提示「使用工作区 TypeScript 版本」，点击「允许」即可。如未弹窗，按 `Cmd+Shift+P` → `TypeScript: Select TypeScript Version` → 选择「Use Workspace Version」。

## EditorConfig

已落地 `.editorconfig`（根目录）：

- UTF-8 + LF 换行
- 2 空格缩进（所有语言）
- 行尾自动插入空行
- 行尾空格自动修剪
- 行宽 100 字符
- Markdown 保留行尾空格（两个空格 = 换行）

## Biome 配置

已落地 `biome.json`（根目录）：

- 继承 `recommended` preset
- `noExplicitAny: warn`（不阻断提交，仅警告）
- `noUnusedImports: warn` + `noUnusedVariables: warn`
- `noUnusedFunctionParameters: off`（NestJS DI 经常有未用参数）
- `useImportType: off`（避免 NestJS DI 的类型导入问题）
- `noNonNullAssertion: off`（NestJS 常见 `!` 断言）
- 格式化：2 空格 + 单引号 + 无分号 + 行宽 100
- `formatWithErrors: false`（有语法错误时跳过格式化，避免把错误文件写坏）
- 包含范围：ts/tsx/js/jsx/json/yaml/yml/md

## Git Hooks

### pre-commit（lint-staged）

提交前自动格式化 + lint 暂存区文件：

```bash
# .husky/pre-commit
pnpm lint-staged
```

### lint-staged 配置

已落地在 `package.json`：

```jsonc
"lint-staged": {
  "*.{ts,tsx,js,jsx}": ["biome check --write"],
  "*.json": ["biome format --write"]
}
```

> 注意：当前 lint-staged 仅对 `*.json` 做格式化，Markdown/YAML 需手动执行 `pnpm format`。

提交信息规范见 [CONVENTIONS.md](./CONVENTIONS.md) 的「提交规范」章节。

## 常见编辑器对齐

### WebStorm / IntelliJ

- Settings → Languages & Frameworks → Biome：启用 Biome 作为 formatter
- Settings → Editor → Code Style：设置 2 空格缩进 + 100 行宽
- 关闭 ESLint + Prettier

### Neovim / Vim

- 用 `nvim-lspconfig` 接入 Biome LSP
- `format-on-save` 调用 `biome format --write`
