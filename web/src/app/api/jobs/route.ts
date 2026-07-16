import { NextResponse } from 'next/server';
import { getDb } from '@harness/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = Number(url.searchParams.get('limit') || 50);

  const jobs = status
    ? db.prepare('SELECT * FROM jobs WHERE status=? ORDER BY id DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit);

  // ダッシュボードの未確認失敗バッジ用
  const failedUnacked = (
    db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='failed' AND acknowledged=0").get() as { n: number }
  ).n;

  return NextResponse.json({ jobs, failedUnacked });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { type, payload } = body ?? {};
  if (!type) return NextResponse.json({ error: 'type は必須です' }, { status: 400 });
  const db = getDb();
  const r = db
    .prepare("INSERT INTO jobs(type, payload, status, created_at) VALUES(?, ?, 'queued', datetime('now'))")
    .run(type, JSON.stringify(payload ?? {}));
  return NextResponse.json({ id: Number(r.lastInsertRowid) });
}
