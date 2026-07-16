#!/usr/bin/env bash
# 開発機を harness 収集対象としてセットアップする（Hub 上で実行）。
#
#   deploy/setup-machine.sh <ssh_user@ssh_host> [hub_pubkey_path]
#
# 実行前提: 対象機に対する通常の SSH アクセスがあること（このスクリプトは gate 制限を
# 掛ける前のブートストラップなので、管理者アクセスで実行する）。
set -euo pipefail

TARGET="${1:?usage: setup-machine.sh <ssh_user@ssh_host> [hub_pubkey_path]}"
PUBKEY_PATH="${2:-$HOME/.ssh/harness_ed25519.pub}"
CLEANUP_DAYS="${CLEANUP_PERIOD_DAYS:-90}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$SCRIPT_DIR/agent"

echo "==> ~/.harness を作成し collector/apply/gate を配布"
ssh "$TARGET" 'mkdir -p ~/.harness ~/.claude ~/.ssh && chmod 700 ~/.ssh'
scp "$AGENT_DIR/collector.py" "$AGENT_DIR/apply.py" "$AGENT_DIR/gate.sh" "$TARGET:~/.harness/"
ssh "$TARGET" 'chmod +x ~/.harness/gate.sh'

if [[ -f "$PUBKEY_PATH" ]]; then
  echo "==> authorized_keys に command= 制限付きで公開鍵を登録"
  PUBKEY_CONTENT="$(cat "$PUBKEY_PATH")"
  RESTRICT='command="~/.harness/gate.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding'
  # 冪等: 同じ鍵が未登録なら追記
  ssh "$TARGET" "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && \
    grep -qF '$PUBKEY_CONTENT' ~/.ssh/authorized_keys || echo '$RESTRICT $PUBKEY_CONTENT' >> ~/.ssh/authorized_keys"
else
  echo "!! 公開鍵 $PUBKEY_PATH が見つかりません。authorized_keys 登録はスキップしました。" >&2
fi

echo "==> settings.json に cleanupPeriodDays=$CLEANUP_DAYS をマージ（0 は禁止・バックアップ付き）"
ssh "$TARGET" "CLEANUP_DAYS=$CLEANUP_DAYS python3 - " <<'PYEOF'
import json, os, time
p = os.path.expanduser("~/.claude/settings.json")
days = int(os.environ.get("CLEANUP_DAYS", "90"))
if days <= 0:
    raise SystemExit("cleanupPeriodDays に 0 以下は指定禁止です")
data = {}
if os.path.isfile(p):
    with open(p, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except ValueError:
            data = {}
    # バックアップ
    with open(p + f".harness.bak.{int(time.time())}", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
data["cleanupPeriodDays"] = days
os.makedirs(os.path.dirname(p), exist_ok=True)
with open(p, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print("settings.json 更新完了: cleanupPeriodDays =", days)
PYEOF

echo "==> 完了。Hub の Machines 画面から端末を登録してください（name / ssh_host / ssh_user）。"
echo "   HARNESS_API_URL を設定すれば API 経由の自動登録も可能です（README 参照）。"
