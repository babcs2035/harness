import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 繰り返しパターン候補（出現回数つき）。digest-fold が更新する。 */
export function GET() {
  const db = getDb();
  const patterns = db
    .prepare(
      `SELECT p.id, p.description, p.count, p.status, p.last_seen, d.scope
       FROM patterns p LEFT JOIN tier2_digests d ON d.id = p.digest_id
       ORDER BY p.count DESC, p.id DESC LIMIT 100`,
    )
    .all();
  return NextResponse.json({ patterns });
}
