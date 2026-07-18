import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Accept（または編集して Accept）: 提案を accepted にし、apply ジョブを投入する。 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const proposalId = Number(id);
  const body = await req.json().catch(() => ({}));
  const editedContent: string | undefined = body?.edited_content;

  const db = getDb();
  const prop = db.prepare('SELECT id, status FROM proposals WHERE id=?').get(proposalId) as
    | { id: number; status: string }
    | undefined;
  if (!prop) return NextResponse.json({ error: 'proposal not found' }, { status: 404 });

  const now = new Date().toISOString();
  // 編集して Accept の場合は new_content を上書き保存
  if (typeof editedContent === 'string' && editedContent.length > 0) {
    db.prepare('UPDATE proposals SET new_content=? WHERE id=?').run(editedContent, proposalId);
  }
  db.prepare("UPDATE proposals SET status='accepted', decided_at=? WHERE id=?").run(now, proposalId);
  const r = db
    .prepare(
      "INSERT INTO jobs(type, payload, status, created_at) VALUES('apply', ?, 'queued', datetime('now'))",
    )
    .run(JSON.stringify({ proposal_id: proposalId }));
  return NextResponse.json({ ok: true, job_id: Number(r.lastInsertRowid) });
}
