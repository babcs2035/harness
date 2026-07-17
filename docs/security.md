# セキュリティ設計

本アプリは個人利用であり，全ログを参照してよい（個人データのみ）．ただし外部には出さない．
以下の境界により，最小権限と単一書き込み経路を保証する．

## SSH（Hub → 開発機）

- Hub から開発機への接続は専用鍵（`secrets/ssh_key`）を用いる．
- `gate.sh` は `SSH_ORIGINAL_COMMAND` を検査し，`python3 ~/.harness/collector.py` と
  `python3 ~/.harness/apply.py`（`--rollback` を含む）のみを許可する仕組みとして用意している．
  `authorized_keys` に次のように `command=` 付きで公開鍵を登録すればこの制限を強制できる．

  ```
  command="~/.harness/gate.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... hub
  ```

- ただし Machines 登録時に自動投入される `setup` ジョブ（`collector.py`/`apply.py`/`gate.sh` の配布，
  `scp` と任意コマンド実行を要する）は上記の制限下では動作しない．現状の運用は `command=` 制限を
  付けずに公開鍵を登録しており，Hub 専用鍵が漏洩した場合は開発機で任意コマンドを実行されうることを
  許容している．より厳格な制限を優先する場合は，`setup` ジョブの自動投入を無効化し
  [operations.md](./operations.md) の `deploy/setup-machine.sh` による手動セットアップに戻すこと．

## 元データの保護

- 開発機の `~/.claude` への**書き込みは `apply.py` の 1 経路のみ**である．collector を含む他の経路はすべて読み取り専用とする．
- `apply.py` は適用前に対象の現ハッシュと `base_hash` を照合し，不一致なら中止する（提案生成後の手編集による競合を防ぐ）．
- 適用はバックアップ（`~/.claude/backups/harness/<timestamp>_<proposal_id>/`）を取ってから，
  同一ファイルシステム上の一時ファイルに書き `os.replace()` でアトミックに置換する．ロールバックは manifest から復元する．

## Web

- nginx（ホスト側）で `/harness/` に Basic 認証を掛け，`127.0.0.1:3000` へプロキシする．
- `web` コンテナは **`127.0.0.1` のみ**に publish する．外部インターフェースには開放せず，到達経路をホストの nginx 経由に限定する．
- 認証はアプリ側では実装せず，nginx の Basic 認証に委譲する．

## 分析コンテナ

- `prompts/` は読み取り専用でマウントし，書き込みはジョブディレクトリのみに限定する．
- `CLAUDE_CONFIG_DIR` を `/data/claude-config` に分離し，分析実行が Hub の `~/.claude` を汚染しないようにする．
- `--allowedTools` を `Read,Write,Grep,Glob` に限定する．
- `--dangerously-skip-permissions` は**サンドボックス化されたコンテナ内でのみ** opt-in する
  （環境変数 `HARNESS_SKIP_PERMISSIONS=1`）．ホスト実行では付与しない．

## secrets

- `CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token` の発行物）と SSH 秘密鍵は `.env` またはマウントで注入し，
  リポジトリには含めない（`.gitignore` で `.env` と鍵を除外する）．
- CI（GitHub Actions）では Tailscale ネットワーク到達に `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` を用い，
  到達後の SSH 認証には GitHub Secrets の `DEPLOY_KEY`（SSH 秘密鍵）を用いる（[operations.md](./operations.md) を参照）．

## 認証に関する確認事項

- ローカル（macOS）では keychain / config dir に保存された OAuth 認証を用いる．
  `CLAUDE_CONFIG_DIR` を空ディレクトリに分離すると「Not logged in」になるため，ローカル検証では実 `~/.claude` を用いる．
- Hub（Linux コンテナ）では keychain が無いため，`CLAUDE_CODE_OAUTH_TOKEN` 環境変数で認証する．
