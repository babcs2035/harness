# harness — Claude Code ハーネス育成アプリ（個人用）

複数の開発機の `~/.claude/`（セッションログ・メモリ・CLAUDE.md / rules / skills）を Hub に集約し，
利用実態を可視化し，AI（Claude Code サブスクリプション）で CLAUDE.md 改善案や skill を生成し，
人間が accept したらバックアップ付きで各開発機に自動適用する継続改善ループを回す．個人用であり，組織共有機能は持たない．

## 実現する価値

1. **可視化**．セッション数・トークン消費・プロジェクト分布を全端末横断で一望する．
2. **改善提案**．AI が利用実態から CLAUDE.md の改善案とセルフナレッジ skill を生成する．
3. **ワンクリック適用**．人間が accept したらバックアップ付きで自動適用する（人間レビュー必須の構造）．
4. **横断分析**．端末間の設定ドリフトを検出し，昇格・降格・重複統合を提案する．

## ドキュメント

設計・実装・運用の詳細は [docs/](./docs/) にまとめている．

| ドキュメント | 内容 |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | 全体構成・コンポーネント責務・データフロー |
| [docs/data-model.md](./docs/data-model.md) | 3 層の保持ポリシー・SQLite スキーマ・JSONL 実スキーマ |
| [docs/implementation-plan.md](./docs/implementation-plan.md) | 技術決定・フェーズ分解・完了状況・未検証事項 |
| [docs/development.md](./docs/development.md) | ローカル開発・ジョブ種別・プロンプト・claude runner |
| [docs/operations.md](./docs/operations.md) | Hub デプロイ・開発機セットアップ・スケジューラ・バックアップ・CI |
| [docs/security.md](./docs/security.md) | SSH ゲート・単一書き込み経路・Web 到達制御・secrets |

## 構成（pnpm workspaces モノレポ）

- `shared/`：web と worker が共有する型・SQLite ラッパ・スキーマ．
- `web/`：Next.js（`basePath:/harness`，standalone）．UI と API Routes．
- `worker/`：ジョブ実行の常駐 Node プロセス（collect / ingest / analyze / apply / rollback / cleanup）．
- `agent/`：開発機に配布する Python スクリプト（collector.py / apply.py / gate.sh）．
- `prompts/`：分析プロンプトテンプレート（5 種）．
- `deploy/`：開発機セットアップ・バックアップスクリプト．
- `data/`：実行時ボリューム（git 管理外・**Hub が唯一の長期記録**）．

## クイックスタート（ローカル開発）

前提として [mise](https://mise.jdx.dev/) をインストール済みであること．

```bash
mise trust                 # 初回のみ
mise install               # node 24 / pnpm 11 / python 3.12 を導入する
mise run setup             # pnpm install
mkdir -p data/{digests,increments,jobs,claude-config}
mise run db:init           # SQLite にスキーマを適用する
mise run dev               # web を http://localhost:3000/harness で起動する
```

worker を動かす場合は別ターミナルで `mise run worker` を実行する．

## Hub のデプロイ（Docker）

```bash
cp .env.example .env       # CLAUDE_CODE_OAUTH_TOKEN 等を設定する
mkdir -p data/{digests,increments,jobs,claude-config}
sudo chown -R 1000:1000 data

docker compose up --build web      # 疎通確認は web のみでも可
docker compose up --build          # worker も起動する（secrets/ssh_key を配置してから）
```

`web` コンテナは 127.0.0.1 のみに publish する．外部到達はホストの nginx 経由に限定する
（nginx の `/harness/` プロキシと Basic 認証はユーザーが手動設定する．詳細は [docs/operations.md](./docs/operations.md)）．

## 技術スタック

Node 24（Active LTS）／ pnpm 11 ／ Python 3.12（mise で固定）．
Next.js 16（Turbopack）／ React 19.2 ／ recharts 3 ／ better-sqlite3 12 ／ TypeScript 5.9．
採用理由は [docs/implementation-plan.md](./docs/implementation-plan.md) を参照する．

## 実装状況

Phase 0〜4 をすべて実装済みである．各フェーズの内容・完了コミット・検証結果と未検証事項は
[docs/implementation-plan.md](./docs/implementation-plan.md) にまとめている．
