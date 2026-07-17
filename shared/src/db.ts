import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

let singleton: Database.Database | null = null;

/** schema.sql は tsx 実行時は src/ 配下、build 後は dist/ 配下（build で同梱）にある */
function schemaSql(): string {
  const url = new URL('./schema.sql', import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf8');
}

function dbPath(): string {
  const p = process.env.DB_PATH;
  if (!p) throw new Error('DB_PATH が未設定です（.env / mise env を確認）');
  return p;
}

/**
 * WAL 有効の SQLite 接続を返す。初回にスキーマを idempotent 適用する。
 * web / worker は同一ボリュームの同一 DB をそれぞれこの関数で開いて共有する。
 */
export function getDb(): Database.Database {
  if (singleton) return singleton;
  const db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql());
  singleton = db;
  return db;
}

/** テスト/CLI 用に接続を明示的に閉じる */
export function closeDb(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
