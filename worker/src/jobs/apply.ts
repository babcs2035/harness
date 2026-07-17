import type { ApplyInput } from '@harness/shared';
import { getDb } from '@harness/shared';
import { type Machine, runRemoteApply, runRemoteRollback } from '../ssh.js';

interface ProposalRow {
  id: number;
  type: string;
  machine_id: number;
  target_path: string;
  base_hash: string;
  new_content: string;
  status: string;
}

/** 承認済み提案を対象端末に適用する。edited_content があればそれを優先（編集して Accept）。 */
export async function runApply(payload: { proposal_id: number; edited_content?: string }): Promise<string> {
  const db = getDb();
  const prop = db.prepare('SELECT * FROM proposals WHERE id=?').get(payload.proposal_id) as
    | ProposalRow
    | undefined;
  if (!prop) throw new Error(`proposal#${payload.proposal_id} が存在しません`);
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(prop.machine_id) as Machine | undefined;
  if (!machine) throw new Error(`machine#${prop.machine_id} が存在しません`);

  const content = payload.edited_content ?? prop.new_content;
  const input: ApplyInput = {
    target_path: prop.target_path,
    base_hash: prop.base_hash,
    new_content: content,
    proposal_id: prop.id,
  };
  // skill 一式など複数ファイル型は new_content に files JSON を格納（Phase 3）
  if (prop.type === 'skill') {
    try {
      const parsed = JSON.parse(prop.new_content);
      if (Array.isArray(parsed?.files)) input.files = parsed.files;
    } catch {
      /* 単一ファイルとして扱う */
    }
  }

  const result = await runRemoteApply(machine, input);
  const now = new Date().toISOString();
  if (!result.ok) {
    db.prepare("UPDATE proposals SET status='failed', decided_at=? WHERE id=?").run(now, prop.id);
    throw new Error(`適用失敗: ${result.error}`);
  }
  db.prepare('INSERT INTO apply_logs(proposal_id, backup_path, result, applied_at) VALUES(?, ?, ?, ?)').run(
    prop.id,
    result.backup_path ?? null,
    JSON.stringify(result),
    now,
  );
  db.prepare("UPDATE proposals SET status='applied', decided_at=? WHERE id=?").run(now, prop.id);
  return `proposal#${prop.id} を ${machine.name}:${prop.target_path} に適用（backup=${result.backup_path}）`;
}

/** 適用済みをロールバックする。 */
export async function runRollback(payload: { apply_log_id: number }): Promise<string> {
  const db = getDb();
  const log = db.prepare('SELECT * FROM apply_logs WHERE id=?').get(payload.apply_log_id) as
    | { id: number; proposal_id: number; backup_path: string }
    | undefined;
  if (!log) throw new Error(`apply_log#${payload.apply_log_id} が存在しません`);
  const prop = db.prepare('SELECT * FROM proposals WHERE id=?').get(log.proposal_id) as
    | ProposalRow
    | undefined;
  if (!prop) throw new Error('提案が見つかりません');
  const machine = db.prepare('SELECT * FROM machines WHERE id=?').get(prop.machine_id) as Machine | undefined;
  if (!machine) throw new Error('端末が見つかりません');
  if (!log.backup_path) throw new Error('バックアップパスがありません');

  const result = await runRemoteRollback(machine, log.backup_path);
  const now = new Date().toISOString();
  if (!result.ok) throw new Error(`ロールバック失敗: ${result.error}`);
  db.prepare('UPDATE apply_logs SET rolled_back_at=? WHERE id=?').run(now, log.id);
  db.prepare("UPDATE proposals SET status='pending', decided_at=NULL WHERE id=?").run(prop.id);
  return `apply_log#${log.id} をロールバック（proposal#${prop.id} を pending に戻しました）`;
}
