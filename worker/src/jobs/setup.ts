import { getDb } from '@harness/shared';
import type { Machine } from '../ssh.js';
import { runRemoteSetup } from '../ssh.js';

/**
 * Machines 登録直後に自動投入され、開発機へ collector.py/apply.py/gate.sh を配布し
 * settings.json の cleanupPeriodDays を設定する。
 */
export async function runSetup(payload: { machine_id: number }): Promise<string> {
  const db = getDb();
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(payload.machine_id) as
    | Machine
    | undefined;
  if (!machine) throw new Error(`machine#${payload.machine_id} が存在しません`);
  return runRemoteSetup(machine);
}
