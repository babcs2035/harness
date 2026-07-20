import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  // 既に applied/failed の提案を reject できないよう status='pending' で制限
  const r = db
    .prepare("UPDATE proposals SET status='rejected', decided_at=? WHERE id=? AND status='pending'")
    .run(new Date().toISOString(), Number(id));
  if (r.changes === 0)
    return NextResponse.json({ error: 'proposal not found or not in pending state' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
