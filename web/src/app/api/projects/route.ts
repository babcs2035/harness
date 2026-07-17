import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProjectRow {
  id: number;
  cwd: string;
  machine_id: number;
  machine: string;
  sessions: number;
  messages: number;
  last_seen_at: string | null;
}

/** プロジェクト一覧。CLAUDE.md の有無/サイズを添え、「よく使うのに薄い」順で返す。 */
export function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.cwd, p.machine_id, m.name AS machine, p.last_seen_at,
        (SELECT COUNT(*) FROM sessions s WHERE s.project_id=p.id) AS sessions,
        (SELECT COALESCE(SUM(messages),0) FROM stats_daily d WHERE d.project_id=p.id) AS messages
       FROM projects p JOIN machines m ON m.id=p.machine_id`,
    )
    .all() as ProjectRow[];

  const claudeMd = db.prepare(
    `SELECT LENGTH(content) AS size, collected_at FROM snapshots
     WHERE machine_id=? AND kind='claude_md' AND is_current=1 AND path=?`,
  );

  const projects = rows.map((p) => {
    const md = claudeMd.get(p.machine_id, `${p.cwd}/CLAUDE.md`) as
      | { size: number; collected_at: string }
      | undefined;
    const size = md?.size ?? 0;
    // 薄さスコア: 利用量(messages)が多く CLAUDE.md が薄いほど大きい
    const thinness = p.messages / (size + 200);
    return {
      ...p,
      has_claude_md: !!md,
      claude_md_size: size,
      claude_md_updated: md?.collected_at ?? null,
      thinness,
    };
  });

  projects.sort((a, b) => b.thinness - a.thinness);
  return NextResponse.json({ projects });
}
