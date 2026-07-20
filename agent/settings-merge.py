#!/usr/bin/env python3
"""harness settings-merge — 開発機側で settings.json の cleanupPeriodDays をマージ。

- 既存 settings.json をバックアップ（.harness.bak.<timestamp>）
- 既存 settings.json を壊れた場合は、最後のバックアップから復元してから上書き
- cleanupPeriodDays を上書き（環境変数 CLEANUP_DAYS で指定、既定 90）
"""

from __future__ import annotations

import json
import os
import sys
import time


def backups_dir() -> str:
    p = os.path.expanduser("~/.claude/settings.json")
    return os.path.dirname(p)


def atomic_write(path: str, content: str) -> None:
    """同一ディレクトリの一時ファイルに書いて os.replace でアトミック置換。"""
    target_dir = os.path.dirname(path) or "."
    os.makedirs(target_dir, exist_ok=True)
    tmp = f"{path}.harness.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    # 親ディレクトリも同期
    try:
        with os.open(target_dir, os.O_RDONLY) as dir_fd:
            os.fsync(dir_fd)
    except OSError:
        pass


def main() -> None:
    days_str = os.environ.get("CLEANUP_DAYS", "90")
    try:
        days = int(days_str)
    except ValueError:
        print(f"settings-merge: invalid CLEANUP_DAYS={days_str!r}, defaulting to 90", file=sys.stderr)
        days = 90

    if days <= 0:
        print("settings-merge: cleanupPeriodDays must be greater than 0", file=sys.stderr)
        sys.exit(1)

    p = os.path.expanduser("~/.claude/settings.json")
    data = {}
    if os.path.isfile(p):
        with open(p, encoding="utf-8") as f:
            try:
                data = json.load(f)
            except ValueError:
                # settings.json が壊れている場合、最後のバックアップから復元
                bdir = backups_dir()
                last_bak = None
                for name in os.listdir(bdir):
                    if name.startswith("settings.json.harness.bak."):
                        candidate = os.path.join(bdir, name)
                        if last_bak is None or candidate > last_bak:
                            last_bak = candidate
                if last_bak and os.path.isfile(last_bak):
                    print(f"settings-merge: corrupted settings.json, restoring from {os.path.basename(last_bak)}", file=sys.stderr)
                    with open(last_bak, encoding="utf-8") as f:
                        data = json.load(f)
                else:
                    print("settings-merge: corrupted settings.json and no backup available, starting fresh", file=sys.stderr)

    data["cleanupPeriodDays"] = days
    # 書き込み前に既存設定をバックアップ
    if os.path.isfile(p):
        try:
            ts = time.strftime("%Y%m%dT%H%M%S")
            bak = os.path.join(backups_dir(), f"settings.json.harness.bak.{ts}")
            with open(p, "rb") as sf:
                with open(bak, "wb") as df:
                    df.write(sf.read())
        except OSError:
            pass  # バックアップ失敗は継続
    atomic_write(p, json.dumps(data, ensure_ascii=False, indent=2))

    print(f"settings.json updated: cleanupPeriodDays = {days}")


if __name__ == "__main__":
    main()
