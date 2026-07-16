# syntax=docker/dockerfile:1
# ビルドコンテキストはリポジトリルート（docker-compose の build.context: .）

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---- builder ----
FROM base AS builder
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY worker/package.json ./worker/
RUN --mount=type=cache,target=/pnpm/store pnpm install --filter "@harness/worker..."
COPY shared ./shared
COPY worker ./worker
RUN pnpm --filter @harness/shared build \
    && pnpm --filter @harness/worker build

# ---- runner ----
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# 分析用 Claude Code CLI と、開発機への SSH クライアントを同梱
# バージョンは実装計画に合わせてピン（更新時はここを上げる）
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable \
    && npm install -g @anthropic-ai/claude-code@2.1.211 \
    && npm cache clean --force
# builder の成果物（dist + workspace node_modules）を丸ごと持ち込む
COPY --from=builder /app ./
USER node
CMD ["node", "worker/dist/index.js"]
