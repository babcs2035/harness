import fs from 'node:fs';
import { getDb } from '@harness/shared';

/**
 * Tier1 の TTL 削除。consumed_at が設定済みかつ delete_after 経過の増分を削除する。
 * Tier2（ダイジェスト）と Tier3（SQLite）は削除しない。
 * 増分ファイルは、他に同一 file_path を参照する行が無い場合のみ実体を消す。
 */
export function runCleanup(): string {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      'SELECT id, file_path FROM tier1_increments WHERE consumed_at IS NOT NULL AND delete_after IS NOT NULL AND delete_after < ?',
    )
    .all(now) as { id: number; file_path: string }[];

  const del = db.prepare('DELETE FROM tier1_increments WHERE id=?');
  const others = db.prepare('SELECT COUNT(*) AS n FROM tier1_increments WHERE file_path=? AND id<>?');
  let removed = 0;
  let filesDeleted = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const ref = others.get(r.file_path, r.id) as { n: number };
      if (ref.n === 0 && r.file_path && fs.existsSync(r.file_path)) {
        try {
          fs.rmSync(r.file_path);
          filesDeleted++;
        } catch {
          /* ファイル削除失敗は無視（索引は消す） */
        }
      }
      del.run(r.id);
      removed++;
    }
  });
  tx();
  return `cleanup: Tier1 索引 ${removed} 件・増分ファイル ${filesDeleted} 件を削除`;
}
