# harness — Claude Code ハーネス育成アプリ（個人用）

複数の開発機の `~/.claude/`（セッションログ・メモリ・CLAUDE.md / rules / skills）を Hub に集約し、
利用実態を可視化し、AI（Claude Code サブスク）で CLAUDE.md 改善案や skill を生成、
人間が accept したらバックアップ付きで各開発機に自動適用する継続改善ループを回す。

詳細な設計・フェーズ分解は実装計画（`.claude/plans/`）を参照。

## 構成（pnpm workspaces モノレポ）

- `shared/` — web と worker が共有する型・SQLite ラッパ・スキーマ
- `web/` — Next.js（`basePath:/harness`, standalone）。UI + API Routes
- `worker/` — ジョブ実行の常駐 Node プロセス（collect / ingest / analyze / apply / cleanup）
- `agent/` — 開発機に配布する Python スクリプト（collector.py / apply.py / gate.sh）
- `prompts/` — 分析プロンプトテンプレート
- `deploy/` — 開発機セットアップ・バックアップスクリプト
- `data/` — 実行時ボリューム（git 管理外・**Hub が唯一の長期記録**）

## ローカル開発

前提: [mise](https://mise.jdx.dev/) をインストール済み。

```bash
mise install          # node/pnpm/python を固定バージョンで導入
mise run setup        # pnpm install
mkdir -p data/{digests,increments,jobs,claude-config}
mise run db:init      # SQLite にスキーマ適用
mise run dev          # web を http://localhost:3000/harness で起動
```

## Docker（Hub 本番）

```bash
cp .env.example .env  # CLAUDE_CODE_OAUTH_TOKEN 等を設定
mkdir -p data/{digests,increments,jobs,claude-config}
sudo chown -R 1000:1000 data   # コンテナ実行ユーザー(node/uid 1000)に書き込み権限

# Phase 0 の疎通確認は web のみで可
docker compose up --build web
# worker も起動する場合は secrets/ssh_key（開発機への専用鍵）を配置してから
docker compose up --build
```

- `web` コンテナは **127.0.0.1 のみ** に publish。外部到達はホストの nginx 経由のみ。
- nginx の `/harness/` プロキシ + Basic 認証は**ユーザーがサーバー上で手動設定**（本リポジトリのスコープ外）。

  ```nginx
  location /harness/ {
      auth_basic "harness";
      auth_basic_user_file /etc/nginx/htpasswd_harness;
      proxy_pass http://127.0.0.1:3000/harness/;
      proxy_set_header Host $host;
  }
  ```

## 開発機のセットアップ

Hub 上で（対象機への通常 SSH アクセスがある状態で）:

```bash
deploy/setup-machine.sh <ssh_user@ssh_host> ~/.ssh/harness_ed25519.pub
```

collector.py / apply.py / gate.sh を配布し、`authorized_keys` に command= 制限付きで Hub 鍵を登録、
`~/.claude/settings.json` に `cleanupPeriodDays=90` をマージする（`0` は指定禁止）。
その後 Machines 画面で端末を登録する（Hub 自身は `ssh_host=local`）。

## 運用（スケジューラ・バックアップ）

ホストの cron から毎日 03:00 に収集→提案生成→cleanup を投入する:

```cron
0 3 * * *  cd /path/to/harness && docker compose exec -T worker node dist/enqueue.js daily
0 4 * * *  cd /path/to/harness && deploy/backup.sh >> data/backup.log 2>&1
```

`daily` は「全機 collect → 全機 digest-fold → 全機 claude-md-improve → cleanup」をこの順でキュー投入する
（worker は直列実行なので当日の収集を反映した提案になる）。失敗ジョブはダッシュボード左下に
「失敗ジョブ N 件」のバッジで通知され、History 画面のジョブログで詳細を確認できる。

## セキュリティの要点

- 開発機の `~/.claude` への書き込みは `apply.py` の 1 経路のみ。他はすべて読み取り専用。
- Hub→開発機の SSH は専用鍵 + `authorized_keys` の `command=` ゲート（gate.sh）で操作を collector/apply に限定。
- 分析コンテナは `CLAUDE_CONFIG_DIR` を分離し、`--allowedTools` を Read/Write/Grep/Glob に限定。
  `--dangerously-skip-permissions` は `HARNESS_SKIP_PERMISSIONS=1`（コンテナのみ）で opt-in。
- secrets（OAuth トークン・SSH 秘密鍵）は `.env` / マウントで注入し、リポジトリに含めない。
