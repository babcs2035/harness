# データモデル

## 保持ポリシー（3 層）

開発機は永続ストアではない．Claude Code はセッショントランスクリプトを既定 30 日で自動削除する
（`cleanupPeriodDays`，起動時に削除を実行する）．したがって **Hub の Tier2 ダイジェストが正の長期記録**となる．

| 層 | 内容 | 置き場所 | 保持 |
|---|---|---|---|
| Tier 1 | 転送された生増分（発話テキスト等） | `data/increments/` + DB 索引（`tier1_increments`） | 消費ジョブ完了 + 猶予（既定 7 日）で削除 |
| Tier 2 | 週次×プロジェクトのローリングダイジェスト，パターン候補と出現回数 | `data/digests/` + DB 索引（`tier2_digests`・`patterns`） | **永続**（正の長期記録） |
| Tier 3 | 日別統計・提案・適用履歴・カーソル・スナップショット | SQLite（`data/harness.db`） | 永続（小さい） |

**バックアップが必須**である．`deploy/backup.sh` が SQLite（`.backup` コマンド）と `digests/` を日次でアーカイブする．
cron 登録の手順は [operations.md](./operations.md) を参照する．

## SQLite スキーマ

スキーマの実体は [`shared/src/schema.sql`](../shared/src/schema.sql) にあり，
`shared/src/db.ts` が起動時に `CREATE TABLE IF NOT EXISTS` で冪等に適用する．
web と worker は同一ボリュームの同一 DB を WAL モードで共有する．

| テーブル | 役割 |
|---|---|
| `machines` | 開発機（端末）．`ssh_host` が `local` の場合は Hub 自身とみなし ssh を介さず直接実行する． |
| `projects` | プロジェクト．`cwd` を正とする（`UNIQUE(machine_id, cwd)`）． |
| `cursors` | 差分収集の起点．Hub が保持し，collector はステートレス． |
| `stats_daily` | 日別×プロジェクト×モデルのトークン集計．UPSERT で加算する． |
| `sessions` | セッション単位のメタ情報（開始・最終・メッセージ数）． |
| `snapshots` | CLAUDE.md / rule / skill / memory / settings の履歴．最新に `is_current=1`． |
| `tier1_increments` | Tier1 増分の索引．`consumed_at` と `delete_after` で TTL 管理する． |
| `tier2_digests` | Tier2 ダイジェストの索引（scope × machine × project × period）． |
| `patterns` | 繰り返しパターン候補と出現回数．`digest-fold` が更新する． |
| `jobs` | ジョブキュー．`status`・`error_kind`・`acknowledged`・`cost_usd` 等を持つ． |
| `proposals` | 提案 Inbox．`type` は claude_md / skill / refactor / drift． |
| `apply_logs` | 適用履歴．`backup_path` と `rolled_back_at` を持つ． |
| `settings` | `.env` で吸収しきれない可変値の上書き． |

## プロジェクト対応付け

`projects/` 配下のディレクトリ名は実パスの `/` を `-` に変換したものであり，パス中の `-` と区別できないため
**デコードは曖昧**である．そこで JSONL 各行の `cwd` フィールドを正とする．`cwd` が欠落する行のみディレクトリ名へ
フォールバックする．

## collector が返す増分（Increment）

collector.py が標準出力に返す JSON の主要フィールドである．型定義は [`shared/src/types.ts`](../shared/src/types.ts) にある．

- `stats[]`：日別×プロジェクト（cwd）×モデルのトークン集計（`input_tokens` / `output_tokens` / `cache_read` / `cache_creation` / `messages`）．
- `sessions[]`：`user_messages`（分析素材の主役），直近 N セッションは `assistant_excerpts` も含む．
- `new_cursors[]`：各 JSONL ファイルの新しい `byte_offset` と先頭 4KB の `head_hash`．
- `changed_snapshots[]`：`snapshot_hashes` と異なるファイルのみ全文を返す．
- `deleted_files[]` / `env`：消えたファイルと環境サマリ（ディスク使用量・セッションファイル数）．

## JSONL 実スキーマ（collector パーサの根拠）

`~/.claude/projects/**/*.jsonl` の各行は `type` 付き JSON である．collector は次だけを処理し，他はスキップする．

- 非メッセージ行（スキップ）：`type` が `agent-setting` / `mode` / `permission-mode` / `file-history-snapshot` 等．
- `user` 行：`cwd`・`uuid`・`timestamp`・`message.role`・`message.content`（文字列 or ブロック配列）．`isSidechain` はサブエージェント発話として除外する．
- `assistant` 行：`message.model`・`message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`．

スキーマは進化するため，パーサは未知フィールドを無視し，必須キー欠落を握りつぶす防御的実装とする．
