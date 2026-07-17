import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@harness/shared';
import { DIGESTS_DIR, ensureDir } from './paths.js';

export interface Tier1Row {
  id: number;
  machine_id: number;
  file_path: string;
}

/** 未消費（consumed_at IS NULL）の Tier1 増分索引を返す。 */
export function unconsumedTier1(machineId?: number): Tier1Row[] {
  const db = getDb();
  const sql = machineId
    ? 'SELECT id, machine_id, file_path FROM tier1_increments WHERE consumed_at IS NULL AND machine_id=? ORDER BY id'
    : 'SELECT id, machine_id, file_path FROM tier1_increments WHERE consumed_at IS NULL ORDER BY id';
  return (machineId ? db.prepare(sql).all(machineId) : db.prepare(sql).all()) as Tier1Row[];
}

/** Tier1 を消費済みにマークし、猶予日数後に削除できるよう delete_after を設定する。 */
export function markTier1Consumed(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const grace = Number(process.env.TIER1_GRACE_DAYS || 7);
  const now = new Date();
  const deleteAfter = new Date(now.getTime() + grace * 86400_000).toISOString();
  const stmt = db.prepare('UPDATE tier1_increments SET consumed_at=?, delete_after=? WHERE id=?');
  const tx = db.transaction(() => {
    for (const id of ids) stmt.run(now.toISOString(), deleteAfter, id);
  });
  tx();
}

function digestKey(scope: string, machineId?: number | null, projectId?: number | null): string {
  return `${scope}_${machineId ?? 'x'}_${projectId ?? 'x'}`;
}

/** 現在のダイジェスト本文（無ければ null）を読む。 */
export function loadDigest(
  scope: string,
  machineId?: number | null,
  projectId?: number | null,
): unknown | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT file_path FROM tier2_digests WHERE scope=? AND IFNULL(machine_id,-1)=IFNULL(?,-1) AND IFNULL(project_id,-1)=IFNULL(?,-1)`,
    )
    .get(scope, machineId ?? null, projectId ?? null) as { file_path: string } | undefined;
  if (!row || !fs.existsSync(row.file_path)) return null;
  try {
    return JSON.parse(fs.readFileSync(row.file_path, 'utf8'));
  } catch {
    return null;
  }
}

/** ダイジェストを保存し、tier2_digests 索引を upsert。ファイルパスを返す（永続）。 */
export function saveDigest(
  scope: string,
  content: unknown,
  opts: { machineId?: number | null; projectId?: number | null; period?: string } = {},
): { id: number; filePath: string } {
  const db = getDb();
  ensureDir(DIGESTS_DIR);
  const filePath = path.join(DIGESTS_DIR, `${digestKey(scope, opts.machineId, opts.projectId)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  const now = new Date().toISOString();

  const existing = db
    .prepare(
      `SELECT id FROM tier2_digests WHERE scope=? AND IFNULL(machine_id,-1)=IFNULL(?,-1) AND IFNULL(project_id,-1)=IFNULL(?,-1)`,
    )
    .get(scope, opts.machineId ?? null, opts.projectId ?? null) as { id: number } | undefined;

  if (existing) {
    db.prepare('UPDATE tier2_digests SET file_path=?, period=?, updated_at=? WHERE id=?').run(
      filePath,
      opts.period ?? 'rolling',
      now,
      existing.id,
    );
    return { id: existing.id, filePath };
  }
  const r = db
    .prepare(
      `INSERT INTO tier2_digests(scope, machine_id, project_id, period, file_path, updated_at) VALUES(?,?,?,?,?,?)`,
    )
    .run(scope, opts.machineId ?? null, opts.projectId ?? null, opts.period ?? 'rolling', filePath, now);
  return { id: Number(r.lastInsertRowid), filePath };
}

/** パターン候補（description ごと）の出現回数を加算・更新する。 */
export function upsertPatterns(digestId: number, patterns: { description: string; count?: number }[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const find = db.prepare('SELECT id, count FROM patterns WHERE digest_id=? AND description=?');
  const ins = db.prepare(
    'INSERT INTO patterns(digest_id, description, count, first_seen, last_seen) VALUES(?,?,?,?,?)',
  );
  const upd = db.prepare('UPDATE patterns SET count=?, last_seen=? WHERE id=?');
  const tx = db.transaction(() => {
    for (const p of patterns) {
      const add = p.count ?? 1;
      const cur = find.get(digestId, p.description) as { id: number; count: number } | undefined;
      if (cur) upd.run(cur.count + add, now, cur.id);
      else ins.run(digestId, p.description, add, now, now);
    }
  });
  tx();
}
