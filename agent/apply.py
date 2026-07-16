#!/usr/bin/env python3
"""harness apply — 開発機側で承認済み diff を適用する唯一の書き込み経路。

- 標準入力(JSON): {target_path, base_hash, new_content, proposal_id, files?}
  - files 指定時は skill 一式など複数ファイルをまとめて適用する
    files = [{"rel_path": "<target_path 起点の相対パス>", "content": "..."}]
- 適用前に対象の現ハッシュと base_hash を照合し、不一致なら中止（提案生成後の手編集を保護）。
- バックアップ → 同一 FS の一時ファイル + os.replace() でアトミックに置換。
- `--rollback <backup_dir>`: manifest に従い復元する。

依存は Python 3.8+ 標準ライブラリのみ。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def backups_root() -> str:
    return os.path.expanduser("~/.claude/backups/harness")


def atomic_write(path: str, content: str) -> str:
    """同一ディレクトリの一時ファイルに書いて os.replace でアトミック置換。適用後ハッシュを返す。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.harness.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return sha256_file(path)


def do_apply(req: dict) -> dict:
    proposal_id = req.get("proposal_id", "0")
    target_path = os.path.abspath(os.path.expanduser(req["target_path"]))
    files = req.get("files")

    ts = time.strftime("%Y%m%dT%H%M%S")
    backup_dir = os.path.join(backups_root(), f"{ts}_{proposal_id}")
    os.makedirs(backup_dir, exist_ok=True)
    manifest = []  # {"orig": abs_path, "backup": abs_path or null(新規作成)}

    if files:
        # 複数ファイル（skill 一式など）: target_path をベースディレクトリとして相対配置
        base = target_path
        for item in files:
            dest = os.path.abspath(os.path.join(base, item["rel_path"]))
            _backup_one(dest, backup_dir, manifest)
        _write_manifest(backup_dir, manifest)
        applied = []
        for item in files:
            dest = os.path.abspath(os.path.join(base, item["rel_path"]))
            h = atomic_write(dest, item["content"])
            applied.append({"path": dest, "hash": h})
        return {"ok": True, "backup_path": backup_dir, "applied": applied}

    # 単一ファイル: base_hash 照合
    base_hash = req.get("base_hash") or ""
    if os.path.isfile(target_path):
        cur = sha256_file(target_path)
        if base_hash and cur != base_hash:
            shutil.rmtree(backup_dir, ignore_errors=True)
            return {
                "ok": False,
                "error": f"base_hash 不一致（提案生成後に変更された可能性）: current={cur} base={base_hash}",
            }
    elif base_hash:
        # 対象が消えている（base_hash 指定ありなのに無い）→ 競合扱い
        shutil.rmtree(backup_dir, ignore_errors=True)
        return {"ok": False, "error": "対象ファイルが存在しません（base_hash 指定あり）"}

    _backup_one(target_path, backup_dir, manifest)
    _write_manifest(backup_dir, manifest)
    applied_hash = atomic_write(target_path, req["new_content"])
    return {"ok": True, "backup_path": backup_dir, "applied_hash": applied_hash}


def _backup_one(dest: str, backup_dir: str, manifest: list) -> None:
    if os.path.isfile(dest):
        # 一意な退避名（元パスを平坦化）
        flat = dest.replace(os.sep, "__").lstrip("_")
        bpath = os.path.join(backup_dir, flat)
        shutil.copy2(dest, bpath)
        manifest.append({"orig": dest, "backup": bpath})
    else:
        # 新規作成ファイル: ロールバック時は削除する
        manifest.append({"orig": dest, "backup": None})


def _write_manifest(backup_dir: str, manifest: list) -> None:
    with open(os.path.join(backup_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)


def do_rollback(backup_dir: str) -> dict:
    backup_dir = os.path.abspath(os.path.expanduser(backup_dir))
    mpath = os.path.join(backup_dir, "manifest.json")
    if not os.path.isfile(mpath):
        return {"ok": False, "error": f"manifest.json がありません: {backup_dir}"}
    with open(mpath, encoding="utf-8") as f:
        manifest = json.load(f)
    restored = []
    for entry in manifest:
        orig = entry["orig"]
        backup = entry.get("backup")
        if backup and os.path.isfile(backup):
            os.makedirs(os.path.dirname(orig), exist_ok=True)
            tmp = f"{orig}.harness.tmp.{os.getpid()}"
            shutil.copy2(backup, tmp)
            os.replace(tmp, orig)
            restored.append(orig)
        elif backup is None:
            # 新規作成だったファイルは削除して元の「存在しない」状態へ戻す
            if os.path.isfile(orig):
                os.remove(orig)
            restored.append(f"-{orig}")
    return {"ok": True, "backup_path": backup_dir, "restored": restored}


def main() -> None:
    ap = argparse.ArgumentParser(description="harness apply (write path)")
    ap.add_argument("--rollback", metavar="BACKUP_DIR", help="バックアップから復元")
    args = ap.parse_args()

    try:
        if args.rollback:
            result = do_rollback(args.rollback)
        else:
            raw = sys.stdin.read()
            req = json.loads(raw)
            result = do_apply(req)
    except Exception as e:  # noqa: BLE001 - 失敗理由は JSON で返す
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}

    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
