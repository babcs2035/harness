import { NextResponse } from 'next/server';
import { getDb } from '@harness/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 適用履歴（apply_logs）とジョブログ。History 画面用。 */
export function GET() {
  const db = getDb();
  const applyLogs = db
    .prepare(
      `SELECT al.*, p.type AS proposal_type, p.target_path, p.status AS proposal_status, m.name AS machine
       FROM apply_logs al
       JOIN proposals p ON p.id = al.proposal_id
       JOIN machines m ON m.id = p.machine_id
       ORDER BY al.id DESC LIMIT 100`,
    )
    .all();
  const jobs = db
    .prepare('SELECT id, type, status, error_kind, acknowledged, created_at, finished_at, log, cost_usd FROM jobs ORDER BY id DESC LIMIT 50')
    .all();
  const failedUnacked = (
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='failed' AND acknowledged=0").get() as { n: number }
  ).n;
  return NextResponse.json({ applyLogs, jobs, failedUnacked });
}
