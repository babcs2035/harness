import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CollectorInput, SessionCursor } from '@harness/shared';
import { getDb } from '@harness/shared';
import { ensureDir, INCREMENTS_DIR } from '../lib/paths.js';
import { type Machine, runRemoteCollector } from '../ssh.js';
import { ingestIncrement } from './ingest.js';

/**
 * 1 端末を収集する。Hub 保持のカーソル + スナップショットハッシュを組み立てて collector を実行し、
 * 増分をファイル保存してから ingest する。
 */
export async function runCollect(machineId: number, opts: { fullResync?: boolean } = {}): Promise<string> {
  const db = getDb();
  const machine = db.prepare('SELECT * FROM machines WHERE id=? AND enabled=1').get(machineId) as
    | Machine
    | undefined;
  if (!machine) throw new Error(`machine#${machineId} not found or disabled`);

  const cursors = db
    .prepare('SELECT file_path AS file, byte_offset, head_hash FROM cursors WHERE machine_id=?')
    .all(machineId) as SessionCursor[];
  const snapRows = db
    .prepare('SELECT path, hash FROM snapshots WHERE machine_id=? AND is_current=1')
    .all(machineId) as { path: string; hash: string }[];
  const snapshot_hashes: Record<string, string> = {};
  for (const r of snapRows) snapshot_hashes[r.path] = r.hash;

  const input: CollectorInput = {
    session_cursors: opts.fullResync ? [] : cursors,
    snapshot_hashes,
    workspace_root: machine.workspace_root || '',
    max_depth: machine.max_depth || Number(process.env.WORKSPACE_MAX_DEPTH || 6),
    recent_full_sessions: Number(process.env.RECENT_FULL_SESSIONS || 5),
    full_resync: opts.fullResync,
  };

  const incr = await runRemoteCollector(machine, input, { fullResync: opts.fullResync });

  ensureDir(INCREMENTS_DIR);
  const safeTs = (incr.machine_ts || new Date().toISOString()).replace(/[:.]/g, '-');
  const file = path.join(INCREMENTS_DIR, `m${machineId}_${safeTs}_${randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(incr));

  const s = ingestIncrement(machineId, incr, file);
  return `collected m${machineId}(${machine.name}): stats=${s.stats} sessions=${s.sessions} snapshots=${s.snapshots} deleted=${s.deleted} cursors=${s.cursors}`;
}
