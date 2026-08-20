# ===== Prod dependencies stage =====
# 仅安装 server(+shared) 的生产依赖：devDeps（typescript/vitest/drizzle-kit 等）不进镜像
FROM node:20-alpine AS prod-deps
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} http_proxy=${http_proxy} https_proxy=${https_proxy}
RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.aliyun.com|g' /etc/apk/repositories
RUN npm install -g pnpm@10.32.1 --registry=https://registry.npmmirror.com
RUN pnpm config set registry https://registry.npmmirror.com
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
# --filter=server... 含其 workspace 依赖 shared；--ignore-scripts 跳过构建脚本（argon2 使用内置 prebuilds）
RUN pnpm --filter=@monoforge/server... install --prod --frozen-lockfile --ignore-scripts

# ===== Build stage =====
FROM node:20-alpine AS builder
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} http_proxy=${http_proxy} https_proxy=${https_proxy}
RUN sed -i 's|https://dl-cdn.alpinelinux.org|https://mirrors.aliyun.com|g' /etc/apk/repositories
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@10.32.1 --registry=https://registry.npmmirror.com
RUN pnpm config set registry https://registry.npmmirror.com
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
RUN pnpm -F @monoforge/shared build

COPY apps/server/ ./apps/server/
RUN pnpm -F @monoforge/server build

COPY apps/web/ ./apps/web/
RUN pnpm -F @monoforge/web build

# ===== Runtime stage =====
FROM node:20-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

# pnpm isolated 布局：server/shared 的直接依赖是各自 node_modules 下的符号链接，
# 指向根 node_modules/.pnpm store——三层缺一不可（只复制根层会 MODULE_NOT_FOUND）
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=builder /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /app/uploads /app/uploads-trash /app/backups && chown -R node:node /app/uploads /app/uploads-trash /app/backups

ENV API_PORT=9000
ENV HUSKY=0
EXPOSE 9000

USER node

ENTRYPOINT ["/sbin/tini", "--"]
# 迁移用 dist/db/migrate.js（drizzle-orm migrator，运行时依赖）；drizzle-kit 为 devDep 不在镜像内
CMD ["sh", "-c", "node apps/server/dist/db/migrate.js && node apps/server/dist/main.js"]
