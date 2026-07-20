import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 提案一覧。side-by-side 表示用に現行スナップショット本文（old_content）も添える。 */
export function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);

  const proposals = (
    status
      ? db
          .prepare(
            `SELECT p.*, m.name AS machine, s.content AS old_content
             FROM proposals p
             LEFT JOIN machines m ON m.id = p.machine_id
             LEFT JOIN snapshots s ON s.machine_id = p.machine_id AND s.path = p.target_path AND s.is_current = 1
             WHERE p.status = ?
             ORDER BY p.id DESC LIMIT ?`,
          )
          .all(status, limit)
      : db
          .prepare(
            `SELECT p.*, m.name AS machine, s.content AS old_content
             FROM proposals p
             LEFT JOIN machines m ON m.id = p.machine_id
             LEFT JOIN snapshots s ON s.machine_id = p.machine_id AND s.path = p.target_path AND s.is_current = 1
             ORDER BY p.id DESC LIMIT ?`,
          )
          .all(limit)
  ) as Record<string, unknown>[];

  return NextResponse.json({ proposals });
}
