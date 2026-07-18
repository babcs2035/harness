#!/usr/bin/env bash
# 開発機の authorized_keys から command= で起動される SSH ゲート。
# Hub 専用鍵で許可する操作を collector / apply / rollback の 3 種に限定する。
# 登録例（開発機の ~/.ssh/authorized_keys）:
#   command="~/.harness/gate.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... hub
set -euo pipefail

cmd="${SSH_ORIGINAL_COMMAND:-}"

case "$cmd" in
  "python3 ~/.harness/collector.py"|"python3 ~/.harness/collector.py "*)
    exec python3 "$HOME/.harness/collector.py" ${cmd#python3 \~/.harness/collector.py}
    ;;
  "python3 ~/.harness/apply.py"|"python3 ~/.harness/apply.py "*)
    exec python3 "$HOME/.harness/apply.py" ${cmd#python3 \~/.harness/apply.py}
    ;;
  *)
    echo "harness gate: command not allowed: $cmd" >&2
    exit 1
    ;;
esac
