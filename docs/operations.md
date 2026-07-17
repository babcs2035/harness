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

Hub 上で，対象機への通常の SSH アクセスがある状態で実行する（gate 制限を掛ける前のブートストラップである）．

```bash
deploy/setup-machine.sh <ssh_user@ssh_host> ~/.ssh/harness_ed25519.pub
```

このスクリプトは次を行う．

1. `~/.harness/` を作成し `collector.py` / `apply.py` / `gate.sh` を配布する．
2. `authorized_keys` に `command="~/.harness/gate.sh"` 付きで Hub 公開鍵を登録する（冪等）．
3. `~/.claude/settings.json` に `cleanupPeriodDays=90` をマージする（バックアップ付き）．**`0` は指定禁止**である
   （削除無効ではなくトランスクリプト書き込み自体が止まる既知バグがあるため）．

その後，Machines 画面で端末を登録する（Hub 自身は `ssh_host=local`）．

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
`docker-compose.yml` を SCP で転送した後，Tailscale SSH で `docker compose pull` → `docker compose up -d --remove-orphans`
→ `/harness/api/health` への疎通確認（最大 100 秒リトライ，失敗時は `docker compose logs` を出力して deploy を失敗させる）を行う．
イメージは CI 側でビルド済みのため instance 上での `--build` は不要である．
Tailscale 到達後の認証は `DEPLOY_KEY`（SSH 秘密鍵）を用いる．

必要な設定は次のとおりである．

- Secrets：`TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`（scope: devices，`tag:ci` 付与）．
- Secrets：`DEPLOY_HOST`（MagicDNS 名）/ `DEPLOY_USER` / `DEPLOY_PATH` / `DEPLOY_KEY`（SSH 秘密鍵）．
- Tailscale ACL：`tag:ci` から instance への SSH を許可する．
- instance 側：`sudo tailscale up --ssh` で Tailscale SSH を有効化する．

`prompts/` と `agent/` は worker イメージに同梱されず，instance 上のホストパスを読み取り専用でマウントする
（[docker-compose.yml](../docker-compose.yml) 参照）．デプロイフローは `docker-compose.yml` のみを転送し
`git pull` は行わないため，これらのファイルを更新した場合は instance 上で別途 `git pull` するか，
`scp` で個別に配布する必要がある．

## 失敗ジョブの通知

ジョブ失敗は `jobs.log` に種別（`auth` / `rate_limit` / `transient` / `fatal`）付きで記録する．
未確認の失敗はダッシュボード左下に「失敗ジョブ N 件」のバッジで表示し，History 画面のジョブログで詳細を確認できる．

## コンフィグで吸収する事項

開発機一覧（`machines`），workspace ルートと走査深度，スケジュール時刻（既定 03:00），
直近全文収集するセッション数 N，Tier1 猶予日数，`cleanupPeriodDays`，Basic 認証情報を，
`.env` と `settings` テーブルで吸収する．主な環境変数は `.env.example` を参照する．
