import { getDb } from '@harness/shared';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 集計 API。from/to（YYYY-MM-DD）・machine（id）・project（id）で絞り込む。 */
export function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const machine = url.searchParams.get('machine');
  const project = url.searchParams.get('project');

  // stats_daily 用の条件（テーブル別名なし）
  const w: string[] = [];
  const p: Record<string, unknown> = {};
  if (from) {
    w.push('date >= @from');
    p.from = from;
  }
  if (to) {
    w.push('date <= @to');
    p.to = to;
  }
  if (machine) {
    w.push('machine_id = @machine');
    p.machine = Number(machine);
  }
  if (project) {
    w.push('project_id = @project');
    p.project = Number(project);
  }
  const cond = w.length ? `WHERE ${w.join(' AND ')}` : '';

  const daily = db
    .prepare(
      `SELECT date,
        SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
        SUM(cache_read) AS cache_read, SUM(cache_creation) AS cache_creation,
        SUM(messages) AS messages
       FROM stats_daily ${cond} GROUP BY date ORDER BY date`,
    )
    .all(p);

  const byModel = db
    .prepare(
      `SELECT model, SUM(input_tokens + output_tokens) AS tokens, SUM(messages) AS messages
       FROM stats_daily ${cond} GROUP BY model ORDER BY tokens DESC`,
    )
    .all(p);

  // プロジェクト別（別名 sd 付きの条件を別に組む）
  const w2: string[] = [];
  if (from) w2.push('sd.date >= @from');
  if (to) w2.push('sd.date <= @to');
  if (machine) w2.push('sd.machine_id = @machine');
  if (project) w2.push('sd.project_id = @project');
  const cond2 = w2.length ? `WHERE ${w2.join(' AND ')}` : '';
  const byProject = db
    .prepare(
      `SELECT p.cwd AS project, m.name AS machine,
        SUM(sd.input_tokens + sd.output_tokens) AS tokens, SUM(sd.messages) AS messages
       FROM stats_daily sd
       JOIN projects p ON p.id = sd.project_id
       JOIN machines m ON m.id = sd.machine_id
       ${cond2} GROUP BY sd.project_id ORDER BY tokens DESC LIMIT 20`,
    )
    .all(p);

  // セッション数の日別推移（started_at の日付部分で集計）
  const sw: string[] = [];
  if (from) sw.push('substr(started_at,1,10) >= @from');
  if (to) sw.push('substr(started_at,1,10) <= @to');
  if (machine) sw.push('machine_id = @machine');
  if (project) sw.push('project_id = @project');
  const scond = sw.length ? `WHERE ${sw.join(' AND ')}` : '';
  const sessionsDaily = db
    .prepare(
      `SELECT substr(started_at,1,10) AS date, COUNT(*) AS sessions
       FROM sessions ${scond} GROUP BY date ORDER BY date`,
    )
    .all(p);

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(cache_read),0) AS cache_read, COALESCE(SUM(cache_creation),0) AS cache_creation,
        COALESCE(SUM(messages),0) AS messages
       FROM stats_daily ${cond}`,
    )
    .get(p);

  return NextResponse.json({ daily, byModel, byProject, sessionsDaily, totals });
}
