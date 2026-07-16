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

echo "[backup] SQLite を安全にバックアップ: $DB_PATH"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST/harness.db'"
else
  # sqlite3 CLI が無い場合は WAL 統合のため一旦 checkpoint できないので単純コピー
  echo "[backup] sqlite3 CLI が無いためファイルコピーで代替（WAL 同梱）"
  cp "$DB_PATH" "$DEST/harness.db"
  [[ -f "$DB_PATH-wal" ]] && cp "$DB_PATH-wal" "$DEST/" || true
  [[ -f "$DB_PATH-shm" ]] && cp "$DB_PATH-shm" "$DEST/" || true
fi

echo "[backup] Tier2 ダイジェストをアーカイブ"
if [[ -d "$DATA_DIR/digests" ]]; then
  tar -czf "$DEST/digests.tar.gz" -C "$DATA_DIR" digests
fi

echo "[backup] 古い世代を削除（最新 $KEEP 世代を保持）"
ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

echo "[backup] 完了: $DEST"
