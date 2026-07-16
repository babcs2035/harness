# アーキテクチャ

## 目的

複数の開発機の `~/.claude/`（セッションログ・メモリ・CLAUDE.md / rules / skills）を Hub に集約し，
利用実態を可視化し，AI（Claude Code サブスクリプション）で CLAUDE.md 改善案や skill を生成し，
人間が accept したらバックアップ付きで各開発機に自動適用する継続改善ループを回す．
これは個人用であり，組織共有機能は持たない．

## 全体構成

```
                    ┌─ Hub（既存 nginx + Docker サーバー）───────────────┐
  ブラウザ ─HTTPS──▶ nginx (/harness/, Basic 認証)                        │
                    │   └─▶ web: Next.js (UI + API Routes) 127.0.0.1:3000 │
                    │         └─ SQLite(WAL) + data/ ← 共有ボリューム       │
                    │   worker: ジョブ実行プロセス（Node，直列実行）          │
                    │     ├─ collect : ssh 開発機 → 増分回収 → ingest        │
                    │     ├─ analyze : claude -p（headless，サブスク認証）    │
                    │     ├─ apply   : ssh 開発機 → バックアップ + 適用        │
                    │     └─ cleanup : Tier1 TTL 削除                        │
                    │   scheduler: ホスト cron → enqueue.js daily            │
                    └────────────┬───────── SSH（専用鍵，command= 制限）─────┘
                                 │
              ┌─ 開発機 A ────────┴──┐   ┌─ 開発機 B ─────────┐
              │ ~/.harness/collector.py │   │ （同左）             │
              │ ~/.harness/apply.py     │   │                     │
              │ ~/.harness/gate.sh      │   │                     │
              │ ~/.claude/（読み取り原則）│   │                     │
              │ ~/workspace/（走査対象）  │   │                     │
              └────────────────────┘   └─────────────────┘
```

## コンポーネントと責務

| コンポーネント | 実体 | 責務 |
|---|---|---|
| `web` | Next.js 16（App Router） | ダッシュボード UI と API Routes．better-sqlite3 で SQLite を直接読み書きする．**127.0.0.1 のみ**に publish し，外部到達は nginx 経由に限定する． |
| `worker` | 常駐 Node プロセス | `jobs` テーブルをポーリングし，同時 1 ジョブの**直列実行**でジョブを処理する．レート枠と DB 競合を単純化する目的である． |
| `shared` | TypeScript ライブラリ | web と worker が共有する型・SQLite ラッパ（WAL 有効化・スキーマ適用）・スキーマ定義． |
| `agent/collector.py` | 開発機に配布 | 読み取り専用・ステートレスな差分収集スクリプト．端末側に状態を残さない． |
| `agent/apply.py` | 開発機に配布 | 承認済み diff を適用する**唯一の書き込み経路**．base_hash 照合・バックアップ・アトミック置換・ロールバックを担う． |
| `agent/gate.sh` | 開発機に配布 | `authorized_keys` の `command=` から起動され，許可操作を collector / apply に限定する SSH ゲート． |
| `prompts/` | 分析テンプレート | analyze ジョブが claude へ渡す指示書．入力の説明・分析観点・出力ファイル名と形式の厳密な指定を含む． |

**責務分離の要点**．開発機側は「読み取り専用の collector」と「承認済み diff のみ適用する apply」の 2 スクリプトだけを持つ．
分析ロジック・ジョブキュー・履歴・プロンプトはすべて Hub に集約する．
端末の追加は SSH 鍵登録と `machines` テーブルへの登録のみで完結する．

## データフロー

### 収集（毎日 03:00 に自動，手動投入も可）

1. worker が `machines` を列挙し，各機のカーソルとスナップショットハッシュを組み立てる．
2. SSH で collector を実行し，増分 JSON を回収する．local 端末（Hub 自身）は ssh を介さず直接実行する．
3. ingest が統計・セッション・スナップショット差分・Tier1 索引・カーソル更新を**単一トランザクション**で取り込む．
   カーソル更新も同一トランザクションに含めるため，ingest 成功時のみカーソルが進む．
   これにより失敗時は再収集で同じ増分を再適用でき，二重計上しない（冪等）．

### 提案生成 → 適用

1. analyze ジョブが Tier2 ダイジェストと現行スナップショットを素材に，claude で改善案を生成し `proposals` に登録する．
2. ユーザーが Proposals 画面で diff をレビューし，Accept（または編集して Accept）する．
3. apply ジョブが SSH で apply.py を実行する．base_hash 照合 → バックアップ → アトミック書き込みの順で適用する．
4. 次回の collect で適用後ファイルがスナップショットとして回収され，ループが閉じる．

### ドリフト検出 → 解消

1. Drift 画面が端末横断で同一論理キー（`/.claude/` 以降のパス）のハッシュを比較し，分岐を検出する．
2. drift-resolve ジョブが各端末の版を claude でマージし，統合案を各端末向けの提案として発行する．

## 技術スタック

- Node 24（Active LTS）／ pnpm 11 ／ Python 3.12（`mise.toml` で固定）
- Next.js 16（Turbopack）／ React 19.2 ／ recharts 3
- better-sqlite3 12（同期 API・WAL）
- TypeScript 5.9（`latest` の 7 系は Next 16 の型チェックが未対応のため採用しない）
- 分析用 Claude Code CLI（`@anthropic-ai/claude-code`，worker イメージに同梱）

技術スタックの確定理由の詳細は [implementation-plan.md](./implementation-plan.md) を参照する．
