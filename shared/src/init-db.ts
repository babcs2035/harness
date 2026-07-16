// スキーマを適用するだけの CLI。`mise run db:init` から呼ばれる。
import { getDb, closeDb } from './db.js';

const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all() as { name: string }[];
console.log(`スキーマ適用完了: ${tables.map((t) => t.name).join(', ')}`);
closeDb();
