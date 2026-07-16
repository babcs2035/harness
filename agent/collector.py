#!/usr/bin/env python3
"""harness collector — 開発機側の読み取り専用・ステートレスな差分収集スクリプト。

Hub から `ssh <machine> 'python3 ~/.harness/collector.py [--out PATH]'` で起動される。
- 標準入力: Hub が保持するカーソル JSON（CollectorInput）。空なら全読み。
- 標準出力（または --out で指定したファイル）: 増分 JSON（Increment）。

端末側に状態を残さない。~/.claude への書き込みは一切行わない。
依存は Python 3.8+ 標準ライブラリのみ。JSONL スキーマは実ログで確認済みのものに従い、
未知フィールドは無視し、必須キー欠落は握りつぶす防御的パースを行う。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

COLLECTOR_VERSION = "1"
HEAD_BYTES = 4096  # ローテーション/改変検知に使う先頭ハッシュのバイト数
MAX_MSG_CHARS = 20000  # 1 メッセージあたりの上限（巨大な貼り付けを切る）
ASSISTANT_EXCERPT_CHARS = 800  # recent_full セッションの assistant 抜粋長
DEFAULT_RECENT_FULL = 5
# workspace 走査で無視するディレクトリ（重い・無関係）
SKIP_DIRS = {
    "node_modules", ".git", "dist", ".next", "__pycache__",
    ".venv", "venv", ".mypy_cache", ".pytest_cache", "build", ".turbo",
}


# ── ハッシュユーティリティ ──────────────────────────────────────────
def sha256_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def head_hash_of(path: str) -> str:
    with open(path, "rb") as f:
        return sha256_bytes(f.read(HEAD_BYTES))


# ── JSONL パース ────────────────────────────────────────────────────
def iso_date(ts: str) -> str:
    """ISO タイムスタンプ先頭 10 文字を日付（UTC 基準）として使う。"""
    return ts[:10] if ts and len(ts) >= 10 else "unknown"


def extract_text(content) -> str:
    """message.content（文字列 or ブロック配列）から text のみ連結。tool_result は除外。"""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text")
                if isinstance(t, str):
                    parts.append(t)
        return "\n".join(parts).strip()
    return ""


def process_jsonl_files(projects_dir, cursors_by_file, full_resync, recent_full_n):
    """JSONL 群を走査し、統計・セッション・新カーソルを返す。"""
    stats = {}       # (date, cwd, model) -> counters
    sessions = {}    # session_id -> record
    new_cursors = {} # file -> {byte_offset, head_hash}

    if not os.path.isdir(projects_dir):
        return stats, sessions, new_cursors

    for root, dirs, files in os.walk(projects_dir):
        for name in files:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(root, name)
            try:
                size = os.path.getsize(path)
            except OSError:
                continue

            start = 0
            cur = None if full_resync else cursors_by_file.get(path)
            if cur:
                offset = int(cur.get("byte_offset", 0))
                prev_head = cur.get("head_hash")
                # ローテーション/改変検知: サイズ縮小 or 先頭ハッシュ不一致なら全読み直し
                rotated = size < offset
                if not rotated and prev_head is not None:
                    try:
                        if head_hash_of(path) != prev_head:
                            rotated = True
                    except OSError:
                        rotated = True
                start = 0 if rotated else offset

            _parse_file(path, start, stats, sessions)

            # 新カーソル: 読み終えた末尾位置とその時点の先頭ハッシュ
            try:
                new_cursors[path] = {
                    "file": path,
                    "byte_offset": size,
                    "head_hash": head_hash_of(path) if size > 0 else "",
                }
            except OSError:
                pass

    _mark_recent_full(sessions, recent_full_n)
    return stats, sessions, new_cursors


def _parse_file(path, start, stats, sessions):
    try:
        with open(path, "rb") as f:
            f.seek(start)
            for raw in f:
                try:
                    obj = json.loads(raw.decode("utf-8", "replace"))
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(obj, dict):
                    continue
                _consume_entry(obj, stats, sessions)
    except OSError:
        return


def _consume_entry(obj, stats, sessions):
    etype = obj.get("type")
    if etype not in ("user", "assistant"):
        return  # agent-setting / mode / file-history-snapshot 等はスキップ

    msg = obj.get("message")
    if not isinstance(msg, dict):
        return

    cwd = obj.get("cwd") or _cwd_from_dir(obj)
    ts = obj.get("timestamp") or ""
    sid = obj.get("sessionId") or obj.get("session_id")

    # セッションレコード更新
    if sid:
        rec = sessions.setdefault(sid, {
            "session_id": sid,
            "project_cwd": cwd or "",
            "started_at": ts,
            "last_at": ts,
            "user_messages": [],
            "assistant_excerpts": [],
            "message_count": 0,
        })
        if cwd and not rec["project_cwd"]:
            rec["project_cwd"] = cwd
        if ts:
            if not rec["started_at"] or ts < rec["started_at"]:
                rec["started_at"] = ts
            if ts > rec["last_at"]:
                rec["last_at"] = ts
        rec["message_count"] += 1

    if etype == "user":
        if obj.get("isSidechain"):
            return  # サブエージェントの発話は素材から除外
        text = extract_text(msg.get("content"))
        if text and sid:
            sessions[sid]["user_messages"].append(text[:MAX_MSG_CHARS])
    else:  # assistant
        usage = msg.get("usage")
        if isinstance(usage, dict):
            date = iso_date(ts)
            model = msg.get("model") or "unknown"
            key = (date, cwd or "", model)
            c = stats.setdefault(key, {
                "input_tokens": 0, "output_tokens": 0,
                "cache_read": 0, "cache_creation": 0, "messages": 0,
            })
            c["input_tokens"] += int(usage.get("input_tokens", 0) or 0)
            c["output_tokens"] += int(usage.get("output_tokens", 0) or 0)
            c["cache_read"] += int(usage.get("cache_read_input_tokens", 0) or 0)
            c["cache_creation"] += int(usage.get("cache_creation_input_tokens", 0) or 0)
            c["messages"] += 1
        # assistant テキストは recent_full 判定後に抜粋するため一旦保持
        if sid and not obj.get("isSidechain"):
            text = extract_text(msg.get("content"))
            if text:
                sessions[sid].setdefault("_assistant_raw", []).append(text)


def _cwd_from_dir(obj):
    """cwd 欠落行のフォールバック: projects/ のエンコード名から復元（曖昧なので最後の手段）。"""
    return ""


def _mark_recent_full(sessions, n):
    """last_at 降順で上位 n セッションに recent_full を立て、assistant 抜粋を埋める。"""
    ordered = sorted(sessions.values(), key=lambda r: r.get("last_at") or "", reverse=True)
    for i, rec in enumerate(ordered):
        recent = i < n
        rec["recent_full"] = recent
        raw = rec.pop("_assistant_raw", [])
        if recent and raw:
            rec["assistant_excerpts"] = [t[:ASSISTANT_EXCERPT_CHARS] for t in raw]
        else:
            rec["assistant_excerpts"] = []


# ── スナップショット収集 ────────────────────────────────────────────
def classify_kind(path: str) -> str:
    base = os.path.basename(path)
    low = path.replace(os.sep, "/").lower()
    if base == "CLAUDE.md":
        return "claude_md"
    if base in ("settings.json", "settings.local.json"):
        return "settings"
    if "/skills/" in low:
        return "skill"
    if "/memory/" in low or base == "MEMORY.md":
        return "memory"
    return "rule"


def iter_target_files(claude_dir, workspace_root, max_depth):
    """スナップショット対象ファイルのパスを列挙（重複除去）。"""
    seen = set()

    def add(p):
        ap = os.path.abspath(p)
        if ap not in seen and os.path.isfile(ap):
            seen.add(ap)
            return ap
        return None

    # ~/.claude 配下の主要ファイル
    fixed = [
        os.path.join(claude_dir, "CLAUDE.md"),
        os.path.join(claude_dir, "settings.json"),
    ]
    for p in fixed:
        r = add(p)
        if r:
            yield r
    for sub in ("memory", "rules", "skills"):
        d = os.path.join(claude_dir, sub)
        if os.path.isdir(d):
            for root, dirs, files in os.walk(d):
                dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
                for name in files:
                    if name.endswith((".md", ".json", ".txt", ".yaml", ".yml")):
                        r = add(os.path.join(root, name))
                        if r:
                            yield r

    # workspace 配下の CLAUDE.md と .claude/ を max_depth まで
    if workspace_root and os.path.isdir(workspace_root):
        base_depth = workspace_root.rstrip(os.sep).count(os.sep)
        for root, dirs, files in os.walk(workspace_root):
            depth = root.count(os.sep) - base_depth
            if depth >= max_depth:
                dirs[:] = []
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for name in files:
                if name == "CLAUDE.md":
                    r = add(os.path.join(root, name))
                    if r:
                        yield r
            if ".claude" in dirs:
                cdir = os.path.join(root, ".claude")
                for croot, cdirs, cfiles in os.walk(cdir):
                    cdirs[:] = [x for x in cdirs if x not in SKIP_DIRS]
                    for name in cfiles:
                        if name.endswith((".md", ".json", ".txt", ".yaml", ".yml")):
                            r = add(os.path.join(croot, name))
                            if r:
                                yield r


def collect_snapshots(claude_dir, workspace_root, max_depth, snapshot_hashes):
    """変更のあったスナップショットのみ全文で返し、消えたファイルを deleted に列挙。"""
    changed = []
    present = set()
    for path in iter_target_files(claude_dir, workspace_root, max_depth):
        present.add(path)
        try:
            h = sha256_file(path)
        except OSError:
            continue
        if snapshot_hashes.get(path) == h:
            continue  # 変更なし
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except OSError:
            continue
        changed.append({
            "path": path,
            "kind": classify_kind(path),
            "hash": h,
            "content": content,
        })
    deleted = [p for p in snapshot_hashes.keys() if p not in present and not os.path.isfile(p)]
    return changed, deleted


# ── 環境サマリ ──────────────────────────────────────────────────────
def env_summary(claude_dir):
    total = 0
    session_files = 0
    projects_dir = os.path.join(claude_dir, "projects")
    for root, dirs, files in os.walk(claude_dir):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for name in files:
            fp = os.path.join(root, name)
            try:
                total += os.path.getsize(fp)
            except OSError:
                pass
            if name.endswith(".jsonl") and root.startswith(projects_dir):
                session_files += 1
    return {"claude_dir_bytes": total, "session_file_count": session_files}


# ── メイン ──────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="harness collector (read-only)")
    ap.add_argument("--out", help="増分 JSON の出力先ファイル（省略時は stdout）")
    ap.add_argument("--claude-dir", default=os.path.expanduser("~/.claude"))
    ap.add_argument("--full-resync", action="store_true", help="全カーソル無視で全量再収集")
    args = ap.parse_args()

    # stdin のカーソル JSON（無ければ空）
    raw_in = ""
    if not sys.stdin.isatty():
        raw_in = sys.stdin.read()
    try:
        cursor_input = json.loads(raw_in) if raw_in.strip() else {}
    except ValueError:
        cursor_input = {}

    full_resync = args.full_resync or bool(cursor_input.get("full_resync"))
    session_cursors = cursor_input.get("session_cursors") or []
    cursors_by_file = {c["file"]: c for c in session_cursors if isinstance(c, dict) and c.get("file")}
    snapshot_hashes = cursor_input.get("snapshot_hashes") or {}
    workspace_root = cursor_input.get("workspace_root") or os.path.expanduser("~/workspace")
    max_depth = int(cursor_input.get("max_depth", 6))
    recent_full_n = int(cursor_input.get("recent_full_sessions", DEFAULT_RECENT_FULL))

    claude_dir = os.path.abspath(os.path.expanduser(args.claude_dir))
    projects_dir = os.path.join(claude_dir, "projects")

    stats_map, sessions_map, new_cursors = process_jsonl_files(
        projects_dir, cursors_by_file, full_resync, recent_full_n
    )
    changed_snapshots, deleted_files = collect_snapshots(
        claude_dir, workspace_root, max_depth, snapshot_hashes
    )

    stats = [
        {
            "date": date, "project_cwd": cwd, "model": model,
            "input_tokens": c["input_tokens"], "output_tokens": c["output_tokens"],
            "cache_read": c["cache_read"], "cache_creation": c["cache_creation"],
            "messages": c["messages"],
        }
        for (date, cwd, model), c in stats_map.items()
    ]
    sessions = list(sessions_map.values())

    increment = {
        "collector_version": COLLECTOR_VERSION,
        "machine_ts": datetime.now(timezone.utc).astimezone().isoformat(),
        "stats": stats,
        "sessions": sessions,
        "new_cursors": list(new_cursors.values()),
        "changed_snapshots": changed_snapshots,
        "deleted_files": deleted_files,
        "env": env_summary(claude_dir),
    }

    payload = json.dumps(increment, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(payload)
        # 回収を容易にするため出力先パスとサイズを stderr に出す
        sys.stderr.write(f"wrote {len(payload)} bytes to {args.out}\n")
    else:
        sys.stdout.write(payload)


if __name__ == "__main__":
    main()
