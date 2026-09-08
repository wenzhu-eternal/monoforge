# 编码规范

## 契约铁律

1. **改 API 必须先改 `packages/shared/schemas`** - schema 是前后端唯一类型源
2. **禁止前端手抄类型** - 所有类型从 `@shared` 导出，用 `z.infer` 派生
3. **禁止后端绕过 zod 自定义 DTO** - 使用 `nestjs-zod` 桥接，详见「Zod DTO 桥接」章节
4. **错误码集中到 shared** - 前后端共享 `@shared/constants/errors`

## 命名规范

| 类型 | 约定 | 示例 |
|---|---|---|
| 文件 | 模块单文件 `{module}.ts` | `users.service.ts` |
| Schema 文件 | `{resource}.ts` | `user.ts` |
| 路由文件 | TanStack Router 文件式路由 | `users.route.ts` |
| 类（后端） | `{Resource}{Type}` 驼峰后缀 | `UserController` / `UserService` |
| DTO | `{Action}{Resource}Dto` | `CreateUserDto` / `LoginDto` |
| 表名 | snake_case 复数 | `users` / `error_logs` |
| 导出 | 全部命名导出 | `export class ...` |
| Provider/Module | 命名导出 + 模块聚合 | `index.module.ts` |

## 前端交互规范

1. **Table 样式**：所有 `<Table>` 必须加 `bordered`，多操作按钮用 `<Divider orientation="vertical" style={{ margin: '0 4px' }} />` 分隔，操作按钮统一 `type="link" size="small"`
2. **错误提示**：加载失败用 `message.useMessage()` + `useEffect` 监听 `isError` 弹 toast，不再用 `<Alert>` 常驻；`contextHolder` 紧跟外层组件
3. **布局**：顶部不再用 `<Card>` 包裹 Table，标题行右侧放主操作按钮（如"新建"/"上传"）
4. **antd 中文化**：`__root.tsx` 的 `ConfigProvider` 必须配 `locale={zhCN}`，所有 Modal/Popconfirm 默认显示"确定/取消"，不再为每个弹窗单独写 `okText/cancelText`
5. **Table 空状态**：所有 `<Table>` 必须显式配 `locale={{ emptyText: '暂无数据' }}`（或用 `<Empty>` 组件），不依赖 antd 默认英文文案，保证中文化一致性
6. **菜单跳转**：`handleMenuClick` 必须判断 `key.startsWith('/')` 才跳转，分组节点 key（如 `'system'`/`'log'`/`'content'`）不触发 `navigate`
7. **菜单可见性**：admin 专属菜单（如邮件发送）基于 `user?.roles?.some(r => r.name === 'admin')` 判断；普通业务菜单基于 `hasPermission(Permissions.XXX)`

## 前端表单规范

### 编辑表单白名单提交

- **禁止 `...values` 全量透传**：`form.setFieldsValue(整个对象)` + `getFieldsValue(true)` 会携带 schema 不允许的额外字段（如 `id`/`username`/`avatar`/`roleName`/`roles`/`createdAt`），触发 Zod 校验失败
- **编辑分支必须显式挑 schema 允许字段**：构造只含可编辑字段的对象后再提交（如 `email`/`nickname`/`phone`/`roleId`/`status`/`password`）

### Modal 权限回显防覆盖

- **问题**：`useEffect` 依赖 `[serverData]` 时，`invalidateQueries` 后 server data 返回新引用会覆盖用户本地修改（症状：配置权限第一次打开选中正确，修改后再打开全部未选中）
- **解法**：用 `useRef` 跟踪已加载的 roleId，仅在切换到新角色时同步 server data，避免重复初始化

### 删除按钮禁用

- ADMIN_ROLE_ID 匹配的用户（`isAdminUser(user)`）的删除按钮必须 `disabled`，Popconfirm 也禁用并提示「初始管理员账号不可删除」
- 后端 `users.service.remove` 也要二次校验 `if (isAdminUser(existingUser)) throw new ConflictException(...)`

### 校验规则复用 shared schema（禁止手写重复规则）

- **禁止在 antd `rules` 里手写与后端 schema 重复的约束**（长度、正则等）。曾出现前端 `min: 6` 放行、后端 `PasswordSchema` 要求 8 位 + 含字母数字，用户提交后才拿到 400「Validation failed」
- **做法**：在 `apps/web/src/lib/form-rules.ts` 里用 `safeParse` 把 shared schema 包成 antd `Rule`，各表单直接复用（如 `passwordRule`）。schema 改动自动同步到所有表单
- **例外**：登录表单不套注册级密码强度规则（`LoginSchema.password` 只 `min(1)`），否则历史弱密码用户无法登录并走改密流程

### 页面组件拆分（数据 hook 下沉到 AuthenticatedLayout 内层）

- **禁止在 `AuthenticatedLayout` 外层调用 query hook**（如 `useXxxQuery`）：`AuthenticatedLayout` 的 `mustChangePassword` / 权限重定向在内层执行，若 query hook 在外层，`mustChangePassword=true` 的用户一进页面就会触发白名单外的业务请求，被 401 拦截器踢回登录页
- **做法**：每个页面拆成外层 `XxxPage`（仅 `<AuthenticatedLayout><XxxContent /></AuthenticatedLayout>`）+ 内层 `XxxContent`（承载所有 query hook、state、handler、JSX）。mutation hook 留在哪一层不影响（mount 时不发请求），但为一致性也放内层
- **参照实现**：`apps/web/src/routes/dashboard.tsx`（`DashboardPage` + `DashboardContent`）

### 常量复用 shared（禁止前后端各自维护同一数值）

- **文件大小限制、分页默认值等跨端共享数值**：必须放到 `packages/shared/src/constants/`，前后端各自导入。曾出现前端硬编码 `"单文件最大 10MB"` 文案与后端 `MAX_FILE_SIZE` 各自维护导致漂移
- **做法**：shared 定义常量（如 `MAX_FILE_SIZE`、`DEFAULT_PAGE_SIZE`），后端 `re-export` 或直接导入，前端导入并用于文案生成

## Zod DTO 桥接规范

1. **所有 controller 的 `@Body()` 必须用 `createZodDto` 桥接的 DTO** - 禁止裸传对象，禁止绕过 zod 自定义 class-validator DTO
2. **DTO 文件命名**：`dto/{action}-{resource}.dto.ts`（如 `create-permission.dto.ts`）
3. **典型坑**：`permissions` 模块此前 controller 用裸 `@Body()` 没接 DTO，导致 zod schema 不生效 → 用户随意传字段也能创建权限。已修复
4. **DTO 定义模板**：

```ts
import { createZodDto } from 'nestjs-zod'
import { CreatePermissionSchema } from '@shared/schemas/permission'

export class CreatePermissionDto extends createZodDto(CreatePermissionSchema) {}
```

5. **Schema 改动后必须 `pnpm --filter=shared build`** - `@shared/*` 指向 `shared/dist/*`，新建 schema 不会自动构建到 dist，前端会报模块找不到

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <description>

# 示例
feat(auth): add refresh token rotation
fix(users): fix user list pagination
docs(architecture): update API design section
```

类型：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `ci`
