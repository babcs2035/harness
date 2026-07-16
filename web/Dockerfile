# syntax=docker/dockerfile:1
# ビルドコンテキストはリポジトリルート（docker-compose の build.context: .）

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---- builder ----
FROM base AS builder
WORKDIR /app
# better-sqlite3 のネイティブビルドに備える（prebuilt が無い場合のフォールバック）
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# 依存定義を先にコピーしてレイヤーキャッシュを効かせる
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY web/package.json ./web/
RUN --mount=type=cache,target=/pnpm/store pnpm install --filter "@harness/web..."
# ソースを後からコピー
COPY shared ./shared
COPY web ./web
RUN pnpm --filter @harness/shared build \
    && pnpm --filter @harness/web build

# ---- runner ----
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Next.js standalone 出力（server.js と最小 node_modules を同梱）
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
USER node
EXPOSE 3000
CMD ["node", "web/server.js"]
