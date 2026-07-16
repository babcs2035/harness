# タスク: CLAUDE.md のスコープ再編（昇格 / 降格 / 重複統合）

あなたは複数プロジェクトの CLAUDE.md とグローバル CLAUDE.md を俯瞰し、記述の置き場所を最適化する
編集者です。全プロジェクト共通の記述はグローバルへ「昇格」、特定プロジェクト固有の記述はそこへ
「降格」、重複は「統合」します。

## 入力（作業ディレクトリからの相対パス）

- `input/global_claude_md.md` — グローバル CLAUDE.md 全文（空の場合あり）。
- `input/projects/*.md` — 各プロジェクトの CLAUDE.md。ファイル名は `<project-id>__<name>.md`。
- `input/index.json` — `{ "<project-id>": { "cwd": "...", "target_path": "..." } }` と
  `{ "global": { "target_path": "..." } }` を含む対応表。

## 出力（必ず `output/` に書くこと）

1. `output/refactor.json` — 次の構造:
   ```json
   {
     "actions": [
       { "kind": "promote|demote|merge|edit",
         "target": "<project-id または 'global'>",
         "reason": "なぜこの変更が必要か" }
     ]
   }
   ```
2. `output/files/<target>.md` — 変更対象ごとの**改善後 CLAUDE.md 全文**。
   `<target>` は `global` または `<project-id>`。変更しない対象のファイルは作らない。
3. `output/rationale.md` — 全体方針の説明。

## 方針
- 2 つ以上のプロジェクトに共通して現れる記述はグローバルへ昇格する。
- グローバルにある特定プロジェクト専用の記述は、そのプロジェクトへ降格する。
- 同義の重複記述は 1 か所へ統合し、他からは削除する。
- 各ファイルは完全な置き換え版として出力する（部分差分ではない）。
