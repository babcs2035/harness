# 実装計画とフェーズ

本計画は DeNA の技術記事「Claude Code のハーネスを育てるアプリを作ってみた」に着想を得た個人用アプリの
実装方針である．各フェーズは独立してデプロイ・検証でき，完了条件（DoD）を満たしてから次へ進む方針で進めた．

## 確定した技術決定

- スタックは Node + TypeScript の **pnpm workspaces** モノレポとする．`web`（Next.js）と `worker`（Node/TS）が
  `shared` パッケージ（型・SQLite ラッパ・スキーマ）を共有する．
- **mise** で node / pnpm / python のバージョンを固定し，`mise tasks` で開発・ビルド・初期化のエントリポイントを定義する．
- Node 24（Active LTS，26 は Current で LTS 化前のため採用しない）／ pnpm 11 ／ Python 3.12．
- Next.js 16（Turbopack）／ React 19.2 ／ recharts 3 ／ better-sqlite3 12．
- TypeScript は **5.9** とする．`latest` の 7.0 は tsc 単体では通るが Next 16 の型チェックが未対応でビルドに失敗したため，
  実用上の最新 stable として 5.9 系を採る．
- pnpm 11 は既定でビルドスクリプトを無視するため，`pnpm-workspace.yaml` の `allowBuilds` で
  `better-sqlite3` / `esbuild` / `sharp` のネイティブビルドを明示許可する．

## フェーズと完了状況

すべてのフェーズを実装済みである．各フェーズは 1 コミットにまとめた．

| Phase | commit | 内容 | 検証 |
|---|---|---|---|
| 0 | `e88d692` | モノレポ足場・Next.js・SQLite・Docker | build ／ db:init ／ web 実起動で `/harness/` と health を確認 |
| 1 | `84b4f0d` | collector・collect/ingest・Overview/Projects/Machines | collect→ingest の e2e（2 回目差分ゼロで冪等・カーソル差分収集）と全 API を実データで確認 |
| 2 | `39e2cd4` | claude runner・analyze・Tier1/2・apply.py・Proposals/History | apply.py を実データで e2e（適用／base_hash 不一致の拒否／ロールバック復元），claude runner を `/tmp` で実証 |
| 3 | `ecbde4e` | skill-gen・refactor-scope・patterns UI | apply.py の複数ファイル適用／ロールバックを実データで確認 |
| 4 | `c818338` | Drift・scheduler・cleanup・backup・失敗バッジ | cleanup を実データで確認，`enqueue daily` の投入順を確認，drift/patterns API を実データで確認 |

## 各フェーズの要点

### Phase 0 足場

`mise.toml` ／ `pnpm-workspace.yaml` ／ `tsconfig.base.json` ／ `shared`（schema.sql・db.ts・types.ts）／
`web`（basePath `/harness`・standalone・health API）／ `worker`（ポーリングループの足場）／ Docker 一式を用意した．
**DoD**：Basic 認証付きで `/harness/` に空ダッシュボードが表示され，`web` コンテナが 127.0.0.1 のみに bind する．

### Phase 1 収集と可視化

`collector.py`（差分収集・cwd 基準の対応付け・スナップショット差分・`--full-resync`），
worker の `ssh` / `collect` / `ingest`（単一トランザクション・冪等）とポーリングループ，`enqueue` CLI，
`web` の API（machines / stats / projects / jobs）と画面（Overview・Projects・Machines）を実装した．
**DoD**：自動収集が動き，Overview で日別トークン・セッション数・プロジェクト分布が表示され，
2 回目以降が増分のみ転送し，`--full-resync` が機能する．

### Phase 2 提案 → 適用ループ（最重要）

`claude.ts`（headless runner），`analyze.ts`（digest-fold・claude-md-improve），Tier1/Tier2 管理，
`apply.py`（base_hash 照合・バックアップ・アトミック置換・ロールバック），Proposals / History の API と画面を実装した．
**DoD**：収集 → 分析 → 提案表示 → Accept → 開発機の CLAUDE.md 更新（バックアップ生成）→ ロールバックの一巡が UI から完結する．

### Phase 3 分析の拡充

`skill-gen`（skill 一式を `type=skill` で複数ファイル適用），プロジェクトスコープの `claude-md-improve`，
`refactor-scope`（昇格・降格・重複統合の提案），`patterns` テーブルの UI 表示を実装した．
**DoD**：セルフナレッジ skill が提案され，accept で開発機の `~/.claude/skills/` に配置される．

### Phase 4 複数端末と運用自動化

Drift 画面と `drift-resolve`，scheduler の本組み（`enqueue daily` が collect → digest-fold → claude-md-improve → cleanup を投入），
`cleanup` ジョブ（Tier1 の TTL 削除），`backup.sh`，`setup-machine.sh`，`gate.sh`，失敗ジョブの未確認バッジを実装した．
**DoD**：2 台以上でドリフト検出 → 解消提案 → 適用が動き，Tier1 が TTL で削除され，バックアップが日次で生成される．

## 未検証事項（本ホストでは安全に実施できない）

`analyze` ジョブの claude 実行による提案生成の完全 e2e は，このホストでは検証していない．
理由は次の 2 点である．

1. 稼働中の Claude Code セッションと同じ `~/.claude` を奪い合う競合が起きる．
2. `--dangerously-skip-permissions` がホストでは分類器にブロックされる（本来コンテナ専用である）．

runner の機構自体は `claude -p` の `/tmp` 実行（Write ツールでファイル生成・exit 0）で実証済みである．
完全な e2e は Hub コンテナ（`CLAUDE_CODE_OAUTH_TOKEN` + 分離した `CLAUDE_CONFIG_DIR` + `HARNESS_SKIP_PERMISSIONS=1`）で実施する．

## 実装中に判明・対処した事項

- `claude -p --output-format json` はこのバージョンでイベント配列を返す．runner は配列と単一オブジェクトの両方に対応する．
- `CLAUDE_CONFIG_DIR` を空ディレクトリに分離すると macOS でも「Not logged in」になる．認証は config dir に依存する．
- pnpm 11 のネイティブビルドは `allowBuilds` で明示許可する．クリーン install では自動ビルドされる．

## スコープ外（v1 では作らない）

組織・他ユーザーとの共有ハーネス，個人情報スキャン，Slack 等への通知連携，Electron 化・ネイティブアプリ化．
nginx 設定の生成・変更はユーザーが手動で行う（本リポジトリのスコープ外）．
