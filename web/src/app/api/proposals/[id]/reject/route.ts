import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = getDb();
  const r = db
    .prepare("UPDATE proposals SET status='rejected', decided_at=? WHERE id=?")
    .run(new Date().toISOString(), Number(id));
  if (r.changes === 0) return NextResponse.json({ error: 'proposal が存在しません' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
