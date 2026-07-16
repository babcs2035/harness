import { NextResponse } from 'next/server';
import { getDb } from '@harness/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 提案一覧。side-by-side 表示用に現行スナップショット本文（old_content）も添える。 */
export function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const rows = (status
    ? db.prepare('SELECT * FROM proposals WHERE status=? ORDER BY id DESC').all(status)
    : db.prepare('SELECT * FROM proposals ORDER BY id DESC').all()) as Record<string, unknown>[];

  const machineName = db.prepare('SELECT name FROM machines WHERE id=?');
  const currentSnap = db.prepare(
    "SELECT content FROM snapshots WHERE machine_id=? AND path=? AND is_current=1",
  );

  const proposals = rows.map((p) => {
    const m = machineName.get(p.machine_id) as { name: string } | undefined;
    const snap = currentSnap.get(p.machine_id, p.target_path) as { content: string } | undefined;
    return { ...p, machine: m?.name ?? '', old_content: snap?.content ?? '' };
  });
  return NextResponse.json({ proposals });
}
