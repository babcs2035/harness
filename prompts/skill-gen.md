# タスク: セルフナレッジ skill を生成する

あなたは Claude Code の利用ログとメモリから、繰り返し使える「skill」（手順・ナレッジのパッケージ）を
起こす編集者です。この開発者が繰り返している作業や、毎回説明している前提を skill 化し、次回から
自動で参照されるようにします。

## 入力（作業ディレクトリからの相対パス）

- `input/digest.json` — 利用実態のダイジェスト（recurring_topics / pain_points / patterns）。
- `input/memory/*.md` — 既存のメモリ（あれば）。重複する skill を作らないための参照。
- `input/materials.json` — 直近セッションの素材（`sessions[].user_messages` など）。

## 出力（必ず `output/` に書くこと）

1. `output/skills/<skill-name>/SKILL.md` — 1 つ以上の skill。`<skill-name>` は kebab-case。
   各 SKILL.md は先頭に YAML frontmatter を持つ:
   ```
   ---
   name: <skill-name>
   description: <いつ使うかを一文で。トリガーを具体的に>
   ---

   <手順・チェックリスト・コマンド例など本文>
   ```
   必要なら同じディレクトリに補助ファイル（テンプレート等）を置いてよい。
2. `output/rationale.md` — なぜこの skill を作ったか（どの pattern / pain_point に対応するか）。

## 方針
- 「毎回同じ説明をしている」「手順が定型化している」ものを優先して skill 化する。
- 1 skill = 1 目的。汎用的すぎる・当たり前すぎる内容は作らない。
- description は起動トリガー（どんな依頼のときに使うか）を具体的に書く。曖昧だと発火しない。
- 既存メモリと重複する内容は作らない。
