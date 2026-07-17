import type { Increment } from '@harness/shared';
import { getDb } from '@harness/shared';

export interface IngestSummary {
  stats: number;
  sessions: number;
  snapshots: number;
  deleted: number;
  cursors: number;
}

/**
 * 増分を単一トランザクションで取り込む。カーソル更新も同一トランザクションに含めることで、
 * ingest 成功時のみカーソルが進む（＝失敗時は再収集で同じ増分を再適用でき、二重計上しない）。
 */
export function ingestIncrement(
  machineId: number,
  increment: Increment,
  incrementFilePath: string,
): IngestSummary {
  const db = getDb();
  const now = new Date().toISOString();

  const upsertProject = db.prepare(
    `INSERT INTO projects(machine_id, cwd, last_seen_at) VALUES(?, ?, ?)
     ON CONFLICT(machine_id, cwd) DO UPDATE SET last_seen_at=excluded.last_seen_at
     RETURNING id`,
  );
  const projectCache = new Map<string, number>();
  const projectId = (cwd: string): number => {
    const key = cwd || '(unknown)';
    const cached = projectCache.get(key);
    if (cached !== undefined) return cached;
    const row = upsertProject.get(machineId, key, now) as { id: number };
    projectCache.set(key, row.id);
    return row.id;
  };

  const upsertStat = db.prepare(
    `INSERT INTO stats_daily(date, machine_id, project_id, model, input_tokens, output_tokens, cache_read, cache_creation, messages)
     VALUES(@date, @machine_id, @project_id, @model, @input_tokens, @output_tokens, @cache_read, @cache_creation, @messages)
     ON CONFLICT(date, machine_id, project_id, model) DO UPDATE SET
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cache_read = cache_read + excluded.cache_read,
       cache_creation = cache_creation + excluded.cache_creation,
       messages = messages + excluded.messages`,
  );

  const upsertSession = db.prepare(
    `INSERT INTO sessions(session_id, machine_id, project_id, started_at, last_at, message_count)
     VALUES(@session_id, @machine_id, @project_id, @started_at, @last_at, @message_count)
     ON CONFLICT(session_id) DO UPDATE SET
       last_at = MAX(sessions.last_at, excluded.last_at),
       started_at = MIN(sessions.started_at, excluded.started_at),
       message_count = sessions.message_count + excluded.message_count,
       project_id = excluded.project_id`,
  );

  const currentSnapshotHash = db.prepare(
    `SELECT hash FROM snapshots WHERE machine_id=? AND path=? AND is_current=1`,
  );
  const demoteSnapshot = db.prepare(
    `UPDATE snapshots SET is_current=0 WHERE machine_id=? AND path=? AND is_current=1`,
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO snapshots(machine_id, kind, path, hash, content, collected_at, is_current)
     VALUES(?, ?, ?, ?, ?, ?, 1)`,
  );

  const upsertCursor = db.prepare(
    `INSERT INTO cursors(machine_id, file_path, byte_offset, head_hash, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(machine_id, file_path) DO UPDATE SET
       byte_offset=excluded.byte_offset, head_hash=excluded.head_hash, updated_at=excluded.updated_at`,
  );

  const insertTier1 = db.prepare(
    `INSERT INTO tier1_increments(machine_id, project_id, file_path, collected_at) VALUES(?, ?, ?, ?)`,
  );
  const touchMachine = db.prepare(`UPDATE machines SET last_collected_at=? WHERE id=?`);

  const summary: IngestSummary = { stats: 0, sessions: 0, snapshots: 0, deleted: 0, cursors: 0 };

  const tx = db.transaction(() => {
    for (const s of increment.stats) {
      upsertStat.run({
        date: s.date,
        machine_id: machineId,
        project_id: projectId(s.project_cwd),
        model: s.model,
        input_tokens: s.input_tokens,
        output_tokens: s.output_tokens,
        cache_read: s.cache_read,
        cache_creation: s.cache_creation,
        messages: s.messages,
      });
      summary.stats++;
    }

    for (const ses of increment.sessions) {
      upsertSession.run({
        session_id: ses.session_id,
        machine_id: machineId,
        project_id: projectId(ses.project_cwd),
        started_at: ses.started_at || '',
        last_at: ses.last_at || '',
        message_count: ses.message_count ?? 0,
      });
      summary.sessions++;
    }

    for (const snap of increment.changed_snapshots) {
      const cur = currentSnapshotHash.get(machineId, snap.path) as { hash: string } | undefined;
      if (cur && cur.hash === snap.hash) continue;
      demoteSnapshot.run(machineId, snap.path);
      insertSnapshot.run(machineId, snap.kind, snap.path, snap.hash, snap.content, now);
      summary.snapshots++;
    }

    for (const p of increment.deleted_files) {
      const changed = demoteSnapshot.run(machineId, p);
      if (changed.changes > 0) summary.deleted++;
    }

    // 素材（発話等）は増分ファイルごと Tier1 として索引（Phase 2 の分析で消費）
    if (increment.sessions.length > 0) {
      insertTier1.run(machineId, null, incrementFilePath, now);
    }

    for (const c of increment.new_cursors) {
      upsertCursor.run(machineId, c.file, c.byte_offset, c.head_hash, now);
      summary.cursors++;
    }

    touchMachine.run(increment.machine_ts || now, machineId);
  });

  tx();
  return summary;
}
