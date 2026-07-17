import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

// better-sqlite3 を使うため Node ランタイム固定
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS n FROM machines').get() as { n: number };
    return NextResponse.json({ ok: true, machines: row.n });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
