#!/usr/bin/env bash
# Hub の唯一の長期記録（SQLite + digests）を日次バックアップする。
# cron 例:  0 4 * * *  cd /path/to/harness && deploy/backup.sh >> data/backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/harness.db}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
STAMP="$(date +%Y%m%dT%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"
KEEP="${BACKUP_KEEP:-14}"  # 世代保持数

mkdir -p "$DEST"

echo "[backup] safely backing up SQLite: $DB_PATH"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST/harness.db'"
else
  # sqlite3 CLI がない場合: WAL モードで cp すると WAL が中途半端な状態になる可能性がある。
  # 可能な限り WAL checkpoint を試みてからコピーする（PRAGMA wal_checkpoint(FULL) は
  # 書き込みトランザクションがあるとブロックするため、EXCLUSIVE モードに切り替えてから
  # checkpoint を実行する）。
  echo "[backup] sqlite3 CLI not found, attempting WAL checkpoint before copy"
  # EXCLUSIVE モードに切り替えて checkpoint を強制（失敗しても無視）
  sqlite3 "$DB_PATH" "PRAGMA journal_mode=DELETE; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=WAL;" 2>/dev/null || true
  cp "$DB_PATH" "$DEST/harness.db"
  [[ -f "$DB_PATH-wal" ]] && cp "$DB_PATH-wal" "$DEST/" || true
  [[ -f "$DB_PATH-shm" ]] && cp "$DB_PATH-shm" "$DEST/" || true
fi

echo "[backup] archiving tier2 digests"
if [[ -d "$DATA_DIR/digests" ]]; then
  tar -czf "$DEST/digests.tar.gz" -C "$DATA_DIR" digests
fi

echo "[backup] pruning old generations (keeping latest $KEEP)"
ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

echo "[backup] done: $DEST"
