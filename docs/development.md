# 開発ガイド

## 前提

[mise](https://mise.jdx.dev/) をインストール済みであること．node / pnpm / python は `mise.toml` で固定する．

```bash
mise trust        # 初回のみ．mise.toml を信頼する
mise install      # node 24 / pnpm 11 / python 3.12 を導入する
mise run setup    # pnpm install（ネイティブ addon も allowBuilds でビルドされる）
```

## ディレクトリ構成

```
harness/
├── mise.toml               # ツールチェーン固定 + tasks
├── pnpm-workspace.yaml      # packages: shared / web / worker，allowBuilds
├── shared/                  # 型・SQLite ラッパ・schema.sql（web/worker が共有）
├── web/                     # Next.js（basePath:/harness，standalone）
│   └── src/app/             # page（Overview）/ projects / machines / proposals / drift / history / api
├── worker/                  # 常駐ジョブランナー
│   └── src/                 # index（ループ）/ claude / ssh / enqueue / jobs / lib
├── agent/                   # 開発機へ配布（Python3 標準ライブラリのみ）
│   ├── collector.py         # 読み取り専用の差分収集
│   ├── apply.py             # 唯一の書き込み経路（適用・ロールバック）
│   └── gate.sh              # SSH command= ゲート
├── prompts/                 # 分析テンプレート（5 種）
├── deploy/                  # setup-machine.sh / backup.sh
├── docs/                    # 本ドキュメント
└── data/                    # 実行時ボリューム（git 管理外・Hub の長期記録）
```

## よく使うコマンド（mise tasks）

| コマンド | 内容 |
|---|---|
| `mise run dev` | web をローカル起動する（`http://localhost:3000/harness`） |
| `mise run worker` | worker を起動する（tsx watch） |
| `mise run build` | 全パッケージをビルドする（`pnpm -r build`） |
| `mise run db:init` | SQLite にスキーマを冪等適用する |
| `mise run enqueue -- daily` | daily ジョブ列を投入する |

ローカルで DB を作るには次を実行する．

```bash
mkdir -p data/{digests,increments,jobs,claude-config}
mise run db:init
```

## ジョブ種別

worker は `jobs` テーブルを 2〜5 秒間隔でポーリングし，同時 1 ジョブの直列実行で処理する．

| type | payload | 内容 |
|---|---|---|
| `setup` | `{ machine_id }` | Machines 登録直後に自動投入。開発機へ collector.py/apply.py/gate.sh を配布し settings.json を更新する |
| `collect` | `{ machine_id, full_resync? }` | 端末を収集し ingest する |
| `analyze` | `{ kind, scope, machine_id?, project_id?, key? }` | claude で分析し提案／ダイジェストを生成する |
| `apply` | `{ proposal_id, edited_content? }` | 承認済み提案を開発機に適用する |
| `rollback` | `{ apply_log_id }` | 適用をロールバックする |
| `cleanup` | `{}` | Tier1 の TTL 削除を行う |

`analyze` の `kind` は `digest-fold` / `claude-md-improve` / `skill-gen` / `refactor-scope` / `drift-resolve` である．

## 分析プロンプト（prompts/）

各テンプレートは「入力ファイルの説明・分析観点・出力ファイル名と形式の厳密な指定」を含む．
claude はジョブディレクトリを cwd として実行され，`input/` を読み `output/` に成果物を書く．

| テンプレート | 入力 | 出力 |
|---|---|---|
| `digest-fold` | Tier1 増分 + 既存ダイジェスト | `output/digest.json`（要約・pain_points・patterns）+ rationale |
| `claude-md-improve` | ダイジェスト + 現行 CLAUDE.md | `output/claude_md.new` + rationale |
| `skill-gen` | メモリ + セッション素材 | `output/skills/<name>/SKILL.md` 一式 + rationale |
| `refactor-scope` | 全プロジェクト + グローバル CLAUDE.md | `output/refactor.json` + `output/files/<target>.md` + rationale |
| `drift-resolve` | 端末間で分岐した同一ファイル群 | `output/merged.md` + rationale |

## claude runner の要点

`worker/src/claude.ts` は `claude -p --output-format json` を実行する．

- 出力は「単一 result オブジェクト」または「イベント配列（末尾が `type:'result'`）」のいずれの形式にも対応する．
- 認証は，コンテナでは `CLAUDE_CODE_OAUTH_TOKEN`，ローカルでは config dir（実 `~/.claude`）に依存する．
- `--dangerously-skip-permissions` は `HARNESS_SKIP_PERMISSIONS=1` のときだけ付与する（コンテナ内限定）．

## ビルドと型

- `shared` の build は `tsc` に加えて `schema.sql` を `dist/` へコピーする（実行時にスキーマを読むため）．
- web の client 側 fetch は basePath が自動付与されないため，`web/src/lib/api.ts` の `BASE='/harness'` を前置する．
- better-sqlite3 を使う API Route は `export const runtime = 'nodejs'` を宣言する．
