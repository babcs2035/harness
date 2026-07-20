const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 既存 nginx に /harness/ プレフィックスで組み込む
  basePath: '/harness',
  // Docker 単体イメージ配布用
  output: 'standalone',
  // pnpm workspaces のため、トレースの起点をリポジトリルートに上げる
  outputFileTracingRoot: path.join(__dirname, '..'),
  // better-sqlite3（ネイティブ addon）を webpack バンドルから除外
  serverExternalPackages: ['better-sqlite3'],
  // basePath をビルド時に埋め込み（クライアント側 fetch 用）
  env: {
    NEXT_PUBLIC_BASE_PATH: '/harness',
  },
};

module.exports = nextConfig;
