#!/usr/bin/env bash
# 開発機の authorized_keys から command= で起動される SSH ゲート。
# Hub 専用鍵で許可する操作を collector / apply / rollback / settings-merge に限定する。
# 登録例（開発機の ~/.ssh/authorized_keys）:
#   command="~/.harness/gate.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... hub
set -euo pipefail

cmd="${SSH_ORIGINAL_COMMAND:-}"

# 先頭/末尾の空白を除去
cmd="$(echo "$cmd" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

case "$cmd" in
  python3\ ~/.harness/collector.py*|\
  python3\ ~/.harness/settings-merge.py*)
    # 先頭の "python3 ~/.harness/" を除去して残りを引数として渡す
    rest="${cmd#python3 }"
    rest="${rest#\~/.harness/}"
    exec python3 "$HOME/.harness/$rest"
    ;;
  python3\ ~/.harness/apply.py*)
    # 先頭の "python3 ~/.harness/" を除去して残りを引数として渡す
    # --rollback /path 等の引数を正しく apply.py に渡す
    rest="${cmd#python3 }"
    rest="${rest#\~/.harness/}"
    exec python3 "$HOME/.harness/$rest"
    ;;
  *)
    echo "harness gate: command not allowed: $cmd" >&2
    exit 1
    ;;
esac
