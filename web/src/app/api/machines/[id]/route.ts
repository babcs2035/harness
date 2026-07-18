import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 端末情報を編集する（name/ssh_host/ssh_user/workspace_root/max_depth）。 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { name, ssh_host, ssh_user, workspace_root, max_depth } = body ?? {};
  if (!name || !ssh_host || !ssh_user) {
    return NextResponse.json({ error: 'name / ssh_host / ssh_user are required' }, { status: 400 });
  }
  const db = getDb();
  const machine = db.prepare('SELECT id FROM machines WHERE id=?').get(Number(id));
  if (!machine) return NextResponse.json({ error: 'machine not found' }, { status: 404 });
  try {
    db.prepare(
      `UPDATE machines SET name=?, ssh_host=?, ssh_user=?, workspace_root=?, max_depth=? WHERE id=?`,
    ).run(name, ssh_host, ssh_user, workspace_root || null, max_depth || null, Number(id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
