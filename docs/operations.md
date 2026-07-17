# 運用ガイド

## Hub のデプロイ（Docker）

```bash
cp .env.example .env   # CLAUDE_CODE_OAUTH_TOKEN 等を設定する
mkdir -p data/{digests,increments,jobs,claude-config}
sudo chown -R 1000:1000 data   # コンテナ実行ユーザー（node，uid 1000）に書き込み権限を与える

# 疎通確認は web のみでも可
docker compose up --build web
# worker も起動する場合は secrets/ssh_key（開発機への専用鍵）を配置してから
docker compose up --build
```

`CLAUDE_CODE_OAUTH_TOKEN` が未設定のままだと，worker 上の `claude` CLI が `Not logged in` で
`analyze` ジョブを失敗させる（Hub は keychain が無いため，ローカル macOS のような fallback が効かない）．
`claude setup-token` で発行した値を `.env` の `CLAUDE_CODE_OAUTH_TOKEN=` に設定してから
`docker compose up -d` （または push による再デプロイ）で反映する．
`grep CLAUDE_CODE_OAUTH_TOKEN .env` で行の有無だけ確認できる（値は表示しないこと）．

- `web` コンテナは 127.0.0.1 のみに publish する．外部到達はホストの nginx 経由のみである．
- worker コンテナは分析用 Claude Code CLI と openssh-client を同梱し，`prompts/` と `agent/` を読み取り専用でマウントする．

## nginx（ユーザーが手動設定・リポジトリのスコープ外）

Next.js の basePath が `/harness` のため，パスはそのまま素通しする．

```nginx
location /harness/ {
    auth_basic "harness";
    auth_basic_user_file /etc/nginx/htpasswd_harness;
    proxy_pass http://127.0.0.1:3000/harness/;
    proxy_set_header Host $host;
}
```

## 開発機のセットアップ

`authorized_keys` への Hub 公開鍵登録は，対象機への通常の SSH アクセス（`ssh-copy-id` 等）が
必要な唯一の手動ステップである．登録さえ済んでいれば，以降は **Machines 画面で端末を登録するだけで
残りは自動化される**．登録直後に `setup` ジョブが自動投入され，worker が次を行う．

1. `~/.harness/` を作成し `collector.py` / `apply.py` / `gate.sh` を配布する．
2. `~/.claude/settings.json` に `cleanupPeriodDays=90`（`CLEANUP_PERIOD_DAYS` 環境変数で変更可）を
   マージする（バックアップ付き）．**`0` は指定禁止**である（削除無効ではなくトランスクリプト書き込み
   自体が止まる既知バグがあるため）．

Hub 自身（`ssh_host=local`）は setup 不要で，worker が自動でスキップする．

`deploy/setup-machine.sh` は上記 1〜2 に加えて `authorized_keys` 登録も一括で行うスクリプトとして
引き続き利用できる（初回のブートストラップや，`setup` ジョブが失敗した場合の手動リカバリに使う）．

```bash
deploy/setup-machine.sh <ssh_user@ssh_host> ~/.ssh/harness_ed25519.pub
```

## スケジューラとバックアップ（ホスト cron）

```cron
0 3 * * *  cd /path/to/harness && docker compose exec -T worker node dist/enqueue.js daily
0 4 * * *  cd /path/to/harness && deploy/backup.sh >> data/backup.log 2>&1
```

`daily` は「全機 collect → 全機 digest-fold → 全機 claude-md-improve → cleanup」をこの順でキューに投入する．
worker は直列実行のため，当日の収集を反映した提案が生成される．03:00 実行は日中の対話利用とサブスクのレート枠を
奪い合わないための固定でもある．

`backup.sh` は SQLite（`.backup` コマンド）と `digests/` を日次でアーカイブし，既定で最新 14 世代を保持する．
**Hub が唯一の長期記録である**ため，バックアップの運用は必須である．

## CI からのデプロイ（GitHub Actions + Tailscale）

`.github/workflows/deploy.yml` が `main` への push と手動実行で起動する．
`ci-checks`（Biome lint + 型チェック）→ `build-and-push`（web / worker イメージを GHCR に push）
→ `deploy` の順に実行する．`deploy` は Tailscale 経由で instance に到達し，
`docker-compose.yml`・`prompts/`・`agent/` を SCP で転送した後，Tailscale SSH で `docker compose pull` → `docker compose up -d --remove-orphans`
→ `/harness/api/health` への疎通確認（最大 100 秒リトライ，失敗時は `docker compose logs` を出力して deploy を失敗させる）を行う．
イメージは CI 側でビルド済みのため instance 上での `--build` は不要である．
Tailscale 到達後の認証は `DEPLOY_KEY`（SSH 秘密鍵）を用いる．

`data/`・`prompts/`・`agent/`・`secrets/ssh_key` は，過去の `docker compose up` が bind mount 元を
意図しない所有者（`root` や SCP 実行ユーザーなど，コンテナ内 uid 1000 = node と異なるユーザー）で
自動生成してしまうことがある．deploy はこれを Docker 経由（root で動くコンテナから）の chown で
毎回自動修正してから起動するため，instance 側で手動 chown する必要はない．

必要な設定は次のとおりである．

- Secrets：`TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`（scope: devices，`tag:ci` 付与）．
- Secrets：`DEPLOY_HOST`（MagicDNS 名）/ `DEPLOY_USER` / `DEPLOY_PATH` / `DEPLOY_KEY`（SSH 秘密鍵）．
- Tailscale ACL：`tag:ci` から instance への SSH を許可する．
- instance 側：`sudo tailscale up --ssh` で Tailscale SSH を有効化する．

`prompts/` と `agent/` は worker イメージに同梱されず，instance 上のホストパスを読み取り専用でマウントする
（[docker-compose.yml](../docker-compose.yml) 参照）．デプロイフローは `docker-compose.yml` と併せてこれらも
毎回 SCP で転送するため，instance 側で別途 `git pull` する必要はない．

### worker コンテナ内での Tailscale MagicDNS 解決

worker は `collect` / `apply` ジョブで開発機へ Tailscale MagicDNS 名（例: `ws-ktak-dev`）で SSH 接続する．
`network_mode: host` にしていても，Docker はコンテナ用の `/etc/resolv.conf` を別途生成するため，
ホストの nameserver がループバック（Ubuntu の systemd-resolved スタブリゾルバ `127.0.0.53` 等）だと，
Docker が自動でアップストリーム DNS （`/run/systemd/resolve/resolv.conf` 由来）に差し替えてしまう．
Tailscale の MagicDNS は `tailscale0` インターフェースにスコープした Split DNS として動作するため，
このアップストリームリストには現れず，コンテナ内では名前解決できない．
[docker-compose.yml](../docker-compose.yml) の worker サービスでホストの `/etc/resolv.conf` を
`ro` で bind mount し，Split DNS 設定ごと共有することで解決している．
instance 側が systemd-resolved を使っていない場合はこの前提が崩れるため，
`resolvectl status` で Tailscale 用インターフェースの DNS スコープを確認してから deploy すること．

## 失敗ジョブの通知

ジョブ失敗は `jobs.log` に種別（`auth` / `rate_limit` / `transient` / `fatal`）付きで記録する．
未確認の失敗はダッシュボード左下に「失敗ジョブ N 件」のバッジで表示し，History 画面のジョブログで詳細を確認できる．

## コンフィグで吸収する事項

開発機一覧（`machines`），workspace ルートと走査深度，スケジュール時刻（既定 03:00），
直近全文収集するセッション数 N，Tier1 猶予日数，`cleanupPeriodDays`，Basic 認証情報を，
`.env` と `settings` テーブルで吸収する．主な環境変数は `.env.example` を参照する．
