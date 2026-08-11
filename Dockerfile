# ===== Build stage =====
FROM node:20-alpine AS builder
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} http_proxy=${http_proxy} https_proxy=${https_proxy}
RUN sed -i 's|https://dl-cdn.alpinelinux.org|http://mirrors.aliyun.com|g' /etc/apk/repositories
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

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

RUN mkdir -p /app/uploads /app/uploads-trash && chown -R node:node /app/uploads /app/uploads-trash

ENV API_PORT=9000
ENV HUSKY=0
EXPOSE 9000

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "cd apps/server && node ../node_modules/drizzle-kit/bin.cjs migrate && cd /app && node apps/server/dist/main.js"]
