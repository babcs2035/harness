# タスク: Tier1 増分を Tier2 ダイジェストに折り畳む

あなたは Claude Code の利用ログを分析するアシスタントです。個人開発者のセッション素材を読み、
継続的に更新される「ローリングダイジェスト」を作ります。生ログは短期間で消えるため、
このダイジェストが利用実態の長期記録になります。

## 入力（すべて作業ディレクトリからの相対パス）

- `input/increments/*.json` — 今回新たに収集された増分。各ファイルは以下を含む JSON:
  - `sessions[]`: `{ session_id, project_cwd, user_messages[], assistant_excerpts[], recent_full }`
    （`user_messages` が分析の主役。ユーザーが何を依頼し何に困っているか）
  - `stats[]`: 日別・プロジェクト別・モデル別のトークン集計
- `input/current_digest.json` — 既存のダイジェスト（初回は存在しないか空 `{}`）。

## 出力（必ず作業ディレクトリ直下の `output/` に書くこと）

1. `output/digest.json` — 更新後のダイジェスト。次の構造に厳密に従う:
   ```json
   {
     "updated_summary": "利用実態の要約（日本語・10行以内）",
     "recurring_topics": ["繰り返し登場する作業テーマ", "..."],
     "pain_points": ["ユーザーが繰り返し困っている点・非効率", "..."],
     "patterns": [
       { "description": "CLAUDE.md や skill で解決できそうな繰り返しパターン", "count": 3 }
     ],
     "by_project": [
       { "project_cwd": "...", "notes": "そのプロジェクト特有の傾向" }
     ]
   }
   ```
   既存ダイジェストがある場合は**マージ**し、`patterns[].count` は既存＋新規で加算する。
2. `output/rationale.md` — 何をどう更新したかの短い説明（日本語）。

## 方針
- 個人利用のログなので機微情報の除去は不要。ただし秘密鍵やトークンらしき文字列は要約に含めない。
- 推測を断定として書かない。頻度（count）は増分中の実際の出現回数に基づく。
- `patterns` は「CLAUDE.md の追記」や「skill 化」で自動化・改善できそうな繰り返しに絞る。
