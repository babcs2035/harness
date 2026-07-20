import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

// better-sqlite3 を使うため Node ランタイム固定
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** apply_log をロールバックするジョブを投入する（id = apply_logs.id）。 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = getDb();
    const log = db.prepare('SELECT id FROM apply_logs WHERE id=?').get(Number(id));
    if (!log) return NextResponse.json({ error: 'apply_log not found' }, { status: 404 });
    const r = db
      .prepare(
        "INSERT INTO jobs(type, payload, status, created_at) VALUES('rollback', ?, 'queued', datetime('now'))",
      )
      .run(JSON.stringify({ apply_log_id: Number(id) }));
    return NextResponse.json({ ok: true, job_id: Number(r.lastInsertRowid) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
