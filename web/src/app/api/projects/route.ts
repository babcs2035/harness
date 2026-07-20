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
  claude_md_size: number | null;
  claude_md_updated: string | null;
}

/** プロジェクト一覧。CLAUDE.md の有無/サイズを添え、「よく使うのに薄い」順で返す。 */
export function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.cwd, p.machine_id, m.name AS machine, p.last_seen_at,
        (SELECT COUNT(*) FROM sessions s WHERE s.project_id=p.id) AS sessions,
        (SELECT COALESCE(SUM(messages),0) FROM stats_daily d WHERE d.project_id=p.id) AS messages,
        LENGTH(s.content) AS claude_md_size,
        s.collected_at AS claude_md_updated
       FROM projects p
       JOIN machines m ON m.id=p.machine_id
       LEFT JOIN snapshots s ON s.machine_id=p.machine_id AND s.kind='claude_md' AND s.is_current=1
         AND s.path = p.cwd || '/CLAUDE.md'`,
    )
    .all() as ProjectRow[];

  const projects = rows.map((p) => {
    const size = p.claude_md_size ?? 0;
    // 薄さスコア: 利用量(messages)が多く CLAUDE.md が薄いほど大きい
    const thinness = p.messages / (size + 200);
    return {
      id: p.id,
      cwd: p.cwd,
      machine_id: p.machine_id,
      machine: p.machine,
      sessions: p.sessions,
      messages: p.messages,
      last_seen_at: p.last_seen_at,
      has_claude_md: (p.claude_md_size ?? 0) > 0,
      claude_md_size: size,
      claude_md_updated: p.claude_md_updated,
      thinness,
    };
  });

  projects.sort((a, b) => b.thinness - a.thinness);
  return NextResponse.json({ projects });
}
