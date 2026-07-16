import { NextResponse } from 'next/server';
import { getDb } from '@harness/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const db = getDb();
  const machines = db
    .prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM sessions s WHERE s.machine_id=m.id) AS session_count,
        (SELECT COUNT(*) FROM projects p WHERE p.machine_id=m.id) AS project_count
       FROM machines m ORDER BY m.id`,
    )
    .all();
  return NextResponse.json({ machines });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { name, ssh_host, ssh_user, workspace_root, max_depth } = body ?? {};
  if (!name || !ssh_host || !ssh_user) {
    return NextResponse.json({ error: 'name / ssh_host / ssh_user は必須です' }, { status: 400 });
  }
  const db = getDb();
  try {
    const r = db
      .prepare(
        `INSERT INTO machines(name, ssh_host, ssh_user, workspace_root, max_depth, enabled)
         VALUES(?, ?, ?, ?, ?, 1)`,
      )
      .run(name, ssh_host, ssh_user, workspace_root || null, max_depth || null);
    return NextResponse.json({ id: Number(r.lastInsertRowid) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
