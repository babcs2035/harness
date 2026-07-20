import { getDb, logicalKey } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Snap {
  machine_id: number;
  machine: string;
  kind: string;
  path: string;
  hash: string;
}

export function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.machine_id, m.name AS machine, s.kind, s.path, s.hash
       FROM snapshots s JOIN machines m ON m.id=s.machine_id
       WHERE s.is_current=1 AND s.kind IN ('claude_md','skill','memory','settings')`,
    )
    .all() as Snap[];

  const machines = Array.from(new Set(rows.map((r) => r.machine))).sort();
  const byKey = new Map<string, { kind: string; cells: Record<string, string> }>();
  for (const r of rows) {
    const key = logicalKey(r.path);
    if (!byKey.has(key)) byKey.set(key, { kind: r.kind, cells: {} });
    const entry = byKey.get(key);
    if (entry) entry.cells[r.machine] = r.hash;
  }

  const keys = Array.from(byKey.entries())
    .map(([key, v]) => {
      const present = Object.keys(v.cells);
      const distinct = new Set(Object.values(v.cells));
      return {
        key,
        kind: v.kind,
        cells: v.cells,
        present_on: present.length,
        diverged: present.length > 1 && distinct.size > 1,
      };
    })
    .sort((a, b) => Number(b.diverged) - Number(a.diverged) || a.key.localeCompare(b.key));

  return NextResponse.json({ machines, keys });
}
